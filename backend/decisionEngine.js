/**
 * Decision Engine — AI/ML contract + net realisation helpers
 * ==========================================================
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * The previous version of this file read an AI/ML response shape that does
 * not exist:
 *
 *     forecast.current_price      forecast.predicted_price
 *     summary.confidence          summary.risk_score
 *     summary.anomaly_detected
 *
 * The real `/summary` response (see ai-ml/src/api/main.py) is nested:
 *
 *     forecast: { status, last_price, last_date, trend, confidence,
 *                 confidence_reason, volatility_cv, explanation,
 *                 forecast: [{ date, predicted_price, lower_bound, upper_bound }] }
 *     risk:     { risk_score, risk_level, risk_status, explanation }
 *     anomaly:  { anomaly_flag, anomaly_type, anomaly_score, anomaly_status, explanation }
 *
 * Reading the old keys yielded `undefined`, which became `NaN` in the
 * percentage maths and silently produced confident-looking nonsense. Fixed.
 *
 * WHERE THE REAL LOGIC LIVES
 * --------------------------
 * The sell / store / split allocation is produced by the Core optimization
 * engine (Core/engine + Core/service), reached over HTTP by
 * services/optimizerClient.js. This module deliberately does NOT duplicate
 * that logic. It provides:
 *
 *   1. readSummary()              — the corrected contract, one place.
 *   2. calculateNetRealisation()  — the same line-item formula as Core,
 *                                   for the degraded-mode baseline.
 *   3. calculateSellNowBaseline() — a plain sell-now number shown ONLY when
 *                                   the optimizer service is unreachable,
 *                                   and always labelled as not a recommendation.
 *
 * Nothing here converts missing data into a safe-looking value.
 */

/** Prototype cost assumptions. Surfaced to the UI so they can be labelled. */
const ASSUMPTIONS = {
  mandi_commission_rate: 0.02,
  perishability_base: 1.05,
  default_storage_cost_per_unit_per_day: 2.0,
  default_risk_tolerance: 0.5,
  uncertified_price_multiplier: 0.95,
};

function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Read the real, nested `/summary` shape into flat fields.
 *
 * Every block carries an explicit availability flag. A missing risk block
 * gives `risk_available: false` and `risk_score: null` — never 0. A missing
 * anomaly block gives `anomaly_flag: null` — never false.
 */
function readSummary(summary) {
  const forecast = (summary && summary.forecast) || {};
  const risk = (summary && summary.risk) || {};
  const anomaly = (summary && summary.anomaly) || {};

  const forecastAvailable = forecast.status === 'success';
  const points = forecastAvailable ? forecast.forecast || [] : [];

  const riskAvailable = risk.risk_status === 'ok' && risk.risk_score != null;
  const anomalyAvailable = anomaly.anomaly_status === 'ok';

  return {
    service_available: Boolean(summary),
    commodity: summary ? summary.commodity : null,
    market: summary ? summary.market : null,

    forecast_available: forecastAvailable,
    forecast_status: forecast.status || 'unavailable',
    forecast_message: forecast.message || null,
    last_price: toNumber(forecast.last_price),
    last_date: forecast.last_date || null,
    trend: forecast.trend || null,
    history_observations: forecast.history_observations ?? null,
    forecast_points: points,
    first_predicted_price: points.length ? toNumber(points[0].predicted_price) : null,
    final_predicted_price: points.length
      ? toNumber(points[points.length - 1].predicted_price)
      : null,
    forecast_explanation: forecast.explanation || '',

    reliability_level: forecast.confidence || null,
    reliability_reason: forecast.confidence_reason || '',
    volatility_cv: toNumber(forecast.volatility_cv),

    risk_available: riskAvailable,
    risk_score: riskAvailable ? toNumber(risk.risk_score) : null,
    risk_level: riskAvailable ? risk.risk_level : null,
    risk_explanation: risk.explanation || '',

    anomaly_available: anomalyAvailable,
    anomaly_flag: anomalyAvailable ? Boolean(anomaly.anomaly_flag) : null,
    anomaly_type: anomalyAvailable ? anomaly.anomaly_type : null,
    anomaly_score: anomalyAvailable ? toNumber(anomaly.anomaly_score) : null,
    anomaly_explanation: anomaly.explanation || '',

    overall_explanation: (summary && summary.overall_explanation) || '',
  };
}

/**
 * Line-item net realisation. Mirrors
 * Core/engine/net_realisation.calculate_net_realisation so the degraded
 * fallback and the real engine agree on the arithmetic.
 *
 *   gross           = price x quantity x quality multiplier
 *   - transport
 *   - storage       = rate x qty x perishability^days
 *   - mandi/txn     = commission rate x gross
 *   = net realisation
 *   - risk adjustment (comparison weight, NOT cash)
 *   = risk-adjusted realisation
 */
