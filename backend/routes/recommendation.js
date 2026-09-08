const express = require('express');
const axios = require('axios');
const pool = require('../config/db');
const authMiddleware = require('../config/authMiddleware');
const decisionEngine = require('../decisionEngine');

const router = express.Router();
router.use(authMiddleware);

// GET /api/recommendation/:cropLotId
// This is THE integration point: Frontend -> Backend -> AI/ML API -> Decision Engine -> Database -> Frontend
router.get('/:cropLotId', async (req, res) => {
  try {
    // 1. Load the crop lot (must belong to the logged-in farmer)
    const lotResult = await pool.query(
      'SELECT * FROM crop_lots WHERE id = $1 AND farmer_id = $2',
      [req.params.cropLotId, req.user.id]
    );
    if (lotResult.rows.length === 0) {
      return res.status(404).json({ error: 'Crop lot not found' });
    }
    const lot = lotResult.rows[0];

    // 2. Call the AI/ML API's /summary endpoint
    const days = req.query.days || 7;
    let summary;
    try {
      const aiResponse = await axios.get(`${process.env.AI_ML_API_URL}/summary`, {
        params: { commodity: lot.commodity, market: lot.market, days },
        timeout: 10000,
      });
      summary = aiResponse.data;
    } catch (aiErr) {
      console.error('AI/ML API call failed:', aiErr.message);
      return res.status(502).json({
        error: 'Could not reach AI/ML forecasting service',
        detail: aiErr.response?.data || aiErr.message,
      });
    }

    // 3. Run it through the Decision Engine
    const result = decisionEngine.decide(summary, lot.quantity);

    // 4. Persist to recommendations table (optional history)
    const saved = await pool.query(
      `INSERT INTO recommendations (farmer_id, crop_lot_id, decision, net_realisation, forecast_summary)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [req.user.id, lot.id, result.decision, result.net_realisation, summary]
    );

    // 5. Return one clean response to the Frontend
    res.json({
      crop_lot: { id: lot.id, commodity: lot.commodity, market: lot.market, quantity: lot.quantity },
      forecast: summary.forecast,
      confidence: summary.confidence,
      risk_score: summary.risk_score,
      anomaly_detected: summary.anomaly_detected,
      explanation: summary.overall_explanation,
      recommendation: {
        decision: result.decision,
        reason: result.reason,
        net_realisation: result.net_realisation,
        price_change_percent: result.price_change_percent,
      },
      recommendation_id: saved.rows[0].id,
      generated_at: saved.rows[0].created_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate recommendation' });
  }
});

// POST /api/recommendation/:cropLotId/what-if
// Body: { extraDays: number }
router.post('/:cropLotId/what-if', async (req, res) => {
  const { extraDays } = req.body;
  if (!extraDays || extraDays <= 0) {
    return res.status(400).json({ error: 'extraDays must be a positive number' });
  }

  try {
    const lotResult = await pool.query(
      'SELECT * FROM crop_lots WHERE id = $1 AND farmer_id = $2',
      [req.params.cropLotId, req.user.id]
    );
    if (lotResult.rows.length === 0) {
      return res.status(404).json({ error: 'Crop lot not found' });
    }
    const lot = lotResult.rows[0];

    const aiResponse = await axios.get(`${process.env.AI_ML_API_URL}/summary`, {
      params: { commodity: lot.commodity, market: lot.market, days: 7 },
      timeout: 10000,
    });

    const simulation = decisionEngine.whatIf(aiResponse.data, lot.quantity, extraDays);
    res.json(simulation);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to run what-if simulation' });
  }
});

// GET /api/recommendation/:cropLotId/history
router.get('/:cropLotId/history', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, decision, net_realisation, created_at
       FROM recommendations
       WHERE crop_lot_id = $1 AND farmer_id = $2
       ORDER BY created_at DESC`,
      [req.params.cropLotId, req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch recommendation history' });
  }
});

module.exports = router;
