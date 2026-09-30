/**
 * Decision Routes
 * ===============
 *
 * The integration point:
 *
 *   RN -> Node -> [official market data]  +  [AI/ML /summary]
 *              -> buyer matching
 *              -> Core optimizer /decide
 *              -> persisted recommendation -> RN
 *
 * Data-status policy applied here:
 *   fresh  -> normal decision
 *   stale  -> decision allowed, reliability visibly reduced, warning attached
 *   none   -> NO numeric recommendation; an honest explanation instead
 *
 * The official current price, when available, overrides the historical
 * CSV's last_price as the current-price input, and the response always
 * says which was used.
 */

const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../config/authMiddleware');
const aiml = require('../services/aimlClient');
const optimizer = require('../services/optimizerClient');
const matching = require('../services/buyerMatching');
const valueChain = require('../services/valueChain');
const marketData = require('../services/marketData');
const { decorate } = require('./cropLots');

const router = express.Router();
router.use(authMiddleware);

async function loadLot(lotId, farmerId) {
  const result = await pool.query(
    'SELECT * FROM crop_lots WHERE id = $1 AND farmer_id = $2',
    [lotId, farmerId]
  );
  return result.rows[0] ? decorate(result.rows[0]) : null;
}

async function loadBuyers() {
  const result = await pool.query(
    'SELECT * FROM buyers WHERE is_available = TRUE ORDER BY name'
  );
  return result.rows;
}

/**
 * Overlay the official current price onto the AI/ML summary.
 *
 * The AI/ML forecast is trained on the historical CSV, whose last_price is
 * from 2025. When an official current price exists it is the better
 * "today" input, so we substitute it and record that we did. The forecast
 * trajectory itself still comes from the model — we do not rescale it,
 * because that would be inventing a forecast nobody produced.
 */
function applyOfficialPrice(summary, official) {
  if (!summary || !summary.forecast || summary.forecast.status !== 'success') {
    return { summary, applied: false };
  }
  if (!official || !official.available || !official.price) {
    return { summary, applied: false };
  }

  const merged = JSON.parse(JSON.stringify(summary));
  merged.forecast.last_price = official.price.modal_price;
  merged.forecast.last_date = official.price.price_date;
  merged.forecast.price_source = 'AGMARKNET official daily mandi price';
  return { summary: merged, applied: true };
}

function currentPriceBlock(official, summary, applied) {
  if (applied) {
    return {
      market_data_status: official.data_status,
      current_price: official.price.modal_price,
      current_price_min: official.price.min_price,
      current_price_max: official.price.max_price,
      current_price_source: 'AGMARKNET / Ministry of Agriculture (daily reported)',
      current_price_date: official.price.price_date,
      last_synced_at: official.latest_successful_sync,
      is_stale_data: official.data_status === 'stale',
      generated_with: official.data_status === 'stale' ? 'cached official data' : 'fresh official data',
      is_realtime: false,
    };
  }

  // Historical model-training data is useful context, but it must never be
  // substituted for a current market price in a real decision. In particular,
  // an official-data outage with an empty cache must not produce a numeric
  // SELL / STORE / SPLIT recommendation that looks current.
  return {
    market_data_status: official ? official.data_status : 'unavailable',
    current_price: null,
    current_price_min: null,
    current_price_max: null,
    current_price_source: null,
    current_price_date: null,
    last_synced_at: official ? official.latest_successful_sync : null,
    is_stale_data: false,
    generated_with: 'official market data unavailable',
    is_realtime: false,
  };
}

/**
 * GET /api/decision/:cropLotId
 * Full decision for one lot.
 */
