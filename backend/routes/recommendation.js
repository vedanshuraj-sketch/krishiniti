/**
 * Legacy /api/recommendation routes.
 *
 * Kept so any existing client keeps working. The old handler read an AI/ML
 * response shape that never existed (forecast.current_price,
 * summary.confidence, summary.risk_score, summary.anomaly_detected) and
 * produced NaN-backed advice. All real logic now lives in routes/decision.js
 * against the correct nested contract; this module simply forwards to it.
 */
const express = require('express');
const decisionRouter = require('./decision');

const router = express.Router();
router.use((req, res, next) => {
  res.set('X-Krishiniti-Deprecation', 'Use /api/decision instead of /api/recommendation');
  next();
});
router.use(decisionRouter);

module.exports = router;
