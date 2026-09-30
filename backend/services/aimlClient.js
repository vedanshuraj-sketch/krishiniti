/**
 * AI/ML Service Client
 * ====================
 *
 * Wraps the FastAPI forecasting service. Its job is to hand back the RAW
 * `/summary` payload plus an honest availability report, and never to
 * invent a value that the service did not provide.
 *
 * The actual `/summary` shape (verified against ai-ml/src/api/main.py):
 *
 *   {
 *     commodity, market,
 *     forecast: {
 *       status: "success" | "no_data" | "insufficient_data",
 *       last_price, last_date, history_observations, trend,
 *       confidence, confidence_reason, volatility_cv, explanation,
 *       forecast: [{ date, predicted_price, lower_bound, upper_bound }]
 *     },
 *     risk:    { risk_score, risk_level, risk_status, explanation } | { status: "no_data" },
 *     anomaly: { anomaly_flag, anomaly_type, anomaly_score, anomaly_status, explanation }
 *              | { status: "no_data" },
 *     overall_explanation
 *   }
 *
 * The old backend code read `forecast.current_price`, `forecast.predicted_price`,
 * `summary.confidence`, `summary.risk_score` and `summary.anomaly_detected`.
 * None of those keys exist. That contract bug is fixed here and in
 * decisionEngine.js.
 */

const axios = require('axios');

const AI_ML_API_URL = (process.env.AI_ML_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const TIMEOUT_MS = parseInt(process.env.AI_ML_TIMEOUT_MS, 10) || 20000;

/** Statuses that mean "there is no usable forecast", each for a different reason. */
const FORECAST_FAILURE_STATUSES = new Set(['no_data', 'insufficient_data']);

async function getJson(path, params) {
  const response = await axios.get(`${AI_ML_API_URL}${path}`, {
    params,
    timeout: TIMEOUT_MS,
    headers: { Accept: 'application/json' },
  });
  return response.data;
}

/**
 * Fetch the combined summary for one commodity-market pair.
 *
 * Never throws. Returns:
 *   { available, summary, unavailable_reason, service_url }
 *
 * `available: false` with `summary: null` means the service itself could
 * not be reached. A reachable service that has no data still returns
 * `available: true` with a summary whose `forecast.status` says why —
 * the two situations are genuinely different and are kept distinct.
 */
async function fetchSummary(commodity, market, days = 7) {
  try {
    const summary = await getJson('/summary', { commodity, market, days });
    return {
      available: true,
      summary,
      unavailable_reason: null,
      service_url: AI_ML_API_URL,
    };
  } catch (err) {
    const detail = err.response?.data?.detail || err.message;
    console.error(`[aiml] /summary failed for ${commodity}@${market}: ${detail}`);
    return {
      available: false,
      summary: null,
      unavailable_reason:
        `The forecasting service at ${AI_ML_API_URL} could not be reached (${detail}). ` +
        'No forecast, risk score or anomaly check is available for this lot. ' +
        'This is a service outage, not a sign that conditions are safe.',
      service_url: AI_ML_API_URL,
    };
  }
}

/** Observed historical prices for the trend chart. Never throws. */
async function fetchHistory(commodity, market, days = 60) {
  try {
    const data = await getJson('/history', { commodity, market, days });
    return { available: data.status === 'ok', data };
  } catch (err) {
    console.error(`[aiml] /history failed: ${err.message}`);
    return { available: false, data: null, error: err.message };
  }
}

/** Dataset provenance and coverage, used to label the UI honestly. */
async function fetchMeta() {
  try {
    const data = await getJson('/meta', {});
    return { available: true, data };
  } catch (err) {
    console.error(`[aiml] /meta failed: ${err.message}`);
    return { available: false, data: null, error: err.message };
  }
}

/** Markets that actually have data for a commodity. Never throws. */
async function fetchMarkets(commodity, limit = 25) {
  try {
    const data = await getJson('/markets', { commodity, limit });
    return { available: data.status === 'ok', data };
  } catch (err) {
    console.error(`[aiml] /markets failed: ${err.message}`);
    return { available: false, data: null, error: err.message };
  }
}

/**
 * Read the nested summary into flat presentation fields.
 *
 * Mirrors Core/port/summary_adapter.py so the backend and the optimizer
 * agree on what "available" means. Missing blocks stay missing: risk is
 * `available: false` rather than 0, and an anomaly check that did not run
 * is never reported as "no anomaly".
 */
function describeSummary(summary) {
  if (!summary || typeof summary !== 'object') {
    return {
      forecast_available: false,
      forecast_status: 'unavailable',
      risk_available: false,
      anomaly_available: false,
      last_price: null,
      notes: ['No response from the forecasting service.'],
    };
  }

  const forecast = summary.forecast || {};
  const risk = summary.risk || {};
  const anomaly = summary.anomaly || {};
  const notes = [];

  const forecastStatus = forecast.status || 'unavailable';
  const forecastAvailable = forecastStatus === 'success';

  if (!forecastAvailable) {
    notes.push(
      FORECAST_FAILURE_STATUSES.has(forecastStatus)
        ? forecast.message || `Forecast unavailable (${forecastStatus}).`
        : 'No forecast was returned for this crop and market.'
    );
  }

  const riskAvailable = risk.risk_status === 'ok' && risk.risk_score != null;
  if (!riskAvailable) {
    notes.push(
      risk.explanation ||
        'Waiting-risk could not be scored for this crop and market.'
    );
  }

  const anomalyAvailable = anomaly.anomaly_status === 'ok';
  if (!anomalyAvailable) {
    notes.push(
      `${(anomaly.explanation || 'The anomaly check could not run for this crop and market.').replace(/\.$/, '')}. ` +
        'This is NOT a confirmation that prices are behaving normally.'
    );
  }

  return {
    commodity: summary.commodity,
    market: summary.market,

    forecast_available: forecastAvailable,
    forecast_status: forecastStatus,
    last_price: forecast.last_price ?? null,
    last_date: forecast.last_date ?? null,
    history_observations: forecast.history_observations ?? null,
    trend: forecast.trend ?? null,
    forecast_points: forecastAvailable ? forecast.forecast || [] : [],
    forecast_explanation: forecast.explanation || '',

    // "confidence" is presented to farmers as Forecast reliability.
    reliability_available: forecast.confidence != null,
    reliability_level: forecast.confidence ?? null,
    reliability_reason: forecast.confidence_reason || '',
    volatility_cv: forecast.volatility_cv ?? null,

    risk_available: riskAvailable,
    risk_score: riskAvailable ? risk.risk_score : null,
    risk_level: riskAvailable ? risk.risk_level : null,
    risk_explanation: risk.explanation || '',

    anomaly_available: anomalyAvailable,
    anomaly_flag: anomalyAvailable ? Boolean(anomaly.anomaly_flag) : null,
    anomaly_type: anomalyAvailable ? anomaly.anomaly_type : null,
    anomaly_score: anomalyAvailable ? anomaly.anomaly_score : null,
    anomaly_explanation: anomaly.explanation || '',

    overall_explanation: summary.overall_explanation || '',
    notes,
  };
}

module.exports = {
  AI_ML_API_URL,
  fetchSummary,
  fetchHistory,
  fetchMeta,
  fetchMarkets,
  describeSummary,
};
