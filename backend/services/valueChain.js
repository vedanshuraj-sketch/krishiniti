/**
 * Crop Usage Discovery — value-chain knowledge base
 * =================================================
 *
 * Loads `krishiniti_crop_valuechain_final.csv` once at startup and answers
 *
 *     Crop -> Plant Part -> Industry -> Product -> Buyer Type -> Processing
 *
 * WHAT THIS IS NOT
 * ----------------
 * This is a static reference table of value channels a crop *can* feed
 * into. It is not demand data. It does not know whether anyone wants to
 * buy any of these products today, at what price, or in what volume.
 * Every response carries `is_live_demand: false` and a label the UI must
 * display verbatim.
 */

const fs = require('fs');
const path = require('path');

const LABEL = 'Value-channel knowledge base — not live demand prediction.';

const CANDIDATE_PATHS = [
  process.env.VALUE_CHAIN_CSV,
  path.join(__dirname, '..', '..', 'krishiniti_crop_valuechain_final.csv'),
  path.join(__dirname, '..', 'data', 'krishiniti_crop_valuechain_final.csv'),
  path.join(process.cwd(), 'krishiniti_crop_valuechain_final.csv'),
].filter(Boolean);

/**
 * The price dataset and the value-chain CSV name some crops differently
 * (AGMARKNET uses "Green Chilli" and "Ginger(Green)"; the value chain uses
 * "Chilli" and "Ginger"). These aliases bridge the two vocabularies.
 * Anything not listed here simply returns no rows — we do not guess.
 */
const CROP_ALIASES = {
  'green chilli': 'chilli',
  'chilli': 'chilli',
  'ginger(green)': 'ginger',
  'ginger (green)': 'ginger',
  'ginger': 'ginger',
  'groundnut': 'groundnut',
  'cotton': 'cotton',
  'mango': 'mango',
  'garlic': 'garlic',
  'onion': 'onion',
  'potato': 'potato',
  'tomato': 'tomato',
  'banana': 'banana',
  'turmeric': 'turmeric',
  'lemon': 'lemon',
  'coconut': 'coconut',
  'papaya': 'papaya',
  'guava': 'guava',
  'pomegranate': 'pomegranate',
  'sugarcane': 'sugarcane',
  'coriander': 'coriander',
  'drumstick': 'drumstick',
  'moringa': 'moringa',
};

let ROWS = [];
let BY_CROP = new Map();
let SOURCE_FILE = null;
let LOAD_ERROR = null;

/** Minimal RFC4180-ish CSV parser — handles quoted fields with commas. */
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

function normaliseCrop(crop) {
  if (!crop) return '';
  const key = String(crop).trim().toLowerCase();
  return CROP_ALIASES[key] || key;
}

function ingestRecords(records, sourceLabel) {
  ROWS = records;
  BY_CROP = new Map();
  ROWS.forEach((r) => {
    const key = normaliseCrop(r.crop_name);
    if (!BY_CROP.has(key)) BY_CROP.set(key, []);
    BY_CROP.get(key).push(r);
  });
  SOURCE_FILE = sourceLabel;
  LOAD_ERROR = null;
}

function recordsFromCsvText(text) {
  const table = parseCsv(text);
  const header = table[0].map((h) => h.trim());
  return table.slice(1).map((cells) => {
    const record = {};
    header.forEach((key, index) => {
      record[key] = (cells[index] || '').trim();
    });
    return {
      crop_name: record.crop_name,
      botanical_name: record.botanical_name,
      plant_part: record.plant_part,
      industry: record.industry,
      product: record.product,
      value_level: record.value_level,
      buyer_type: record.buyer_type,
      processing_required: /^y/i.test(record.processing_required || ''),
    };
  });
}

function loadFromCsv() {
  const file = CANDIDATE_PATHS.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });

  if (!file) {
    LOAD_ERROR = `Value-chain CSV not found. Looked in: ${CANDIDATE_PATHS.join(', ')}`;
    console.warn(`[valueChain] ${LOAD_ERROR}`);
    return;
  }

  try {
    ingestRecords(recordsFromCsvText(fs.readFileSync(file, 'utf8')), file);
    console.log(
      `[valueChain] loaded ${ROWS.length} value-chain rows for ${BY_CROP.size} crops from ${path.basename(file)}`
    );
  } catch (err) {
    LOAD_ERROR = `Failed to parse value-chain CSV: ${err.message}`;
    console.error(`[valueChain] ${LOAD_ERROR}`);
  }
}

/**
 * Prefer PostgreSQL `crop_value_chain` when it has been seeded; otherwise
 * keep the CSV already loaded at startup.
 */
async function loadFromSql() {
  if (!process.env.DATABASE_URL) return;
  try {
    const pool = require('../config/db');
    const result = await pool.query(
      `SELECT crop_name, botanical_name, plant_part, industry, product,
              value_level, buyer_type, processing_required
         FROM crop_value_chain
        ORDER BY crop_name, value_level, industry`
    );
    if (!result.rows.length) return;
    ingestRecords(
      result.rows.map((r) => ({
        crop_name: r.crop_name,
        botanical_name: r.botanical_name,
        plant_part: r.plant_part,
        industry: r.industry,
        product: r.product,
        value_level: r.value_level,
        buyer_type: r.buyer_type,
        processing_required: Boolean(r.processing_required),
      })),
      'crop_value_chain (sql)'
    );
    console.log(
      `[valueChain] loaded ${ROWS.length} rows for ${BY_CROP.size} crops from PostgreSQL`
    );
  } catch (err) {
    console.warn(`[valueChain] SQL load skipped: ${err.message}`);
  }
}

