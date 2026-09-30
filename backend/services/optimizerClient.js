/**
 * Core Optimizer Service Client
 * =============================
 *
 *   React Native  ->  Node backend  ->  Core optimizer (FastAPI)  ->  decision
 *                            |
 *                            +-------->  AI/ML /summary (fetched once here and
 *                                        passed down, so the recommendation and
 *                                        the Market Intelligence screen always
 *                                        show the same numbers)
 *
 * If the optimizer service is down we do NOT fake a successful call. We
 * return a reduced result that says so, computes only the sell-now
 * baseline in JavaScript, and flags `optimizer_available: false` so the
 * UI can show a degraded-mode banner instead of a confident answer.
 */

const axios = require('axios');
const { calculateSellNowBaseline } = require('../decisionEngine');

const OPTIMIZER_API_URL = (
  process.env.OPTIMIZER_API_URL || 'http://localhost:8100'
).replace(/\/$/, '');
const TIMEOUT_MS = parseInt(process.env.OPTIMIZER_TIMEOUT_MS, 10) || 20000;

/** Map a DB crop_lot row onto the optimizer's lot payload. */
function lotToPayload(lot) {
  return {
    commodity: lot.commodity,
    market: lot.market,
    quantity: Number(lot.quantity),
    unit: lot.unit || 'quintal',
    grade: lot.grade || null,
    quality_method: lot.quality_method || 'self_declared',
    certificate_status: lot.certificate_status || 'not_uploaded',
    storage_available: Boolean(lot.storage_available),
    storage_cost_per_unit_per_day:
      lot.storage_cost_per_unit_per_day == null
        ? null
        : Number(lot.storage_cost_per_unit_per_day),
    cash_requirement: Number(lot.cash_requirement || 0),
    risk_tolerance: lot.risk_tolerance == null ? null : Number(lot.risk_tolerance),
    transport_cost: Number(lot.transport_cost || 0),
    horizon_days: 0,
    floor_price: 0,
    availability_date: lot.availability_date
      ? new Date(lot.availability_date).toISOString().slice(0, 10)
      : null,
  };
}

/** Map matched buyer rows onto the optimizer's buyer payload. */
function buyersToPayload(matches) {
  return matches
    .filter((m) => m.compatible && m.buyer.offered_price > 0)
    .map((m) => ({
      id: m.buyer.id,
      name: m.buyer.name,
      buyer_type: m.buyer.buyer_type,
      price: Number(m.buyer.offered_price),
      transport_cost: Number(m.buyer.transport_cost || 0),
      capacity: m.buyer.max_quantity == null ? null : Number(m.buyer.max_quantity),
      min_quantity: Number(m.buyer.min_quantity || 0),
      requires_certification: Boolean(m.buyer.requires_certification),
      commission_rate:
        m.buyer.commission_rate == null ? null : Number(m.buyer.commission_rate),
    }));
}

async function post(path, body) {
  const response = await axios.post(`${OPTIMIZER_API_URL}${path}`, body, {
    timeout: TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
  });
  return response.data;
}

/**
 * Build a degraded result when the optimizer service is unreachable.
 *
 * Deliberately limited: a sell-now cash baseline only. No STORE, no SPLIT,
 * no allocation, no recommendation. The caller must surface
 * `optimizer_available: false`.
 */
function degradedResult(lotPayload, buyerPayload, summary, reason) {
  const baseline = calculateSellNowBaseline(lotPayload, buyerPayload, summary);

  return {
    status: 'degraded',
    optimizer_available: false,
    decision: 'UNAVAILABLE',
    decision_label: 'Recommendation unavailable',
    crop_lot: lotPayload,
    allocation: [],
    allocation_summary: null,
    reason:
      'The optimization service is not running, so no sell / store / split ' +
      'recommendation can be produced. The figure below is a plain sell-now ' +
      'calculation only — it is not a recommendation.',
    reason_factors: [],
    options: baseline.option ? [baseline.option] : [],
    best_sale_window: null,
    guardrails: [],
    limitations: [reason, ...baseline.limitations],
    degraded_mode: {
      missing_service: 'Core optimizer',
      url: OPTIMIZER_API_URL,
      what_is_missing: [
        'Sell / store / split allocation',
        'Best sale window',
        'Risk-adjusted comparison',
        'What-If simulation',
      ],
    },
  };
}

/**
 * Run the full decision. Never throws.
 */
async function decide({ lot, matches = [], summary = null, assumptions = null }) {
  const lotPayload = lotToPayload(lot);
  const buyerPayload = buyersToPayload(matches);

  try {
    const data = await post('/decide', {
      lot: lotPayload,
      buyers: buyerPayload,
      summary,
      assumptions,
    });
    return { ...data, optimizer_available: true };
  } catch (err) {
    const detail = err.response?.data?.detail || err.message;
    console.error(`[optimizer] /decide failed: ${detail}`);
    return degradedResult(
      lotPayload,
      buyerPayload,
      summary,
      `The Core optimizer service at ${OPTIMIZER_API_URL} could not be reached (${detail}).`
    );
  }
}

/** Run a What-If simulation. Never throws. */
async function whatIf({ lot, overrides, matches = [], summary = null, assumptions = null }) {
  const lotPayload = lotToPayload(lot);
  const buyerPayload = buyersToPayload(matches);

  try {
    const data = await post('/what-if', {
      lot: lotPayload,
      buyers: buyerPayload,
      summary,
      assumptions,
      overrides: overrides || {},
    });
    return { ...data, optimizer_available: true };
  } catch (err) {
    const detail = err.response?.data?.detail || err.message;
    console.error(`[optimizer] /what-if failed: ${detail}`);
    return {
      status: 'degraded',
      optimizer_available: false,
      overrides_applied: {},
      baseline: null,
      modified: null,
      comparison: {
        decision_changed: false,
        net_realisation_change: null,
        explanation:
          'What-If needs the Core optimizer service, which is not running. ' +
          `Start it (uvicorn service.app:app --port 8100 from Core/) and try again.`,
      },
      limitations: [
        `The Core optimizer service at ${OPTIMIZER_API_URL} could not be reached (${detail}).`,
      ],
    };
  }
}

async function health() {
  try {
    const response = await axios.get(`${OPTIMIZER_API_URL}/health`, { timeout: 5000 });
    return { available: true, data: response.data, url: OPTIMIZER_API_URL };
  } catch (err) {
    return { available: false, error: err.message, url: OPTIMIZER_API_URL };
  }
}

module.exports = {
  OPTIMIZER_API_URL,
  decide,
  whatIf,
  health,
  lotToPayload,
  buyersToPayload,
};