router.get('/:cropLotId', async (req, res) => {
  const lotId = parseInt(req.params.cropLotId, 10);
  if (Number.isNaN(lotId)) return res.status(400).json({ error: 'Invalid crop lot id' });

  try {
    const lot = await loadLot(lotId, req.user.id);
    if (!lot) return res.status(404).json({ error: 'Crop lot not found' });

    const days = Math.min(30, Math.max(1, parseInt(req.query.days, 10) || 7));

    const [summaryResult, official, buyers] = await Promise.all([
      aiml.fetchSummary(lot.commodity, lot.market, days),
      marketData.getLatest(lot.commodity, lot.market).catch(() => null),
      loadBuyers(),
    ]);

    const matched = matching.matchBuyers(lot, buyers);
    const usage = valueChain.discover(lot.commodity);

    const { summary, applied } = applyOfficialPrice(summaryResult.summary, official);
    const priceBlock = currentPriceBlock(official, summaryResult.summary, applied);

    const describedSummary = aiml.describeSummary(summary);

    // ── Policy C: no official current price -> no numeric advice ─────
    // Historical AI/ML data remains presentation-only; it cannot become a
    // decision input when the official feed and its cache are unavailable.
    const noOfficialPrice = !applied;

    if (noOfficialPrice) {
      return res.json({
        crop_lot: lot,
        status: 'unavailable',
        decision: 'UNAVAILABLE',
        decision_label: 'Recommendation unavailable',
        recommendation_allowed: false,
        reason:
          'Official current market data is unavailable for this crop and market. ' +
          'No SELL / STORE / SPLIT recommendation can be calculated until the ' +
          'official feed or its cached data is available again.',
        ...priceBlock,
        market_data: official,
        ai_service_available: summaryResult.available,
        limitations: [
          summaryResult.unavailable_reason,
          ...describedSummary.notes,
        ].filter(Boolean),
        buyer_matching: matched,
        usage_discovery: usage,
        retry_available: true,
      });
    }

    const decision = await optimizer.decide({
      lot,
      matches: matched.matches,
      summary,
      assumptions: null,
    });

    // Stale data is usable but must visibly reduce confidence.
    const cautions = [];
    if (priceBlock.is_stale_data && priceBlock.market_data_status === 'stale') {
      cautions.push(
        'Recommendation uses cached market data; verify local mandi conditions before acting.'
      );
    }
    let persistedId = null;
    try {
      const saved = await pool.query(
        `INSERT INTO recommendations
           (farmer_id, crop_lot_id, decision, net_realisation, forecast_summary,
            allocation, decision_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, created_at`,
        [
          req.user.id,
          lot.id,
          decision.decision || 'UNAVAILABLE',
          decision.allocation?.reduce(
            (sum, a) => sum + (a.expected_net_realisation || 0), 0
          ) || null,
          summary ? JSON.stringify(summary) : null,
          JSON.stringify(decision.allocation || []),
          JSON.stringify({
            decision: decision.decision,
            allocation_summary: decision.allocation_summary,
            ...priceBlock,
          }),
        ]
      );
      persistedId = saved.rows[0].id;
    } catch (persistErr) {
      console.error('[decision] failed to persist recommendation:', persistErr.message);
    }

    res.json({
      crop_lot: lot,
      ...decision,
      ...priceBlock,
      market_data: official,
      ai_service_available: summaryResult.available,
      market_intelligence: describedSummary,
      cautions,
      buyer_matching: matched,
      usage_discovery: usage,
      recommendation_id: persistedId,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[decision] failed:', err);
    res.status(500).json({ error: 'Failed to generate recommendation' });
  }
});

/**
 * POST /api/decision/:cropLotId/what-if
 * Body: { overrides: { storage_cost_per_unit_per_day, quantity, ... } }
 */
router.post('/:cropLotId/what-if', async (req, res) => {
  const lotId = parseInt(req.params.cropLotId, 10);
  if (Number.isNaN(lotId)) return res.status(400).json({ error: 'Invalid crop lot id' });

  const overrides = req.body?.overrides || {};
  if (!Object.keys(overrides).length) {
    return res.status(400).json({ error: 'overrides object is required' });
  }

  try {
    const lot = await loadLot(lotId, req.user.id);
    if (!lot) return res.status(404).json({ error: 'Crop lot not found' });

    const [summaryResult, official, buyers] = await Promise.all([
      aiml.fetchSummary(lot.commodity, lot.market, 7),
      marketData.getLatest(lot.commodity, lot.market).catch(() => null),
      loadBuyers(),
    ]);

    const { summary } = applyOfficialPrice(summaryResult.summary, official);
    const matched = matching.matchBuyers(lot, buyers);

    const result = await optimizer.whatIf({
      lot,
      overrides,
      matches: matched.matches,
      summary,
    });

    res.json(result);
  } catch (err) {
    console.error('[decision] what-if failed:', err);
    res.status(500).json({ error: 'Failed to run what-if simulation' });
  }
});

/** GET /api/decision/:cropLotId/history — audit trail */
router.get('/:cropLotId/history', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, decision, net_realisation, allocation, decision_payload, created_at
         FROM recommendations
        WHERE crop_lot_id = $1 AND farmer_id = $2
        ORDER BY created_at DESC LIMIT 20`,
      [req.params.cropLotId, req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch recommendation history' });
  }
});

module.exports = router;
