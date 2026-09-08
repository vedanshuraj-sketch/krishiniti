const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../config/authMiddleware');

const router = express.Router();
router.use(authMiddleware);

// GET /api/market/prices?commodity=Wheat&market=Vadodara&days=30
// Returns raw historical price data for the Frontend's charts.
// NOTE: this reads Database.market_prices, a SEPARATE copy of data from
// the one the AI/ML API uses internally for forecasting. Same source
// (AGMARKNET), independently ingested — expect minor drift between the
// two if one is refreshed and the other isn't.
router.get('/prices', async (req, res) => {
  const { commodity, market, days } = req.query;
  if (!commodity || !market) {
    return res.status(400).json({ error: 'commodity and market query params are required' });
  }
  const lookbackDays = parseInt(days, 10) || 30;

  try {
    const result = await pool.query(
      `SELECT commodity, market, price, price_date
       FROM market_prices
       WHERE commodity = $1 AND market = $2
         AND price_date >= CURRENT_DATE - $3::int
       ORDER BY price_date ASC`,
      [commodity, market, lookbackDays]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch market prices' });
  }
});

// GET /api/market/commodities — distinct list of commodities available, for dropdowns
router.get('/commodities', async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT commodity FROM market_prices ORDER BY commodity');
    res.json(result.rows.map((r) => r.commodity));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch commodities' });
  }
});

module.exports = router;
