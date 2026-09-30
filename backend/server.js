require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const cropLotRoutes = require('./routes/cropLots').router;
const marketRoutes = require('./routes/market');
const decisionRoutes = require('./routes/decision');
const recommendationRoutes = require('./routes/recommendation');
const buyerRoutes = require('./routes/buyers');
const offerRoutes = require('./routes/offers');
const usageRoutes = require('./routes/usage');

const mandiSync = require('./services/mandiSyncService');
const mandiClient = require('./services/mandiDataClient');
const optimizerClient = require('./services/optimizerClient');
const valueChain = require('./services/valueChain');

const app = express();

// ── Security headers (XSS, clickjacking, sniffing protection) ─────────────────
app.use(helmet());

// ── CORS: only allow requests from the Expo / production app ──────────────────
const ALLOWED_ORIGINS = [
  'https://krishiniti-backend-production.up.railway.app',
  'http://localhost:8081',   // Expo dev (default)
  'http://localhost:8082',   // Expo dev (alt)
  'http://localhost:8083',   // Expo dev (alt)
  'http://localhost:8084',   // Expo dev (alt)
  'http://localhost:8085',   // Expo dev (alt)
  'http://localhost:19000',  // Expo Go
  'http://localhost:19006',  // Expo web (legacy)
  'exp://',                  // Expo Go native
];
// Also allow any origin explicitly set in the environment (CI / staging)
if (process.env.EXTRA_CORS_ORIGIN) {
  ALLOWED_ORIGINS.push(process.env.EXTRA_CORS_ORIGIN);
}
app.use(cors({
  origin: (origin, callback) => {
    // Allow mobile apps (no origin header) and allowed origins
    if (!origin || ALLOWED_ORIGINS.some(o => origin.startsWith(o))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Body size limit (prevents large payload attacks) ──────────────────────────
app.use(express.json({ limit: '50kb' }));

// ── Rate limiting ──────────────────────────────────────────────────────────────
// Auth endpoints: max 10 requests per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API: max 100 requests per minute per IP
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth', authLimiter);
app.use('/api', generalLimiter);

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'krishiniti-backend' });
});

/**
 * Dependency health. Reports which services are actually reachable so a
 * degraded demo is visible rather than silently wrong.
 * Never exposes the data.gov.in API key — only whether one is configured.
 */
app.get('/health/dependencies', async (req, res) => {
  const optimizer = await optimizerClient.health();
  res.json({
    backend: 'ok',
    ai_ml: { url: process.env.AI_ML_API_URL || 'http://localhost:8000' },
    optimizer,
    value_chain: valueChain.status(),
    official_market_data: {
      api_key_configured: mandiClient.isConfigured(),
      scheduled_sync_enabled: mandiSync.SYNC_ENABLED,
      schedule: mandiSync.SYNC_CRON,
      stale_after_hours: mandiSync.STALE_HOURS,
      source: 'data.gov.in / AGMARKNET',
      is_realtime: false,
    },
  });
});

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/crop-lots', cropLotRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/decision', decisionRoutes);
app.use('/api/recommendation', recommendationRoutes); // legacy alias
app.use('/api/buyers', buyerRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/usage-discovery', usageRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS: origin not allowed' });
  }
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`KRISHINITI backend running on port ${PORT}`);
  console.log(`AI/ML API:          ${process.env.AI_ML_API_URL || 'http://localhost:8000'}`);
  console.log(`Core optimizer API: ${optimizerClient.OPTIMIZER_API_URL}`);
  console.log(
    `Official mandi data: ${mandiClient.isConfigured() ? 'API key configured' : 'NO API KEY — official sync disabled'}`
  );

  // Startup must never depend on, or fail because of, a data sync.
  try {
    mandiSync.startScheduler();
  } catch (err) {
    console.error('[mandi] scheduler failed to start:', err.message);
  }
});
