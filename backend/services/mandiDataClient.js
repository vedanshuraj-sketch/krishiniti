/**
 * data.gov.in / AGMARKNET Mandi Price Client
 * ==========================================
 *
 * Fetches the Government of India open-data resource
 *   "Current daily price of various commodities from various markets (Mandi)"
 * from https://api.data.gov.in
 *
 * WHAT THIS DATA IS
 * -----------------
 * Daily *reported* mandi prices. A market reports its min / max / modal
 * price for a commodity on a given day, and that report reaches the API
 * with a lag. It is NOT real-time trading or tick data, and the price date
 * is frequently not today. Everything downstream must show the price date
 * and the sync time separately.
 *
 * SECRETS
 * -------
 * The API key is read from the backend environment only. It is never
 * returned by any route, never written to a log line, and never shipped to
 * the React Native bundle. `safeUrl()` redacts it from anything logged.
 */

const axios = require('axios');

const BASE_URL = process.env.DATA_GOV_BASE_URL || 'https://api.data.gov.in/resource';

// Resource id for the daily mandi price dataset. Configurable because
// data.gov.in occasionally republishes resources under a new id.
const RESOURCE_ID =
  process.env.DATA_GOV_RESOURCE_ID || '9ef84268-d588-465a-a308-a864a43d0070';

const API_KEY = process.env.DATA_GOV_API_KEY || '';
const TIMEOUT_MS = parseInt(process.env.DATA_GOV_TIMEOUT_MS, 10) || 20000;
const PAGE_SIZE = parseInt(process.env.DATA_GOV_PAGE_SIZE, 10) || 500;
const MAX_PAGES = parseInt(process.env.DATA_GOV_MAX_PAGES, 10) || 40;

