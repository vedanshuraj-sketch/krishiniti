/**
 * Market Data Reader
 * ==================
 *
 * The one place that decides what current-price data the app is allowed to
 * show, and with what status. Implements the fallback policy exactly:
 *
 *   A. Sync succeeded recently        -> data_status = "fresh"
 *   B. Sync failing, cached rows exist-> data_status = "stale", is_fallback
 *   C. No official rows at all        -> data_status = "unavailable",
 *                                        price-based recommendations OFF
 *   D. The local historical CSV is for charts / training / offline demo
 *      only, always labelled "Historical AGMARKNET-derived dataset", and
 *      is NEVER returned as current official market data.
 *
 * Nothing here ever invents, interpolates or carries forward a price.
 */

const pool = require('../config/db');
const sync = require('./mandiSyncService');

const SOURCE_LABEL = 'AGMARKNET / Ministry of Agriculture';

const STATUS_LABELS = {
  fresh: 'Official daily mandi data',
  stale: 'Latest cached official mandi data',
  unavailable: 'Official market data temporarily unavailable',
  historical_demo: 'Historical demo dataset',
};

// ── In-memory cache for the live status response ──────────────────────────
// Prevents hammering data.gov.in on every page load; TTL = 5 minutes.
const LIVE_STATUS_CACHE_TTL_MS = 5 * 60 * 1000;
let _liveStatusCache = null; // { result, expiresAt }

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch live status from data.gov.in with retry+backoff. Caches success. */
async function fetchLiveStatusWithRetry() {
  // Serve from cache if still fresh
  if (_liveStatusCache && Date.now() < _liveStatusCache.expiresAt) {
    return _liveStatusCache.result;
  }

  const axios = require('axios');
  const apiKey = process.env.DATA_GOV_API_KEY;
  const resourceId = process.env.DATA_GOV_RESOURCE_ID || '9ef84268-d588-465a-a308-a864a43d0070';
  const baseUrl = process.env.DATA_GOV_BASE_URL || 'https://api.data.gov.in/resource';
  const scope = {
    state: process.env.MANDI_SYNC_STATE || 'Gujarat',
    commodities: (process.env.MANDI_SYNC_COMMODITIES || 'Groundnut').split(',').map(s => s.trim()),
    markets: (process.env.MANDI_SYNC_MARKETS || 'Rajkot,Gondal,Junagadh,Amreli,Jamnagar').split(',').map(s => s.trim()),
  };

  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 2000;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const params = {
        'api-key': apiKey,
        format: 'json',
        limit: 100,
        offset: 0,
        'filters[state]': scope.state,
        'filters[commodity]': scope.commodities[0],
      };
      const response = await axios.get(`${baseUrl}/${resourceId}`, { params, timeout: 20000 });
      const records = response.data?.records || [];

      // Deduplicate into commodity×market coverage rows
      const byPair = {};
      for (const r of records) {
        const commodity = r.commodity || r.Commodity || '';
        const market    = r.market    || r.Market    || '';
        const priceDate = r.arrival_date || r.price_date || r.date || '';
        if (!commodity || !market) continue;
        const key = `${commodity}||${market}`;
        if (!byPair[key] || priceDate > byPair[key].latest_price_date) {
          byPair[key] = { commodity, market, observations: 1, latest_price_date: priceDate };
        }
      }
      const coverageRows = Object.values(byPair)
        .sort((a, b) => b.latest_price_date.localeCompare(a.latest_price_date));

      const result = {
        source: 'AGMARKNET',
        source_label: SOURCE_LABEL,
        is_realtime: false,
        data_kind: 'Daily reported mandi prices from data.gov.in / AGMARKNET.',
        sync_enabled: false,
        stale_after_hours: sync.STALE_HOURS,
        data_status: coverageRows.length > 0 ? 'fresh' : 'unavailable',
        status_label: coverageRows.length > 0 ? STATUS_LABELS.fresh : STATUS_LABELS.unavailable,
        is_fallback: false,
        message: coverageRows.length > 0
          ? `Live fetch: ${coverageRows.length} market pair(s) for ${scope.commodities[0]} in ${scope.state}.`
          : 'No records returned from data.gov.in for the configured scope.',
        latest_successful_sync: new Date().toISOString(),
        latest_available_price_date: coverageRows[0]?.latest_price_date || null,
        coverage: coverageRows,
      };

      // Cache the successful result
      _liveStatusCache = { result, expiresAt: Date.now() + LIVE_STATUS_CACHE_TTL_MS };
      return result;

    } catch (err) {
      lastError = err;
      const errMsg = err?.response?.data?.error || err.message || '';
      const isRateLimit = errMsg.toLowerCase().includes('rate limit') ||
                          err?.response?.status === 429;

      if (attempt < MAX_RETRIES) {
        // Exponential backoff + jitter: 2s, 4s, 8s (+ up to 1s random)
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 1000;
        console.warn(`[market] live fetch attempt ${attempt} failed (${errMsg}), retrying in ${Math.round(delay)}ms...`);
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  const errMsg = lastError?.response?.data?.error || lastError?.message || 'Unknown error';
  return {
    source: 'AGMARKNET',
    source_label: SOURCE_LABEL,
    is_realtime: false,
    data_kind: 'Daily reported mandi prices from data.gov.in.',
    sync_enabled: false,
    stale_after_hours: sync.STALE_HOURS,
    data_status: 'unavailable',
    status_label: STATUS_LABELS.unavailable,
    is_fallback: true,
    fallback_reason: 'live_fetch_failed',
    message: `Could not reach data.gov.in after ${MAX_RETRIES} attempts: ${errMsg}. Try refreshing in a minute.`,
    latest_successful_sync: null,
    latest_available_price_date: null,
    coverage: [],
  };
}

/**
 * Falls back to the AI/ML service's pre-loaded AGMARKNET historical data
 * when the live data.gov.in API is unavailable. Clearly labelled as
 * "historical demo dataset" — never presented as today's prices.
 */
async function fetchAiMlFallbackStatus() {
  const axios = require('axios');
  const aiMlUrl = process.env.AI_ML_API_URL || 'http://localhost:8000';
  const scope = {
    state: process.env.MANDI_SYNC_STATE || 'Gujarat',
    commodities: (process.env.MANDI_SYNC_COMMODITIES || 'Groundnut').split(',').map(s => s.trim()),
  };

  try {
    // Fetch /meta for dataset overview and /markets for each commodity
    const metaRes = await axios.get(`${aiMlUrl}/meta`, { timeout: 8000 });
    const meta = metaRes.data;

    const coverageRows = [];
    for (const commodity of scope.commodities) {
      try {
        const mktRes = await axios.get(`${aiMlUrl}/markets`, {
          params: { commodity, limit: 10 },
          timeout: 8000,
        });
        const markets = mktRes.data?.markets || [];
        for (const m of markets) {
          coverageRows.push({
            commodity,
            market: m.market,
            observations: m.observations,
            latest_price_date: m.latest_date || meta.coverage_end || '',
          });
        }
      } catch { /* skip this commodity if /markets fails */ }
    }

    if (coverageRows.length === 0) return null; // signal: no usable data

    return {
      source: 'AGMARKNET',
      source_label: 'AGMARKNET (historical demo dataset)',
      is_realtime: false,
      data_kind: 'Historical AGMARKNET-derived data loaded for demo. Not today\'s prices.',
      sync_enabled: false,
      stale_after_hours: 36,
      data_status: 'stale',
      status_label: 'Historical demo dataset — daily live data requires API key',
      is_fallback: true,
      fallback_reason: 'live_api_unavailable_using_demo_data',
      message: `Demo data: ${coverageRows.length} market(s) for ${scope.commodities.join(', ')} loaded from pre-built AGMARKNET dataset. Register at data.gov.in to enable live daily prices.`,
      latest_successful_sync: null,
      latest_available_price_date: coverageRows[0]?.latest_price_date || null,
      coverage: coverageRows,
    };
  } catch {
    return null;
  }
}

/**
 * Human wording rules. "Live" is only ever permitted when the record's
 * price date is genuinely today, and even then it stays qualified as a
 * daily report.
 */
function priceRecency(priceDate) {
  if (!priceDate) return { is_today: false, label: 'Latest reported market price' };
  const date = new Date(priceDate).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return {
    is_today: date === today,
    label:
      date === today
        ? "Today's reported mandi price (daily report)"
        : 'Latest reported market price',
  };
}

async function latestOfficialRow(commodity, market) {
  const result = await pool.query(
    `SELECT commodity, variety, state, district, market,
            min_price, max_price, modal_price, price_date, source, fetched_at
       FROM market_prices
      WHERE source = 'AGMARKNET'
        AND lower(trim(commodity)) = lower(trim($1))
        AND lower(trim(market))    = lower(trim($2))
        AND modal_price IS NOT NULL
      ORDER BY price_date DESC, fetched_at DESC NULLS LAST
      LIMIT 1`,
    [commodity, market]
  );
  return result.rows[0] || null;
}

/**
 * Latest official price for one commodity-market pair, with status.
 *
 * Always resolves — never throws on a missing row, and never substitutes a
 * value from the historical CSV.
 */
async function getLatest(commodity, market) {
  const [row, lastSuccess, lastRun] = await Promise.all([
    latestOfficialRow(commodity, market),
    sync.latestSuccessfulRun(),
    sync.latestRun(),
  ]);

  const classification = sync.classify({
    lastSuccess,
    hasCachedRows: Boolean(row),
  });

  const base = {
    commodity,
    market,
    source: 'AGMARKNET',
    source_label: SOURCE_LABEL,
    unit: '₹/quintal',
    is_realtime: false,
    data_kind: 'daily reported mandi price',
    status_label: STATUS_LABELS[classification.data_status],
    latest_successful_sync: lastSuccess ? lastSuccess.completed_at : null,
    last_sync_attempt: lastRun ? lastRun.started_at : null,
    last_sync_status: lastRun ? lastRun.status : null,
    stale_after_hours: sync.STALE_HOURS,
    ...classification,
  };

  if (!row) {
    return {
      ...base,
      available: false,
      price: null,
      recommendation_allowed: false,
      recommendation_blocked_reason:
        'No official current price is available for this crop and market, so ' +
        'no price-based recommendation can be generated.',
    };
  }

  const recency = priceRecency(row.price_date);

  return {
    ...base,
    available: true,
    price: {
      min_price: row.min_price == null ? null : Number(row.min_price),
      max_price: row.max_price == null ? null : Number(row.max_price),
      modal_price: Number(row.modal_price),
      price_date: row.price_date,
      variety: row.variety || null,
      district: row.district || null,
      state: row.state || null,
      fetched_at: row.fetched_at,
    },
    price_date: row.price_date,
    price_recency_label: recency.label,
    is_today: recency.is_today,
    // A cautious decision is allowed on stale data, with a visible warning.
    recommendation_allowed: true,
    recommendation_caution:
      classification.data_status === 'stale'
        ? 'Recommendation uses cached market data; verify local mandi conditions before acting.'
        : null,
  };
}

/** Daily official series for the chart. Returns [] rather than inventing rows. */
async function getSeries(commodity, market, days = 30) {
  const lookback = Math.max(1, Math.min(365, parseInt(days, 10) || 30));

  const result = await pool.query(
    `SELECT commodity, market, variety, district, state,
            min_price, max_price, modal_price, price_date, source, fetched_at
       FROM market_prices
      WHERE source = 'AGMARKNET'
        AND lower(trim(commodity)) = lower(trim($1))
        AND lower(trim(market))    = lower(trim($2))
        AND price_date >= CURRENT_DATE - $3::int
      ORDER BY price_date ASC`,
    [commodity, market, lookback]
  );

  const [lastSuccess] = await Promise.all([sync.latestSuccessfulRun()]);
  const classification = sync.classify({
    lastSuccess,
    hasCachedRows: result.rows.length > 0,
  });

  return {
    commodity,
    market,
    source: 'AGMARKNET',
    source_label: SOURCE_LABEL,
    unit: '₹/quintal',
    is_realtime: false,
    lookback_days: lookback,
    status_label: STATUS_LABELS[classification.data_status],
    latest_successful_sync: lastSuccess ? lastSuccess.completed_at : null,
    ...classification,
    observation_count: result.rows.length,
    prices: result.rows.map((r) => ({
      price_date: r.price_date,
      min_price: r.min_price == null ? null : Number(r.min_price),
      max_price: r.max_price == null ? null : Number(r.max_price),
      modal_price: r.modal_price == null ? null : Number(r.modal_price),
      variety: r.variety || null,
      source: r.source,
      fetched_at: r.fetched_at,
    })),
  };
}

/** Overall pipeline status for the status badge. */
async function getStatus() {
  let lastSuccess = null, lastRun = null, coverage = { rows: [] };

  try {
    [lastSuccess, lastRun, coverage] = await Promise.all([
      sync.latestSuccessfulRun(),
      sync.latestRun(),
      pool.query(
        `SELECT commodity, market,
                COUNT(*)::int AS observations,
                MAX(price_date) AS latest_price_date
           FROM market_prices
          WHERE source = 'AGMARKNET'
          GROUP BY commodity, market
          ORDER BY MAX(price_date) DESC
          LIMIT 100`
      ),
    ]);
  } catch (dbErr) {
    // DB unavailable — try a direct live fetch with cache + retry
    const apiKey = process.env.DATA_GOV_API_KEY;
    if (apiKey) {
      return fetchLiveStatusWithRetry();
    }
    // No API key and no DB
    return {
      source: 'AGMARKNET',
      source_label: SOURCE_LABEL,
      is_realtime: false,
      data_kind: 'Daily reported mandi prices from data.gov.in.',
      sync_enabled: sync.SYNC_ENABLED,
      stale_after_hours: sync.STALE_HOURS,
      data_status: 'unavailable',
      status_label: STATUS_LABELS.unavailable,
      is_fallback: true,
      fallback_reason: 'no_api_key',
      message: 'No database and no DATA_GOV_API_KEY configured.',
      latest_successful_sync: null,
      latest_available_price_date: null,
      coverage: [],
    };
  }

  const classification = sync.classify({
    lastSuccess,
    hasCachedRows: coverage.rows.length > 0,
  });

  const latestPriceDate = coverage.rows.reduce(
    (acc, r) => (!acc || r.latest_price_date > acc ? r.latest_price_date : acc),
    null
  );

  return {
    source: 'AGMARKNET',
    source_label: SOURCE_LABEL,
    is_realtime: false,
    data_kind:
      'Daily reported mandi prices from data.gov.in. Reported once per day ' +
      'with a lag — not real-time trading data.',
    sync_enabled: sync.SYNC_ENABLED,
    sync_schedule: sync.SYNC_CRON,
    stale_after_hours: sync.STALE_HOURS,
    status_label: STATUS_LABELS[classification.data_status],
    ...classification,
    latest_successful_sync: lastSuccess ? lastSuccess.completed_at : null,
    latest_available_price_date: latestPriceDate,
    last_sync_attempt: lastRun
      ? {
          started_at: lastRun.started_at,
          completed_at: lastRun.completed_at,
          status: lastRun.status,
          records_inserted: lastRun.records_inserted,
          records_updated: lastRun.records_updated,
          records_rejected: lastRun.records_rejected,
          error_message: lastRun.error_message,
        }
      : null,
    coverage: coverage.rows.map((r) => ({
      commodity: r.commodity,
      market: r.market,
      observations: r.observations,
      latest_price_date: r.latest_price_date,
    })),
  };
}

/** Commodity/market pairs the official cache actually holds. */
async function getMarkets() {
  const result = await pool.query(
    `SELECT commodity, market, state, district,
            COUNT(*)::int AS observations,
            MAX(price_date) AS latest_price_date
       FROM market_prices
      WHERE source = 'AGMARKNET'
      GROUP BY commodity, market, state, district
      ORDER BY commodity, market`
  );
  return {
    source: 'AGMARKNET',
    source_label: SOURCE_LABEL,
    note: 'Markets present in the local official-data cache.',
    markets: result.rows,
  };
}

module.exports = {
  SOURCE_LABEL,
  STATUS_LABELS,
  priceRecency,
  getLatest,
  getSeries,
  getStatus,
  getMarkets,
};
