const jwt = require('jsonwebtoken');
const pool = require('./db');

/**
 * Auth middleware with DEMO_MODE support.
 *
 * When DEMO_MODE=true:
 *   - If a valid JWT is provided, it works normally.
 *   - If no token is provided BUT the query param ?demo_user_id=N is present,
 *     the middleware loads that user from the DB and assigns it to req.user.
 *   - If neither is present, falls back to the first demo farmer in the DB.
 *
 * This lets the prototype presentation skip login entirely while keeping
 * the real auth flow available.
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  // ── Normal JWT path ─────────────────────────────────────────────
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded; // { id, role }
      return next();
    } catch (err) {
      // If DEMO_MODE is on, don't fail on bad tokens — fall through
      if (process.env.DEMO_MODE !== 'true') {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
    }
  }

  // ── DEMO_MODE bypass ───────────────────────────────────────────
  if (process.env.DEMO_MODE === 'true') {
    const demoUserId = req.query.demo_user_id || req.headers['x-demo-user-id'];

    if (demoUserId) {
      // Load specific demo user
      pool.query('SELECT id, role FROM users WHERE id = $1', [parseInt(demoUserId, 10)])
        .then((result) => {
          if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Demo user not found' });
          }
          req.user = { id: result.rows[0].id, role: result.rows[0].role };
          next();
        })
        .catch((err) => {
          console.error('[demo] failed to load user:', err.message);
          res.status(500).json({ error: 'Failed to load demo user' });
        });
      return;
    }

    // Fall back to first farmer in DB
    pool.query("SELECT id, role FROM users WHERE role = 'farmer' ORDER BY id LIMIT 1")
      .then((result) => {
        if (result.rows.length === 0) {
          return res.status(503).json({
            error: 'No demo farmers found. Run: node scripts/seedDemoData.js',
          });
        }
        req.user = { id: result.rows[0].id, role: result.rows[0].role };
        next();
      })
      .catch((err) => {
        console.error('[demo] failed to load default farmer:', err.message);
        res.status(500).json({ error: 'Failed to load demo user' });
      });
    return;
  }

  // ── No token, no demo mode ─────────────────────────────────────
  return res.status(401).json({ error: 'No token provided' });
}

module.exports = authMiddleware;
