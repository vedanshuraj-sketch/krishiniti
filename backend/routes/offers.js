/**
 * Offer Routes — the persisted interest / offer workflow
 *
 * Prototype state machine, no payment and no logistics integration:
 *   pending -> accepted | rejected | withdrawn
 *
 * Every record persists. There are no fire-and-forget "Interest sent"
 * alerts anywhere in this flow.
 */
const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../config/authMiddleware');
const matching = require('../services/buyerMatching');
const { decorate } = require('./cropLots');

const router = express.Router();
router.use(authMiddleware);

const ROADMAP_NOTE =
  'Payment settlement and logistics coordination are roadmap items and are ' +
  'not implemented in this prototype.';

/** POST /api/offers — farmer registers interest with a matched buyer */
router.post('/', async (req, res) => {
  const { crop_lot_id: cropLotId, buyer_id: buyerId, quantity, message } = req.body || {};

  if (!cropLotId || !buyerId) {
    return res.status(400).json({ error: 'crop_lot_id and buyer_id are required' });
  }

  try {
    const lotResult = await pool.query(
      'SELECT * FROM crop_lots WHERE id = $1 AND farmer_id = $2',
      [cropLotId, req.user.id]
    );
    if (!lotResult.rows.length) return res.status(404).json({ error: 'Crop lot not found' });
    const lot = decorate(lotResult.rows[0]);

    const buyerResult = await pool.query('SELECT * FROM buyers WHERE id = $1', [buyerId]);
    if (!buyerResult.rows.length) return res.status(404).json({ error: 'Buyer not found' });
    const buyer = buyerResult.rows[0];

    // Re-score at submission time so the stored reasons reflect the lot as
    // it is now, not as it was when the list was rendered.
    const scored = matching.scoreBuyer(
      lot,
      buyer,
      lot.quality,
      []
    );

    const offerQuantity = Number(quantity) > 0 ? Number(quantity) : Number(lot.quantity);

    const result = await pool.query(
      `INSERT INTO offers
         (crop_lot_id, buyer_id, farmer_id, initiated_by, status, quantity, unit,
          indicative_price, match_score, match_reasons, message, is_demo)
       VALUES ($1, $2, $3, 'farmer', 'pending', $4, $5, $6, $7, $8, $9, TRUE)
       RETURNING *`,
      [
        cropLotId,
        buyerId,
        req.user.id,
        offerQuantity,
        lot.unit || 'quintal',
        buyer.offered_price,
        scored.match_score,
        JSON.stringify({
          match_reasons: scored.match_reasons,
          incompatibility_reasons: scored.incompatibility_reasons,
          quality_compatibility: scored.quality_compatibility,
        }),
        message ? String(message).slice(0, 1000) : null,
      ]
    );

    res.status(201).json({
      offer: result.rows[0],
      buyer: { ...buyer, is_demo: true },
      data_label: 'Demo buyer data for prototype.',
      status_explanation:
        'Your interest has been recorded and saved. The buyer response below ' +
        'is a prototype state change, not a real commercial commitment.',
      roadmap_note: ROADMAP_NOTE,
      compatible: scored.compatible,
      quality_compatibility: scored.quality_compatibility,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create offer' });
  }
});

/** GET /api/offers — the farmer's offers */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, b.name AS buyer_name, b.buyer_type, b.market AS buyer_market,
              cl.commodity, cl.market AS lot_market
         FROM offers o
         LEFT JOIN buyers b ON b.id = o.buyer_id
         JOIN crop_lots cl ON cl.id = o.crop_lot_id
        WHERE o.farmer_id = $1
        ORDER BY o.created_at DESC`,
      [req.user.id]
    );
    res.json({
      count: result.rows.length,
      roadmap_note: ROADMAP_NOTE,
      offers: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch offers' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.*, b.name AS buyer_name, b.buyer_type, b.intended_use,
              b.market AS buyer_market, cl.commodity, cl.quantity AS lot_quantity
         FROM offers o
         LEFT JOIN buyers b ON b.id = o.buyer_id
         JOIN crop_lots cl ON cl.id = o.crop_lot_id
        WHERE o.id = $1 AND o.farmer_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Offer not found' });
    res.json({ offer: result.rows[0], roadmap_note: ROADMAP_NOTE });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch offer' });
  }
});

/**
 * PATCH /api/offers/:id/status — mock accept / reject / withdraw
 * Labelled as a simulated buyer response; no real buyer is involved.
 */
const ALLOWED = {
  pending: ['accepted', 'rejected', 'withdrawn'],
  accepted: ['withdrawn'],
  rejected: [],
  withdrawn: [],
};

router.patch('/:id/status', async (req, res) => {
  const { status } = req.body || {};
  if (!['accepted', 'rejected', 'withdrawn'].includes(status)) {
    return res.status(400).json({ error: "status must be 'accepted', 'rejected' or 'withdrawn'" });
  }

  try {
    const current = await pool.query(
      'SELECT * FROM offers WHERE id = $1 AND farmer_id = $2',
      [req.params.id, req.user.id]
    );
    if (!current.rows.length) return res.status(404).json({ error: 'Offer not found' });

    const from = current.rows[0].status;
    if (!ALLOWED[from].includes(status)) {
      return res.status(409).json({
        error: `Cannot move an offer from '${from}' to '${status}'.`,
        allowed_transitions: ALLOWED[from],
      });
    }

    const result = await pool.query(
      `UPDATE offers SET status = $1, updated_at = NOW()
        WHERE id = $2 AND farmer_id = $3 RETURNING *`,
      [status, req.params.id, req.user.id]
    );

    res.json({
      offer: result.rows[0],
      previous_status: from,
      simulated:
        status === 'withdrawn'
          ? false
          : true,
      note:
        status === 'withdrawn'
          ? 'You withdrew this interest.'
          : `Simulated buyer response for the prototype demo. No real buyer ` +
            `has ${status} anything.`,
      roadmap_note: ROADMAP_NOTE,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update offer status' });
  }
});

module.exports = router;
