/**
 * Buyer Routes — seeded demo buyers and deterministic matching
 *
 * Every response carries `data_label: "Demo buyer data for prototype."`
 * and `is_demo: true`. There is no way to turn that off.
 */
const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../config/authMiddleware');
const matching = require('../services/buyerMatching');
const { decorate } = require('./cropLots');

const router = express.Router();

const DATA_LABEL = 'Demo buyer data for prototype.';

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM buyers WHERE is_available = TRUE ORDER BY name'
    );
    res.json({
      data_label: DATA_LABEL,
      is_demo: true,
      disclaimer:
        'These buyers are fabricated for the prototype. No organisation ' +
        'listed has been contacted and no price is a real quotation.',
      count: result.rows.length,
      buyers: result.rows.map((b) => ({ ...b, is_demo: true })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch buyers' });
  }
});

router.use(authMiddleware);

/** GET /api/buyers/match/:cropLotId — ranked, explained matches */
router.get('/match/:cropLotId', async (req, res) => {
  const lotId = parseInt(req.params.cropLotId, 10);
  if (Number.isNaN(lotId)) return res.status(400).json({ error: 'Invalid crop lot id' });

  try {
    const lotResult = await pool.query(
      'SELECT * FROM crop_lots WHERE id = $1 AND farmer_id = $2',
      [lotId, req.user.id]
    );
    if (!lotResult.rows.length) return res.status(404).json({ error: 'Crop lot not found' });

    const lot = decorate(lotResult.rows[0]);
    const buyers = await pool.query(
      'SELECT * FROM buyers WHERE is_available = TRUE ORDER BY name'
    );

    res.json({
      crop_lot: {
        id: lot.id,
        commodity: lot.commodity,
        market: lot.market,
        quantity: lot.quantity,
        unit: lot.unit,
        grade: lot.grade,
      },
      ...matching.matchBuyers(lot, buyers.rows),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to match buyers' });
  }
});

module.exports = router;