/** Demo scope. Widen via env once the demo is proven. */
const DEFAULT_SCOPE = {
  state: process.env.MANDI_SYNC_STATE || 'Gujarat',
  commodities: (process.env.MANDI_SYNC_COMMODITIES || 'Groundnut')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  markets: (process.env.MANDI_SYNC_MARKETS || 'Rajkot,Gondal,Junagadh,Amreli,Jamnagar')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

class MandiApiError extends Error {
  constructor(message, { status = null, retryable = false, cause = null } = {}) {
    super(message);
    this.name = 'MandiApiError';
    this.status = status;
    this.retryable = retryable;
    this.cause = cause;
  }
}

function isConfigured() {
  return Boolean(API_KEY);
}

/** A URL safe to log: the API key is replaced, never printed. */
function safeUrl(params = {}) {
  const shown = { ...params };
  delete shown['api-key'];
  const query = Object.entries(shown)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${BASE_URL}/${RESOURCE_ID}?api-key=***REDACTED***&${query}`;
}

/** Strip anything that looks like the key out of a message before logging. */
function redact(text) {
  const value = String(text == null ? '' : text);
  if (!API_KEY) return value;
  return value.split(API_KEY).join('***REDACTED***');
}

function titleCase(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Normalise a name for comparison: lowercase, collapse whitespace, drop
 * parenthetical qualifiers and punctuation. "Jetpur(Dist.Rajkot)" and
 * "jetpur" compare equal.
 */
function normaliseName(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * data.gov.in reports dates as DD/MM/YYYY. Some rows use YYYY-MM-DD.
 * Returns an ISO date string, or null if unparseable or implausible.
 */
function parsePriceDate(value) {
  if (!value) return null;
  const text = String(value).trim();

  let year;
  let month;
  let day;

  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const dash = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  if (slash) {
    [, day, month, year] = slash;
  } else if (dash) {
    [, year, month, day] = dash;
  } else {
    return null;
  }

  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCMonth() !== Number(month) - 1) return null; // e.g. 31/02

  // Reject obvious nonsense: before 2000 or more than 2 days in the future.
  const now = Date.now();
  if (date.getTime() < Date.UTC(2000, 0, 1)) return null;
  if (date.getTime() > now + 2 * 86400000) return null;

  return date.toISOString().slice(0, 10);
}

function parsePrice(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  if (!Number.isFinite(n)) return null;
  // Mandi prices are INR/quintal. Zero, negative, or absurd values are
  // reporting errors, not data.
  if (n <= 0 || n > 1000000) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Validate and normalise one API record.
 * Returns `{ ok: true, record }` or `{ ok: false, reason }`.
 */
function normaliseRecord(raw) {
  const commodity = titleCase(raw.commodity);
  const market = titleCase(raw.market);
  const state = titleCase(raw.state);
  const district = titleCase(raw.district);
  const variety = raw.variety ? titleCase(raw.variety) : '';

  if (!commodity) return { ok: false, reason: 'missing commodity' };
  if (!market) return { ok: false, reason: 'missing market' };

  const priceDate = parsePriceDate(raw.arrival_date || raw.price_date || raw.date);
  if (!priceDate) {
    return { ok: false, reason: `unparseable date "${raw.arrival_date || raw.price_date}"` };
  }

  const modal = parsePrice(raw.modal_price);
  if (modal == null) return { ok: false, reason: 'missing or invalid modal_price' };

  let min = parsePrice(raw.min_price);
  let max = parsePrice(raw.max_price);

  // If the source has min > max, it is a reporting error. Swap rather than
  // discard the whole record, and keep modal authoritative.
  if (min != null && max != null && min > max) {
    [min, max] = [max, min];
  }

  return {
    ok: true,
    record: {
      commodity,
      variety,
      state: state || null,
      district: district || market,
      market,
      min_price: min,
      max_price: max,
      modal_price: modal,
      price_date: priceDate,
      source: 'AGMARKNET',
      source_record_id: raw.id || raw._id || null,
      normalised_commodity: normaliseName(commodity),
      normalised_market: normaliseName(market),
    },
  };
}

/**
 * Fetch one page. Throws MandiApiError; callers decide about retries.
 */
async function fetchPage({ filters = {}, offset = 0, limit = PAGE_SIZE }) {
  if (!isConfigured()) {
    throw new MandiApiError(
      'DATA_GOV_API_KEY is not set. Get a free key at https://data.gov.in and ' +
        'add it to the backend environment.',
      { retryable: false }
    );
  }

  const params = {
    'api-key': API_KEY,
    format: 'json',
    offset,
    limit,
  };

  Object.entries(filters).forEach(([field, value]) => {
    if (value != null && value !== '') params[`filters[${field}]`] = value;
  });

  try {
    const response = await axios.get(`${BASE_URL}/${RESOURCE_ID}`, {
      params,
      timeout: TIMEOUT_MS,
      headers: { Accept: 'application/json' },
    });

    const body = response.data || {};
    return {
      records: Array.isArray(body.records) ? body.records : [],
      total: Number(body.total ?? body.count ?? 0) || 0,
      count: Number(body.count ?? 0) || 0,
    };
  } catch (err) {
    const status = err.response?.status ?? null;
    const retryable =
      status === 429 || status === 500 || status === 502 || status === 503 ||
      status === 504 || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT';

    const label =
      status === 429
        ? 'data.gov.in rate limit hit (HTTP 429)'
        : status
        ? `data.gov.in returned HTTP ${status}`
        : `data.gov.in request failed (${err.code || 'network error'})`;

    // Log the redacted URL so the key never lands in logs.
    console.error(`[mandi] ${label} for ${safeUrl(params)}`);

    throw new MandiApiError(redact(label), { status, retryable, cause: redact(err.message) });
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch every page for one filter set, with bounded retries on retryable
 * failures. Returns `{ records, rejected, pages, truncated }`.
 */
async function fetchAll({ filters = {}, maxPages = MAX_PAGES, pageSize = PAGE_SIZE }) {
  const records = [];
  const rejected = [];
  let offset = 0;
  let pages = 0;
  let truncated = false;

  for (; pages < maxPages; pages += 1) {
    let page;
    let attempt = 0;

    for (;;) {
      try {
        page = await fetchPage({ filters, offset, limit: pageSize });
        break;
      } catch (err) {
        attempt += 1;
        if (!(err instanceof MandiApiError) || !err.retryable || attempt >= 3) throw err;
        await sleep(1000 * attempt);
      }
    }

    page.records.forEach((raw) => {
      const result = normaliseRecord(raw);
      if (result.ok) records.push(result.record);
      else rejected.push({ reason: result.reason });
    });

    if (page.records.length < pageSize) break;
    offset += pageSize;
  }

  if (pages >= maxPages) truncated = true;

  return { records, rejected, pages: pages + 1, truncated };
}

module.exports = {
  BASE_URL,
  RESOURCE_ID,
  DEFAULT_SCOPE,
  MandiApiError,
  isConfigured,
  safeUrl,
  redact,
  normaliseName,
  normaliseRecord,
  parsePriceDate,
  parsePrice,
  fetchPage,
  fetchAll,
};
