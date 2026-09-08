const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../config/authMiddleware');

const router = express.Router();
router.use(authMiddleware);

// POST /api/crop-lots — create a new crop lot for the logged-in farmer
router.post('/', async (req, res) => {
  const { commodity, market, quantity, unit } = req.body;
  if (!commodity || !market || !quantity) {
    return res.status(400).json({ error: 'commodity, market, and quantity are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO crop_lots (farmer_id, commodity, market, quantity, unit)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'quintal')) RETURNING *`,
      [req.user.id, commodity, market, quantity, unit]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create crop lot' });
  }
});

// GET /api/crop-lots — list all crop lots for the logged-in farmer
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM crop_lots WHERE farmer_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch crop lots' });
  }
});

// GET /api/crop-lots/:id — get one crop lot (must belong to the logged-in farmer)
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM crop_lots WHERE id = $1 AND farmer_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Crop lot not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch crop lot' });
  }
});

// PUT /api/crop-lots/:id — update a crop lot
router.put('/:id', async (req, res) => {
  const { commodity, market, quantity, unit } = req.body;

  try {
    const result = await pool.query(
      `UPDATE crop_lots
       SET commodity = COALESCE($1, commodity),
           market = COALESCE($2, market),
           quantity = COALESCE($3, quantity),
           unit = COALESCE($4, unit)
       WHERE id = $5 AND farmer_id = $6
       RETURNING *`,
      [commodity, market, quantity, unit, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Crop lot not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update crop lot' });
  }
});

module.exports = router;
