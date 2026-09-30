/**
 * Mandi Sync Service
 * ==================
 *
 * Pulls official daily mandi prices from data.gov.in and upserts them into
 * `market_prices`, recording every attempt in `market_data_sync_runs`.
 *
 * Guarantees
 * ----------
 *  - Idempotent. Re-running the same day's sync updates rows in place via
 *    the unique key (source, commodity, variety, state, district, market,
 *    price_date). It never duplicates.
 *  - Auditable. Success, partial and failure all write a run row with
 *    counts and the latest price date actually obtained.
 *  - Non-blocking. Server startup never waits on, or fails because of, a
 *    sync. The scheduler is opt-in via MANDI_SYNC_ENABLED.
 *  - Never fabricates. A failed sync writes no prices. Readers fall back to
 *    cached rows and are told the data is stale.
 */

const pool = require('../config/db');
const client = require('./mandiDataClient');

const STALE_HOURS = parseInt(process.env.MANDI_DATA_STALE_HOURS, 10) || 36;
const SYNC_ENABLED = String(process.env.MANDI_SYNC_ENABLED || 'false') === 'true';
const SYNC_CRON = process.env.MANDI_SYNC_CRON || '0 8,15 * * *';

async function startRun(scope, triggeredBy) {
  const result = await pool.query(
    `INSERT INTO market_data_sync_runs (source, status, scope, triggered_by)
     VALUES ('AGMARKNET', 'running', $1, $2)
     RETURNING id, started_at`,
    [JSON.stringify(scope), triggeredBy]
  );
  return result.rows[0];
}

async function finishRun(id, fields) {
  const result = await pool.query(
    `UPDATE market_data_sync_runs
        SET completed_at = NOW(),
            status = $2,
            records_received = $3,
            records_inserted = $4,
            records_updated = $5,
            records_rejected = $6,
            error_message = $7,
            last_available_price_date = $8
      WHERE id = $1
      RETURNING *`,
    [
      id,
      fields.status,
      fields.received || 0,
      fields.inserted || 0,
      fields.updated || 0,
      fields.rejected || 0,
      fields.error || null,
      fields.lastPriceDate || null,
    ]
  );
  return result.rows[0];
}

/**
 * Upsert one batch. Returns { inserted, updated }.
 *
 * `xmax = 0` on the RETURNING row is Postgres's way of saying the tuple was
 * freshly inserted rather than updated by ON CONFLICT.
 */
async function upsertRecords(records, fetchedAt) {
  let inserted = 0;
  let updated = 0;

  for (const record of records) {
    const result = await pool.query(
      `INSERT INTO market_prices
         (commodity, variety, state, district, market,
          min_price, max_price, modal_price, price, price_date,
          source, source_record_id, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, $12)
       ON CONFLICT (source, commodity, variety, state, district, market, price_date)
       DO UPDATE SET
         min_price = EXCLUDED.min_price,
         max_price = EXCLUDED.max_price,
         modal_price = EXCLUDED.modal_price,
         price = EXCLUDED.modal_price,
         source_record_id = COALESCE(EXCLUDED.source_record_id, market_prices.source_record_id),
         fetched_at = EXCLUDED.fetched_at
       RETURNING (xmax = 0) AS was_inserted`,
      [
        record.commodity,
        record.variety || '',
        record.state,
        record.district,
        record.market,
        record.min_price,
        record.max_price,
        record.modal_price,
        record.price_date,
        record.source,
        record.source_record_id,
        fetchedAt,
      ]
    );

    if (result.rows[0] && result.rows[0].was_inserted) inserted += 1;
    else updated += 1;
  }

  return { inserted, updated };
}

/**
 * Run one sync.
 *
 * `scope` = { state, commodities: [], markets: [] }. Markets are filtered
 * client-side after normalisation because the API's market filter is
 * exact-match and mandi spellings vary.
 */
async function runSync({ scope = client.DEFAULT_SCOPE, triggeredBy = 'manual' } = {}) {
  const run = await startRun(scope, triggeredBy);
  const fetchedAt = new Date();

  if (!client.isConfigured()) {
    const message =
      'DATA_GOV_API_KEY is not configured, so no official data was fetched. ' +
      'Existing cached prices are untouched.';
    const row = await finishRun(run.id, { status: 'failed', error: message });
    return { ok: false, run: row, error: message, configured: false };
  }

  const wantedMarkets = new Set((scope.markets || []).map(client.normaliseName));
  let received = 0;
  let rejected = 0;
  let inserted = 0;
  let updated = 0;
  let lastPriceDate = null;
  const errors = [];

  const commodities = scope.commodities && scope.commodities.length
    ? scope.commodities
    : [null];

  for (const commodity of commodities) {
    try {
      const page = await client.fetchAll({
        filters: {
          ...(scope.state ? { state: scope.state } : {}),
          ...(commodity ? { commodity } : {}),
        },
      });

      received += page.records.length + page.rejected.length;
      rejected += page.rejected.length;

      const relevant = wantedMarkets.size
        ? page.records.filter((r) => wantedMarkets.has(r.normalised_market))
        : page.records;

      if (relevant.length) {
        const result = await upsertRecords(relevant, fetchedAt);
        inserted += result.inserted;
        updated += result.updated;

        relevant.forEach((r) => {
          if (!lastPriceDate || r.price_date > lastPriceDate) lastPriceDate = r.price_date;
        });
      }
    } catch (err) {
      errors.push(client.redact(`${commodity || 'all'}: ${err.message}`));
    }
  }

  const touched = inserted + updated;
  let status;
  if (errors.length && touched === 0) status = 'failed';
  else if (errors.length) status = 'partial';
  else status = 'success';

  const row = await finishRun(run.id, {
    status,
    received,
    inserted,
    updated,
    rejected,
    error: errors.length ? errors.join(' | ') : null,
    lastPriceDate,
  });

  console.log(
    `[mandi] sync ${status}: received=${received} inserted=${inserted} ` +
      `updated=${updated} rejected=${rejected} latest_price_date=${lastPriceDate || 'n/a'}`
  );

  return {
    ok: status !== 'failed',
    run: row,
    configured: true,
    errors,
  };
}