async function seedIntoDb(pool) {
  if (!ROWS.length) loadFromCsv();
  let upserted = 0;
  for (const r of ROWS) {
    await pool.query(
      `INSERT INTO crop_value_chain
         (crop_name, botanical_name, plant_part, industry, product,
          value_level, buyer_type, processing_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (crop_name, plant_part, industry, product, buyer_type)
       DO UPDATE SET
         botanical_name = EXCLUDED.botanical_name,
         value_level = EXCLUDED.value_level,
         processing_required = EXCLUDED.processing_required`,
      [
        r.crop_name, r.botanical_name, r.plant_part, r.industry, r.product,
        r.value_level, r.buyer_type, r.processing_required,
      ]
    );
    upserted += 1;
  }
  return upserted;
}

function load() {
  loadFromCsv();
  loadFromSql().catch(() => {});
}

load();

function summariseCrop(key, rows) {
  const high = rows.filter((r) => r.value_level === 'High');
  const medium = rows.filter((r) => r.value_level === 'Medium');
  const low = rows.filter((r) => r.value_level === 'Low');
  // 0-100: High=3, Medium=2, Low=1 over the max possible. Measures how much
  // of a crop's value-chain sits in high-value channels. NOT a price.
  const value_score = Math.round(
    ((3 * high.length + 2 * medium.length + low.length) / (3 * rows.length)) * 100
  );
  return {
    key,
    display_name: rows[0].crop_name,
    value_score,
    botanical_name: rows[0].botanical_name,
    channel_count: rows.length,
    high_value_count: high.length,
    medium_value_count: medium.length,
    low_value_count: low.length,
    high_value_products: [...new Set(high.map((r) => r.product))],
  };
}

/** Every crop the knowledge base covers. */
function listCrops() {
  return [...BY_CROP.keys()]
    .map((key) => summariseCrop(key, BY_CROP.get(key)))
    .sort((a, b) => b.value_score - a.value_score || b.channel_count - a.channel_count);
}

/**
 * Discover value channels for one crop.
 *
 * Returns `{ available, crop, label, is_live_demand: false, channels,
 *            by_industry, buyer_types, ... }`.
 */
function discover(crop) {
  const key = normaliseCrop(crop);
  const rows = BY_CROP.get(key) || [];

  if (!rows.length) {
    return {
      available: false,
      crop,
      matched_crop: null,
      label: LABEL,
      is_live_demand: false,
      channels: [],
      buyer_types: [],
      by_industry: [],
      message:
        `The value-chain knowledge base has no entry for "${crop}". ` +
        `It covers ${BY_CROP.size} crops; this one is not among them.`,
      source_file: SOURCE_FILE ? path.basename(SOURCE_FILE) : null,
      load_error: LOAD_ERROR,
    };
  }

  const order = { High: 0, Medium: 1, Low: 2 };
  const channels = [...rows].sort(
    (a, b) =>
      (order[a.value_level] ?? 3) - (order[b.value_level] ?? 3) ||
      a.industry.localeCompare(b.industry)
  );

  const industries = new Map();
  channels.forEach((c) => {
    if (!industries.has(c.industry)) industries.set(c.industry, []);
    industries.get(c.industry).push(c);
  });

  return {
    available: true,
    crop,
    matched_crop: rows[0].crop_name,
    botanical_name: rows[0].botanical_name,
    label: LABEL,
    is_live_demand: false,
    channel_count: channels.length,
    channels,
    buyer_types: [...new Set(channels.map((c) => c.buyer_type))].sort(),
    plant_parts: [...new Set(channels.map((c) => c.plant_part))].sort(),
    industries: [...new Set(channels.map((c) => c.industry))].sort(),
    by_industry: [...industries.entries()].map(([industry, items]) => ({
      industry,
      products: items,
    })),
    high_value_channels: channels.filter((c) => c.value_level === 'High'),
    no_processing_channels: channels.filter((c) => !c.processing_required),
    source_file: SOURCE_FILE ? path.basename(SOURCE_FILE) : null,
  };
}

/** Buyer types this crop's value channels point to — a matching signal. */
function buyerTypesFor(crop) {
  const key = normaliseCrop(crop);
  const rows = BY_CROP.get(key) || [];
  return [...new Set(rows.map((r) => r.buyer_type))];
}

function status() {
  return {
    loaded: ROWS.length > 0,
    row_count: ROWS.length,
    crop_count: BY_CROP.size,
    source_file: SOURCE_FILE,
    load_error: LOAD_ERROR,
    label: LABEL,
    is_live_demand: false,
  };
}

module.exports = {
  LABEL,
  load,
  loadFromCsv,
  loadFromSql,
  seedIntoDb,
  listCrops,
  discover,
  buyerTypesFor,
  normaliseCrop,
  status,
};
