const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password, and role are required' });
  }
  if (!['farmer', 'buyer'].includes(role)) {
    return res.status(400).json({ error: "role must be 'farmer' or 'buyer'" });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4) RETURNING id, name, email, role`,
      [name, email, passwordHash, role]
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.status(201).json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      token,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Demo mode endpoints ─────────────────────────────────────────────

/**
 * GET /api/auth/demo-users
 * Returns all demo farmer accounts with their crop lot counts.
 * Only available when DEMO_MODE=true.
 */
router.get('/demo-users', async (req, res) => {
  if (process.env.DEMO_MODE !== 'true') {
    return res.status(404).json({ error: 'Demo mode is not enabled' });
  }

  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role,
              COUNT(cl.id)::int AS lot_count,
              COALESCE(SUM(cl.quantity), 0)::numeric AS total_quantity,
              ARRAY_AGG(DISTINCT cl.market) FILTER (WHERE cl.market IS NOT NULL) AS markets
         FROM users u
         LEFT JOIN crop_lots cl ON cl.farmer_id = u.id AND cl.status = 'open'
        WHERE u.role = 'farmer'
          AND u.email LIKE '%@demo.krishiniti'
        GROUP BY u.id
        ORDER BY u.id`
    );

    res.json({
      demo_mode: true,
      password_hint: 'demo1234',
      farmers: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch demo users' });
  }
});

/**
 * POST /api/auth/demo-login
 * Body: { farmer_id: number }
 * Logs in as a demo farmer without requiring a password.
 * Only available when DEMO_MODE=true.
 */
router.post('/demo-login', async (req, res) => {
  if (process.env.DEMO_MODE !== 'true') {
    return res.status(404).json({ error: 'Demo mode is not enabled' });
  }

  const { farmer_id } = req.body || {};
  if (!farmer_id) {
    return res.status(400).json({ error: 'farmer_id is required' });
  }

  try {
    const result = await pool.query(
      `SELECT id, name, email, role FROM users
        WHERE id = $1 AND role = 'farmer' AND email LIKE '%@demo.krishiniti'`,
      [farmer_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Demo farmer not found' });
    }

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Demo login failed' });
  }
});

module.exports = router;