/** The most recent sync attempt, whatever its outcome. */
async function latestRun() {
  const result = await pool.query(
    `SELECT * FROM market_data_sync_runs
      WHERE source = 'AGMARKNET'
      ORDER BY started_at DESC LIMIT 1`
  );
  return result.rows[0] || null;
}

/** The most recent sync that actually stored data. */
async function latestSuccessfulRun() {
  const result = await pool.query(
    `SELECT * FROM market_data_sync_runs
      WHERE source = 'AGMARKNET' AND status IN ('success', 'partial')
      ORDER BY completed_at DESC NULLS LAST LIMIT 1`
  );
  return result.rows[0] || null;
}

/**
 * Classify the freshness of what we hold.
 *
 *   fresh       - a successful sync completed within MANDI_DATA_STALE_HOURS
 *   stale       - we have cached official rows, but the last good sync is older
 *   unavailable - we hold no official rows at all
 */
function classify({ lastSuccess, hasCachedRows }) {
  if (!hasCachedRows) {
    return {
      data_status: 'unavailable',
      is_fallback: false,
      message:
        'Official daily market data is temporarily unavailable for this market.',
    };
  }

  if (lastSuccess && lastSuccess.completed_at) {
    const ageHours = (Date.now() - new Date(lastSuccess.completed_at).getTime()) / 3600000;
    if (ageHours <= STALE_HOURS) {
      return { data_status: 'fresh', is_fallback: false, message: null };
    }
  }

  return {
    data_status: 'stale',
    is_fallback: true,
    fallback_reason: 'Official daily-price service temporarily unavailable.',
    message: 'Showing latest cached official market data.',
  };
}

let scheduleTimer = null;

/**
 * Minimal cron support for the two patterns we actually use:
 * "M H1,H2 * * *". Anything else falls back to hourly checks. Avoids
 * pulling in a scheduler dependency for a prototype.
 */
function parseHours(cron) {
  const parts = String(cron).trim().split(/\s+/);
  if (parts.length < 2) return { minute: 0, hours: [8, 15] };
  const minute = Number(parts[0]);
  const hours = parts[1]
    .split(',')
    .map((h) => Number(h))
    .filter((h) => Number.isInteger(h) && h >= 0 && h < 24);
  return {
    minute: Number.isInteger(minute) ? minute : 0,
    hours: hours.length ? hours : [8, 15],
  };
}

/**
 * Start the scheduler if enabled. Safe to call unconditionally: it returns
 * immediately when disabled, and a sync failure never propagates.
 */
function startScheduler() {
  if (!SYNC_ENABLED) {
    console.log('[mandi] scheduled sync disabled (MANDI_SYNC_ENABLED is not "true")');
    return null;
  }
  if (!client.isConfigured()) {
    console.warn('[mandi] scheduled sync requested but DATA_GOV_API_KEY is not set — not starting');
    return null;
  }

  const { minute, hours } = parseHours(SYNC_CRON);
  let lastFiredKey = null;

  scheduleTimer = setInterval(() => {
    const now = new Date();
    const key = `${now.toDateString()}:${now.getHours()}`;
    if (hours.includes(now.getHours()) && now.getMinutes() >= minute && lastFiredKey !== key) {
      lastFiredKey = key;
      runSync({ triggeredBy: 'scheduled' }).catch((err) =>
        console.error(`[mandi] scheduled sync error: ${client.redact(err.message)}`)
      );
    }
  }, 60000);

  if (scheduleTimer.unref) scheduleTimer.unref();
  console.log(`[mandi] scheduled sync enabled at ${hours.join(',')}:${String(minute).padStart(2, '0')} daily`);
  return scheduleTimer;
}

function stopScheduler() {
  if (scheduleTimer) clearInterval(scheduleTimer);
  scheduleTimer = null;
}

module.exports = {
  STALE_HOURS,
  SYNC_ENABLED,
  SYNC_CRON,
  runSync,
  upsertRecords,
  latestRun,
  latestSuccessfulRun,
  classify,
  startScheduler,
  stopScheduler,
  parseHours,
};
