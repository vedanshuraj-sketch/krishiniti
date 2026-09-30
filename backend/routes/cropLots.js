/**
 * Crop Lot Routes
 * ===============
 *
 * Persists everything the decision engine and buyer matching need:
 * commodity, quantity, unit, market, grade, availability date, storage
 * availability and cost, cash requirement, transport cost, risk tolerance,
 * and the quality assessment (method, declared grade, notes, moisture /
 * size / appearance, certificate metadata or photo metadata).
 *
 * A certificate is NOT required to create a lot. See
 * services/qualityAssessment.js for what each method may claim.
 */

const express = require('express');
const pool = require('../config/db');
const authMiddleware = require('../config/authMiddleware');
const quality = require('../services/qualityAssessment');

const router = express.Router();

const SELECT_COLUMNS = `
  id, farmer_id, commodity, market, quantity, unit, grade,
  availability_date, storage_available, storage_cost_per_unit_per_day,
  cash_requirement, transport_cost, risk_tolerance,
  quality_method, quality_notes, moisture_percent, size_description,
  appearance_description, quality_photo_count, quality_photos,
  visual_assessment, certificate_status, certificate_filename,
  certificate_mime_type, certificate_size_bytes, certificate_uploaded_at,
  status, created_at
`;

function validateCropInput({ commodity, market, quantity }) {
  if (!commodity || !market || quantity === undefined || quantity === null || quantity === '') {
    return 'commodity, market, and quantity are required';
  }
  if (typeof commodity !== 'string' || commodity.length > 100) {
    return 'commodity must be a string under 100 characters';
  }
  if (typeof market !== 'string' || market.length > 100) {
    return 'market must be a string under 100 characters';
  }
  const qty = parseFloat(quantity);
  if (Number.isNaN(qty) || qty <= 0 || qty > 100000) {
    return 'quantity must be a positive number under 100,000';
  }
  return null;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Attach the quality description so clients never re-derive the wording. */
function decorate(row) {
  if (!row) return row;
  return {
    ...row,
    quantity: Number(row.quantity),
    storage_cost_per_unit_per_day: numberOrNull(row.storage_cost_per_unit_per_day),
    cash_requirement: Number(row.cash_requirement || 0),
    transport_cost: Number(row.transport_cost || 0),
    risk_tolerance: numberOrNull(row.risk_tolerance),
    quality: quality.describeLotQuality(row),
  };
}

// ── PUBLIC: listings for the buyer Explore screen ─────────────────────
router.get('/public', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT cl.id, cl.commodity, cl.market, cl.quantity, cl.unit, cl.grade,
              cl.quality_method, cl.certificate_status, cl.quality_photo_count,
              cl.availability_date, cl.created_at,
              u.name AS farmer_name
         FROM crop_lots cl
         JOIN users u ON u.id = cl.farmer_id
        WHERE cl.status = 'open'
        ORDER BY cl.created_at DESC
        LIMIT 50`
    );
    res.json(result.rows.map(decorate));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch crop lots' });
  }
});

/** The quality methods the UI should offer, with their exact claim wording. */
router.get('/quality-methods', (req, res) => {
  res.json({
    certificate_required_to_create: false,
    visual_model_enabled: quality.VISUAL_MODEL_ENABLED,
    methods: Object.values(quality.QUALITY_METHODS).map((m) => ({
      ...m,
      example_label: quality.describeLotQuality({
        quality_method: m.key,
        certificate_status: m.key === 'certificate_upload' ? 'uploaded_unverified' : 'not_uploaded',
        quality_photo_count: m.key === 'camera_assisted' ? 1 : 0,
      }).label,
    })),
    buyer_requirements: Object.values(quality.QUALITY_REQUIREMENTS),
  });
});

router.use(authMiddleware);

// POST /api/crop-lots
router.post('/', async (req, res) => {
  const body = req.body || {};
  const err = validateCropInput(body);
  if (err) return res.status(400).json({ error: err });

  if (req.user.role !== 'farmer') {
    return res.status(403).json({ error: 'Only farmers can create crop lots' });
  }

  const q = quality.normaliseQualityInput(body);

  try {
    const result = await pool.query(
      `INSERT INTO crop_lots (
         farmer_id, commodity, market, quantity, unit, grade,
         availability_date, storage_available, storage_cost_per_unit_per_day,
         cash_requirement, transport_cost, risk_tolerance,
         quality_method, quality_notes, moisture_percent, size_description,
         appearance_description, quality_photo_count, quality_photos,
         visual_assessment, certificate_status, certificate_filename,
         certificate_mime_type, certificate_size_bytes, certificate_uploaded_at,
         status
       ) VALUES (
         $1, $2, $3, $4, COALESCE($5, 'quintal'), $6,
         $7, COALESCE($8, FALSE), $9,
         COALESCE($10, 0), COALESCE($11, 0), $12,
         $13, $14, $15, $16,
         $17, $18, $19,
         $20, $21, $22,
         $23, $24, $25,
         'open'
       ) RETURNING ${SELECT_COLUMNS}`,
      [
        req.user.id,
        body.commodity.trim(),
        body.market.trim(),
        parseFloat(body.quantity),
        body.unit,
        body.grade ? String(body.grade).slice(0, 50) : null,
        dateOrNull(body.availability_date),
        body.storage_available === undefined ? null : Boolean(body.storage_available),
        numberOrNull(body.storage_cost_per_unit_per_day),
        numberOrNull(body.cash_requirement),
        numberOrNull(body.transport_cost),
        numberOrNull(body.risk_tolerance),
        q.quality_method,
        q.quality_notes,
        q.moisture_percent,
        q.size_description,
        q.appearance_description,
        q.quality_photo_count,
        q.quality_photos,
        q.visual_assessment,
        q.certificate_status,
        q.certificate_filename,
        q.certificate_mime_type,
        q.certificate_size_bytes,
        q.certificate_uploaded_at,
      ]
    );
    res.status(201).json(decorate(result.rows[0]));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create crop lot' });
  }
});

// GET /api/crop-lots
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${SELECT_COLUMNS} FROM crop_lots
        WHERE farmer_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows.map(decorate));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch crop lots' });
  }
});

// GET /api/crop-lots/:id
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    const result = await pool.query(
      `SELECT ${SELECT_COLUMNS} FROM crop_lots WHERE id = $1 AND farmer_id = $2`,
      [id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Crop lot not found' });
    res.json(decorate(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch crop lot' });
  }
});

// PUT /api/crop-lots/:id
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const body = req.body || {};
  // Quality fields are only rewritten when the client sends a method,
  // so a partial update cannot silently downgrade recorded evidence.
  const changingQuality = Boolean(body.quality_method);
  const q = changingQuality ? quality.normaliseQualityInput(body) : null;

  try {
    const result = await pool.query(
      `UPDATE crop_lots SET
         commodity = COALESCE($1, commodity),
         market    = COALESCE($2, market),
         quantity  = COALESCE($3, quantity),
         unit      = COALESCE($4, unit),
         grade     = COALESCE($5, grade),
         availability_date = COALESCE($6, availability_date),
         storage_available = COALESCE($7, storage_available),
         storage_cost_per_unit_per_day = COALESCE($8, storage_cost_per_unit_per_day),
         cash_requirement = COALESCE($9, cash_requirement),
         transport_cost = COALESCE($10, transport_cost),
         risk_tolerance = COALESCE($11, risk_tolerance),
         quality_method = COALESCE($12, quality_method),
         quality_notes = COALESCE($13, quality_notes),
         moisture_percent = COALESCE($14, moisture_percent),
         size_description = COALESCE($15, size_description),
         appearance_description = COALESCE($16, appearance_description),
         quality_photo_count = COALESCE($17, quality_photo_count),
         quality_photos = COALESCE($18, quality_photos),
         certificate_status = COALESCE($19, certificate_status),
         certificate_filename = COALESCE($20, certificate_filename),
         certificate_uploaded_at = COALESCE($21, certificate_uploaded_at),
         status = COALESCE($22, status)
       WHERE id = $23 AND farmer_id = $24
       RETURNING ${SELECT_COLUMNS}`,
      [
        body.commodity ? body.commodity.trim() : null,
        body.market ? body.market.trim() : null,
        numberOrNull(body.quantity),
        body.unit || null,
        body.grade || null,
        dateOrNull(body.availability_date),
        body.storage_available === undefined ? null : Boolean(body.storage_available),
        numberOrNull(body.storage_cost_per_unit_per_day),
        numberOrNull(body.cash_requirement),
        numberOrNull(body.transport_cost),
        numberOrNull(body.risk_tolerance),
        q ? q.quality_method : null,
        q ? q.quality_notes : null,
        q ? q.moisture_percent : null,
        q ? q.size_description : null,
        q ? q.appearance_description : null,
        q ? q.quality_photo_count : null,
        q ? q.quality_photos : null,
        q ? q.certificate_status : null,
        q ? q.certificate_filename : null,
        q ? q.certificate_uploaded_at : null,
        body.status || null,
        id,
        req.user.id,
      ]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Crop lot not found' });
    res.json(decorate(result.rows[0]));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update crop lot' });
  }
});

module.exports = { router, decorate, SELECT_COLUMNS };
module.exports.default = router;
