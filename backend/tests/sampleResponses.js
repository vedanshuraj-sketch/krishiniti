/**
 * Generates the three required sample responses for the fallback policy.
 *
 *   node tests/sampleResponses.js
 *
 * The data.gov.in API and PostgreSQL are both simulated (see
 * tests/harness.js). These are real outputs of the real code paths — the
 * inputs are simulated, the responses are not hand-written.
 */
const h = require('./harness');

process.env.DATA_GOV_API_KEY = 'SIMULATED-KEY-abcdef123456';
process.env.MANDI_DATA_STALE_HOURS = '36';

const marketData = require('../services/marketData');
const HOUR = 3600000;

const PRICE_ROW = {
  commodity: 'Groundnut', variety: 'Bold', state: 'Gujarat', district: 'Rajkot',
  market: 'Rajkot', min_price: 4800, max_price: 5400, modal_price: 5100,
  price_date: '2026-09-18', source: 'AGMARKNET',
  fetched_at: new Date('2026-09-19T08:04:00Z'),
};

function mock({ priceRow, lastSuccess, lastRun }) {
  h.dbStub._handler = async (text) => {
    if (text.includes('FROM market_prices')) return { rows: priceRow ? [priceRow] : [] };
    if (text.includes("status IN ('success', 'partial')")) return { rows: lastSuccess ? [lastSuccess] : [] };
    if (text.includes('FROM market_data_sync_runs')) return { rows: lastRun ? [lastRun] : [] };
    return { rows: [] };
  };
}

function show(title, scenario, payload) {
  console.log('\n' + '━'.repeat(70));
  console.log(title);
  console.log('━'.repeat(70));
  console.log('Scenario: ' + scenario);
  console.log('\nGET /api/market/latest?commodity=Groundnut&market=Rajkot\n');
  console.log(JSON.stringify(payload, null, 2));
}

(async () => {
  // ── A. API succeeds ───────────────────────────────────────────────
  mock({
    priceRow: PRICE_ROW,
    lastSuccess: { completed_at: new Date(Date.now() - 3 * HOUR), status: 'success' },
    lastRun: { started_at: new Date(Date.now() - 3 * HOUR), status: 'success' },
  });
  show(
    'SAMPLE 1 — SUCCESSFUL OFFICIAL FETCH (data_status = fresh)',
    'The scheduled sync completed 3 hours ago and stored Rajkot Groundnut prices.',
    await marketData.getLatest('Groundnut', 'Rajkot'),
  );

  // ── B. API fails, cache exists ────────────────────────────────────
  mock({
    priceRow: PRICE_ROW,
    lastSuccess: { completed_at: new Date(Date.now() - 52 * HOUR), status: 'success' },
    lastRun: {
      started_at: new Date(Date.now() - 20 * 60000), status: 'failed',
      error_message: 'Groundnut: data.gov.in returned HTTP 503',
    },
  });
  show(
    'SAMPLE 2 — API FAILURE WITH CACHED DATA (data_status = stale)',
    'data.gov.in is returning HTTP 503. The last successful sync was 52 hours ago, ' +
      'past the 36-hour freshness window, but cached official rows exist.',
    await marketData.getLatest('Groundnut', 'Rajkot'),
  );

  // ── C. API fails, no cache ────────────────────────────────────────
  mock({
    priceRow: null,
    lastSuccess: null,
    lastRun: {
      started_at: new Date(Date.now() - 5 * 60000), status: 'failed',
      error_message: 'Cotton: data.gov.in request failed (ECONNABORTED)',
    },
  });
  show(
    'SAMPLE 3 — API FAILURE WITH NO CACHED DATA (data_status = unavailable)',
    'The API has never succeeded for this commodity/market pair, so nothing is cached. ' +
      'No price is invented and price-based recommendations are switched off.',
    await marketData.getLatest('Cotton', 'Bhavnagar'),
  );

  console.log('\n' + '━'.repeat(70));
  console.log('All three responses produced by the real fallback code path.');
  console.log('The data.gov.in API and PostgreSQL were simulated; no live call was made.');
  console.log('━'.repeat(70));
})();