function calculateNetRealisation({
  price,
  quantity,
  transportCost = 0,
  isCertified = true,
  storageDays = 0,
  storageCostPerUnitPerDay = 0,
  commissionRate = ASSUMPTIONS.mandi_commission_rate,
  riskTolerance = 0,
  riskPerUnit = 0,
  unit = 'quintal',
}) {
  const certMultiplier = isCertified ? 1 : ASSUMPTIONS.uncertified_price_multiplier;
  const grossRevenue = price * quantity * certMultiplier;
  const qualityPenalty = price * quantity * (1 - certMultiplier);
  const storageCost =
    storageDays > 0
      ? storageCostPerUnitPerDay *
        quantity *
        Math.pow(ASSUMPTIONS.perishability_base, storageDays)
      : 0;
  const commission = grossRevenue * commissionRate;
  const riskPenalty = riskTolerance * riskPerUnit * quantity;

  const netRealisation = grossRevenue - transportCost - storageCost - commission;

  const lineItems = [
    {
      label: 'Gross Revenue (Price × Qty)',
      amount: round2(grossRevenue),
      type: 'add',
      formula: `₹${price.toFixed(2)} × ${quantity} ${unit}${
        isCertified ? '' : ` × ${certMultiplier}`
      }`,
    },
  ];

  if (qualityPenalty > 0) {
    lineItems.push({
      label: 'Quality Penalty (unverified / ungraded)',
      amount: round2(-qualityPenalty),
      type: 'deduct',
      formula: `${((1 - certMultiplier) * 100).toFixed(0)}% of gross`,
    });
  }
  if (transportCost > 0) {
    lineItems.push({
      label: 'Transport Cost (as entered)',
      amount: round2(-transportCost),
      type: 'deduct',
      formula: 'Value you entered for this lot',
    });
  }
  if (storageCost > 0) {
    lineItems.push({
      label: `Storage Cost (${storageDays} days)`,
      amount: round2(-storageCost),
      type: 'deduct',
      formula: `₹${storageCostPerUnitPerDay}/${unit}/day × ${quantity} × ${ASSUMPTIONS.perishability_base}^${storageDays}`,
    });
  }
  if (commission > 0) {
    lineItems.push({
      label: `Mandi / transaction deduction (${(commissionRate * 100).toFixed(1)}%)`,
      amount: round2(-commission),
      type: 'deduct',
      formula: `${(commissionRate * 100).toFixed(1)}% × ₹${round2(grossRevenue)} gross — prototype assumption`,
    });
  }

  lineItems.push({
    label: 'Net Realisation',
    amount: round2(netRealisation),
    type: 'total',
    formula: '',
  });

  if (riskPenalty > 0) {
    lineItems.push({
      label: 'Risk adjustment (comparison weight, not cash)',
      amount: round2(-riskPenalty),
      type: 'deduct',
      formula: `${riskTolerance} × ₹${round2(riskPerUnit)}/${unit} × ${quantity} ${unit}`,
    });
    lineItems.push({
      label: 'Risk-Adjusted Realisation',
      amount: round2(netRealisation - riskPenalty),
      type: 'final_total',
      formula: '',
    });
  }

  return {
    gross_revenue: round2(grossRevenue),
    quality_penalty: round2(qualityPenalty),
    transport_cost: round2(transportCost),
    storage_cost: round2(storageCost),
    commission: round2(commission),
    commission_rate: commissionRate,
    risk_penalty: round2(riskPenalty),
    net_realisation: round2(netRealisation),
    risk_adjusted_realisation: round2(netRealisation - riskPenalty),
    line_items: lineItems,
  };
}

/**
 * Degraded-mode baseline: what selling the whole lot today would net.
 *
 * Used ONLY when the Core optimizer service is unreachable. Returns no
 * decision, no allocation and no storage comparison, and its limitations
 * say so in plain language.
 */
function calculateSellNowBaseline(lotPayload, buyerPayload, summary) {
  const reading = readSummary(summary);
  const limitations = [
    'Showing a sell-now calculation only. No sell / store / split comparison ' +
      'was run, so this is not a recommendation.',
  ];

  const candidates = [];
  if (reading.last_price && reading.last_price > 0) {
    candidates.push({
      name: `${lotPayload.market} APMC mandi`,
      price: reading.last_price,
      transport_cost: lotPayload.transport_cost || 0,
      commission_rate: ASSUMPTIONS.mandi_commission_rate,
    });
  }
  (buyerPayload || []).forEach((b) => candidates.push(b));

  if (!candidates.length) {
    limitations.push(
      'No price could be established for this crop and market, so even a ' +
        'sell-now figure cannot be shown.'
    );
    return { option: null, limitations };
  }

  const best = candidates.reduce((a, b) => (b.price > a.price ? b : a));
  const breakdown = calculateNetRealisation({
    price: best.price,
    quantity: Number(lotPayload.quantity),
    transportCost: Number(best.transport_cost || 0),
    isCertified: lotPayload.certificate_status === 'verified',
    commissionRate:
      best.commission_rate == null
        ? ASSUMPTIONS.mandi_commission_rate
        : Number(best.commission_rate),
    unit: lotPayload.unit || 'quintal',
  });

  return {
    option: {
      key: 'sell_now',
      label: `Sell all ${lotPayload.quantity} ${lotPayload.unit || 'quintal'} now`,
      channel: best.name,
      days: 0,
      available: true,
      breakdown,
    },
    limitations,
  };
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

module.exports = {
  ASSUMPTIONS,
  readSummary,
  calculateNetRealisation,
  calculateSellNowBaseline,
};
