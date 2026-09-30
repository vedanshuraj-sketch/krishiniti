/**
 * Market Data Routes — official daily mandi prices
 * ================================================
 *
 *   GET  /api/market/status    pipeline freshness + coverage
 *   POST /api/market/sync      manual sync (protected)
 *   GET  /api/market/prices    daily official series for the chart
 *   GET  /api/market/latest    latest official price + fallback flags
 *   GET  /api/market/markets   commodity/market pairs in the official cache
 *   GET  /api/market/historical  local CSV series, labelled as demo only
 *
 * Wording rule enforced here: this is DAILY REPORTED data. No route
 * returns "live" unless the record's price date is genuinely today, and
 * even then it stays qualified as a daily report.
 *
 * The data.gov.in API key is never returned by any of these routes.
 */

const express = require('express');
const authMiddleware = require('../config/authMiddleware');
const marketData = require('../services/marketData');
const mandiSync = require('../services/mandiSyncService');
const mandiClient = require('../services/mandiDataClient');
const aiml = require('../services/aimlClient');

const router = express.Router();

// ── Public: pipeline status, so the app can show a badge before login ──
router.get('/status', async (req, res) => {
  try {
    res.json(await marketData.getStatus());
  } catch (err) {
    console.error('[market] status failed:', err.message);
    res.status(500).json({ error: 'Failed to read market data status' });
  }
});

router.get('/markets', async (req, res) => {
  try {
    res.json(await marketData.getMarkets());
  } catch (err) {
    console.error('[market] markets failed:', err.message);
    res.status(500).json({ error: 'Failed to list markets' });
  }
});

/**
 * Historical AGMARKNET-derived CSV series, served by the AI/ML service.
 *
 * Policy D: this is for charts, model training and offline demo ONLY. It
 * is explicitly labelled and must never be presented as current official
 * market data, so the payload hard-codes is_current_official_data: false.
 */
router.get('/historical', async (req, res) => {
  const { commodity, market, days } = req.query;
  if (!commodity || !market) {
    return res.status(400).json({ error: 'commodity and market are required' });
  }

  const [history, meta] = await Promise.all([
    aiml.fetchHistory(commodity, market, parseInt(days, 10) || 60),
    aiml.fetchMeta(),
  ]);

  if (!history.available) {
    return res.status(200).json({
      available: false,
      is_current_official_data: false,
      label: 'Historical demo dataset',
      message: `No historical series found for ${commodity} at ${market}.`,
    });
  }

  const coverage = meta.available ? meta.data : null;

  res.json({
    available: true,
    is_current_official_data: false,
    label: 'Historical AGMARKNET-derived dataset',
    status_label: 'Historical demo dataset',
    usage_note:
      'Charts, model training and offline demo only. These are not current ' +
      'official market prices.',
    coverage_start: coverage ? coverage.coverage_start : history.data.coverage_start,
    coverage_end: coverage ? coverage.coverage_end : history.data.coverage_end,
    unit: '₹/quintal',
    commodity,
    market,
    observation_count: history.data.observation_count,
    history: history.data.history,
  });
});

// ── Authenticated reads ────────────────────────────────────────────────
router.use(authMiddleware);

router.get('/latest', async (req, res) => {
  const { commodity, market } = req.query;
  if (!commodity || !market) {
    return res.status(400).json({ error: 'commodity and market are required' });
  }
  try {
    res.json(await marketData.getLatest(commodity, market));
  } catch (err) {
    console.error('[market] latest failed:', err.message);
    res.status(500).json({ error: 'Failed to read latest market price' });
  }
});

router.get('/prices', async (req, res) => {
  const { commodity, market, days } = req.query;
  if (!commodity || !market) {
    return res.status(400).json({ error: 'commodity and market query params are required' });
  }
  try {
    res.json(await marketData.getSeries(commodity, market, days));
  } catch (err) {
    console.error('[market] prices failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch market prices' });
  }
});

router.get('/commodities', async (req, res) => {
  try {
    const data = await marketData.getMarkets();
    res.json([...new Set(data.markets.map((m) => m.commodity))].sort());
  } catch (err) {
    console.error('[market] commodities failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch commodities' });
  }
});

/**
 * Manual sync. Protected: requires a valid token AND the demo admin token
 * in X-Admin-Token, so a logged-in farmer cannot trigger API quota burn.
 */
router.post('/sync', async (req, res) => {
  const adminToken = process.env.MANDI_SYNC_ADMIN_TOKEN;
  if (adminToken && req.headers['x-admin-token'] !== adminToken) {
    return res.status(403).json({ error: 'Manual sync requires a valid X-Admin-Token header' });
  }

  if (!mandiClient.isConfigured()) {
    return res.status(503).json({
      ok: false,
      configured: false,
      error:
        'DATA_GOV_API_KEY is not configured on the backend. Obtain a free key ' +
        'at https://data.gov.in and set it in the backend environment.',
    });
  }

  const scope = {
    state: req.body?.state || mandiClient.DEFAULT_SCOPE.state,
    commodities: req.body?.commodities || mandiClient.DEFAULT_SCOPE.commodities,
    markets: req.body?.markets || mandiClient.DEFAULT_SCOPE.markets,
  };

  try {
    const result = await mandiSync.runSync({ scope, triggeredBy: 'manual' });
    res.status(result.ok ? 200 : 502).json({
      ok: result.ok,
      scope,
      run: result.run,
      // redact() guarantees the API key cannot leak through an error string.
      errors: (result.errors || []).map(mandiClient.redact),
    });
  } catch (err) {
    const message = mandiClient.redact(err.message);
    console.error('[market] manual sync failed:', message);
    res.status(500).json({ ok: false, error: message });
  }
});

module.exports = router;
