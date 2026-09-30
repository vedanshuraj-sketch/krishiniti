/**
 * KRISHINITI backend test suite.
 *
 *   npm test
 *
 * Runs without node_modules: axios, pg and dotenv are stubbed by
 * tests/harness.js, so nothing here touches a database or the network.
 */
const h = require('./harness');

process.env.DATA_GOV_API_KEY = 'TEST-SECRET-KEY-do-not-log-123456';
process.env.DATA_GOV_RESOURCE_ID = 'test-resource';
process.env.MANDI_DATA_STALE_HOURS = '36';
process.env.MANDI_SYNC_MARKETS = 'Rajkot,Gondal,Junagadh,Amreli,Jamnagar';
process.env.MANDI_SYNC_COMMODITIES = 'Groundnut';
process.env.DATA_GOV_PAGE_SIZE = '2';

const API_KEY = process.env.DATA_GOV_API_KEY;

const client = require('../services/mandiDataClient');
const sync = require('../services/mandiSyncService');
const marketData = require('../services/marketData');
const quality = require('../services/qualityAssessment');
const matching = require('../services/buyerMatching');
const engine = require('../decisionEngine');

const HOUR = 3600000;

function apiRecord(over = {}) {
  return {
    state: 'Gujarat',
    district: 'Rajkot',
    market: 'Rajkot',
    commodity: 'Groundnut',
    variety: 'Bold',
    arrival_date: '18/09/2026',
    min_price: '4800',
    max_price: '5400',
    modal_price: '5100',
    ...over,
  };
}

const LOT = {
  id: 1, commodity: 'Groundnut', market: 'Rajkot', quantity: 25, unit: 'quintal',
  grade: 'Grade A', quality_method: 'self_declared', certificate_status: 'not_uploaded',
  quality_photo_count: 0,
};

const BUYER = {
  id: 1, name: 'Saurashtra Oil Mills', buyer_type: 'Oil Processor',
  crops_accepted: ['Groundnut', 'Mustard'], grade_requirement: 'Grade A',
  min_quantity: 20, max_quantity: 500, market: 'Rajkot', distance_km: 12,
  offered_price: 5150, quality_requirement: 'self_declared',
  requires_certification: false, commission_rate: 0.01, transport_cost: 900,
  is_available: true,
};

(async () => {

// ══════════════════════════════════════════════════════════════════
h.section('1. Record normalisation and validation');

const good = client.normaliseRecord(apiRecord());
h.check('valid record is accepted', good.ok);
h.check('DD/MM/YYYY date is parsed to ISO', good.ok && good.record.price_date === '2026-09-18');
h.check('modal price is parsed', good.ok && good.record.modal_price === 5100);
h.check('market name is normalised for matching',
  good.ok && good.record.normalised_market === 'rajkot');

h.check('parenthetical market names normalise',
  client.normaliseName('Jetpur(Dist.Rajkot)') === 'jetpur');

h.check('missing commodity is rejected',
  client.normaliseRecord(apiRecord({ commodity: '' })).ok === false);
h.check('missing modal price is rejected',
  client.normaliseRecord(apiRecord({ modal_price: '' })).ok === false);
h.check('non-numeric price is rejected',
  client.normaliseRecord(apiRecord({ modal_price: 'NR' })).ok === false);
h.check('zero price is rejected',
  client.normaliseRecord(apiRecord({ modal_price: '0' })).ok === false);
h.check('impossible date 31/02 is rejected',
  client.normaliseRecord(apiRecord({ arrival_date: '31/02/2026' })).ok === false);
h.check('garbage date is rejected',
  client.normaliseRecord(apiRecord({ arrival_date: 'yesterday' })).ok === false);
h.check('far-future date is rejected',
  client.normaliseRecord(apiRecord({ arrival_date: '01/01/2099' })).ok === false);

const swapped = client.normaliseRecord(apiRecord({ min_price: '5400', max_price: '4800' }));
h.check('min > max is corrected rather than discarded',
  swapped.ok && swapped.record.min_price === 4800 && swapped.record.max_price === 5400);

// ══════════════════════════════════════════════════════════════════
h.section('2. Pagination');

let pagesRequested = [];
h.axiosStub._handler = async (method, url, config) => {
  const offset = config.params.offset;
  pagesRequested.push(offset);
  // page size is 2; return 2, 2, then 1 to signal the end
  const rows = offset === 0
    ? [apiRecord({ market: 'Rajkot' }), apiRecord({ market: 'Gondal' })]
    : offset === 2
    ? [apiRecord({ market: 'Junagadh' }), apiRecord({ market: 'Amreli' })]
    : [apiRecord({ market: 'Jamnagar' })];
  return { data: { records: rows, total: 5, count: rows.length } };
};

const paged = await client.fetchAll({ filters: { state: 'Gujarat' }, pageSize: 2 });
h.check('walks pages until a short page', pagesRequested.join(',') === '0,2,4');
h.check('collects records from every page', paged.records.length === 5);
h.check('stops without hitting the page cap', paged.truncated === false);

// ══════════════════════════════════════════════════════════════════
h.section('3. API failures: timeout, 429, 500');

for (const [label, status] of [['timeout', null], ['HTTP 429', 429], ['HTTP 500', 500]]) {
  h.axiosStub._handler = async () => { throw h.httpError(status); };
  let caught = null;
  try {
    await client.fetchPage({ filters: {}, offset: 0, limit: 10 });
  } catch (err) { caught = err; }
  h.check(`${label} raises MandiApiError`, caught && caught.name === 'MandiApiError');
  h.check(`${label} is marked retryable`, caught && caught.retryable === true);
}

h.axiosStub._handler = async () => { throw h.httpError(404, 'not found'); };
let notFound = null;
try { await client.fetchPage({ filters: {}, offset: 0, limit: 10 }); }
catch (err) { notFound = err; }
h.check('HTTP 404 is NOT retryable', notFound && notFound.retryable === false);

// retry-then-succeed
let attempts = 0;
h.axiosStub._handler = async () => {
  attempts += 1;
  if (attempts < 3) throw h.httpError(429);
  return { data: { records: [apiRecord()], total: 1, count: 1 } };
};
const retried = await client.fetchAll({ filters: {}, pageSize: 50 });
h.check('retries a 429 and eventually succeeds', attempts === 3 && retried.records.length === 1);

// ══════════════════════════════════════════════════════════════════
h.section('4. API key never leaks');

h.captureConsole();
h.axiosStub._handler = async () => { throw h.httpError(500, `boom ${API_KEY}`); };
try { await client.fetchPage({ filters: { state: 'Gujarat' }, offset: 0, limit: 5 }); }
catch (err) {
  h.check('error message has the key redacted', !String(err.message).includes(API_KEY));
  h.check('error cause has the key redacted', !String(err.cause || '').includes(API_KEY));
}
const logs = h.loggedText();
h.releaseConsole();
h.check('the key never appears in log output', !logs.includes(API_KEY));
h.check('logs show a redaction marker instead', logs.includes('REDACTED'));
h.check('safeUrl() redacts the key',
  !client.safeUrl({ 'api-key': API_KEY, state: 'Gujarat' }).includes(API_KEY));
h.check('redact() scrubs arbitrary text',
  !client.redact(`key is ${API_KEY} ok`).includes(API_KEY));

// ══════════════════════════════════════════════════════════════════
h.section('5. Idempotent upsert / duplicate prevention');

const rows = new Map();
h.dbStub.reset();
h.dbStub._handler = async (text, params) => {
  if (text.includes('INSERT INTO market_prices')) {
    const key = [params[9], params[0], params[1], params[2], params[3], params[4], params[8]].join('|');
    const isNew = !rows.has(key);
    rows.set(key, params);
    return { rows: [{ was_inserted: isNew }] };
  }
  return { rows: [] };
};

const batch = [good.record, { ...good.record, market: 'Gondal', normalised_market: 'gondal' }];
const first = await sync.upsertRecords(batch, new Date());
h.check('first import inserts both rows', first.inserted === 2 && first.updated === 0);

const second = await sync.upsertRecords(batch, new Date());
h.check('re-import updates rather than duplicating',
  second.inserted === 0 && second.updated === 2);
h.check('stored row count stays at 2 (no duplicates)', rows.size === 2);

const insertSql = h.dbStub.calls.find((c) => c.text.includes('INSERT INTO market_prices')).text;
h.check('upsert uses the unique constraint',
  insertSql.includes('ON CONFLICT (source, commodity, variety, state, district, market, price_date)'));
h.check('price column is kept in sync with modal_price',
  insertSql.includes('price = EXCLUDED.modal_price'));

// ══════════════════════════════════════════════════════════════════
h.section('6. Freshness classification (fallback policy A/B/C)');

const freshRun = { completed_at: new Date(Date.now() - 2 * HOUR) };
const oldRun = { completed_at: new Date(Date.now() - 50 * HOUR) };

const a = sync.classify({ lastSuccess: freshRun, hasCachedRows: true });
h.check('A: recent sync + cached rows = fresh', a.data_status === 'fresh');
h.check('A: fresh is not a fallback', a.is_fallback === false);

const b = sync.classify({ lastSuccess: oldRun, hasCachedRows: true });
h.check('B: stale sync + cached rows = stale', b.data_status === 'stale');
h.check('B: stale is flagged as a fallback', b.is_fallback === true);
h.check('B: stale carries the exact fallback reason',
  b.fallback_reason === 'Official daily-price service temporarily unavailable.');

const c = sync.classify({ lastSuccess: null, hasCachedRows: false });
h.check('C: no cached rows = unavailable', c.data_status === 'unavailable');
h.check('C: unavailable is not a fallback', c.is_fallback === false);
h.check('C: unavailable carries the exact message',
  c.message === 'Official daily market data is temporarily unavailable for this market.');

const never = sync.classify({ lastSuccess: null, hasCachedRows: true });
h.check('cached rows with no successful sync on record = stale',
  never.data_status === 'stale');

// ══════════════════════════════════════════════════════════════════
h.section('7. marketData.getLatest fallback behaviour');

function mockDb({ priceRow, lastSuccess, lastRun }) {
  h.dbStub._handler = async (text) => {
    if (text.includes('FROM market_prices')) return { rows: priceRow ? [priceRow] : [] };
    if (text.includes("status IN ('success', 'partial')")) return { rows: lastSuccess ? [lastSuccess] : [] };
    if (text.includes('FROM market_data_sync_runs')) return { rows: lastRun ? [lastRun] : [] };
    return { rows: [] };
  };
}

const priceRow = {
  commodity: 'Groundnut', variety: 'Bold', state: 'Gujarat', district: 'Rajkot',
  market: 'Rajkot', min_price: 4800, max_price: 5400, modal_price: 5100,
  price_date: '2026-09-18', source: 'AGMARKNET',
  fetched_at: new Date(Date.now() - 2 * HOUR),
};

mockDb({ priceRow, lastSuccess: { completed_at: new Date(Date.now() - 2 * HOUR), status: 'success' },
         lastRun: { started_at: new Date(), status: 'success' } });
const freshLatest = await marketData.getLatest('Groundnut', 'Rajkot');
h.check('fresh: data_status is fresh', freshLatest.data_status === 'fresh');
h.check('fresh: modal price returned', freshLatest.price.modal_price === 5100);
h.check('fresh: min and max returned',
  freshLatest.price.min_price === 4800 && freshLatest.price.max_price === 5400);
h.check('fresh: label is "Official daily mandi data"',
  freshLatest.status_label === 'Official daily mandi data');
h.check('fresh: recommendations allowed', freshLatest.recommendation_allowed === true);
h.check('fresh: never claims real-time', freshLatest.is_realtime === false);
h.check('fresh: no stale caution', freshLatest.recommendation_caution === null);

mockDb({ priceRow, lastSuccess: { completed_at: new Date(Date.now() - 50 * HOUR), status: 'success' },
         lastRun: { started_at: new Date(), status: 'failed' } });
const staleLatest = await marketData.getLatest('Groundnut', 'Rajkot');
h.check('stale: data_status is stale', staleLatest.data_status === 'stale');
h.check('stale: is_fallback true', staleLatest.is_fallback === true);
h.check('stale: label is "Latest cached official mandi data"',
  staleLatest.status_label === 'Latest cached official mandi data');
h.check('stale: still returns the real price date', staleLatest.price_date === '2026-09-18');
h.check('stale: exposes the last successful sync', staleLatest.latest_successful_sync != null);
h.check('stale: decision permitted but cautioned',
  staleLatest.recommendation_allowed === true &&
  staleLatest.recommendation_caution ===
    'Recommendation uses cached market data; verify local mandi conditions before acting.');

mockDb({ priceRow: null, lastSuccess: null, lastRun: { started_at: new Date(), status: 'failed' } });
const noneLatest = await marketData.getLatest('Groundnut', 'Rajkot');
h.check('no cache: data_status is unavailable', noneLatest.data_status === 'unavailable');
h.check('no cache: no price is invented', noneLatest.price === null);
h.check('no cache: recommendations disabled', noneLatest.recommendation_allowed === false);
h.check('no cache: label is "Official market data temporarily unavailable"',
  noneLatest.status_label === 'Official market data temporarily unavailable');
h.check('no cache: is_fallback is false (nothing to fall back to)',
  noneLatest.is_fallback === false);

// ══════════════════════════════════════════════════════════════════
h.section('8. "Live" wording is only used for a genuinely current date');

const today = new Date().toISOString().slice(0, 10);
h.check('today\'s date is labelled as a daily report, not "Live Price"', (() => {
  const r = marketData.priceRecency(today);
  return r.is_today === true && /daily report/i.test(r.label) && !/live/i.test(r.label);
})());
h.check('an older date says "Latest reported market price"',
  marketData.priceRecency('2026-09-01').label === 'Latest reported market price');
h.check('no status label anywhere says "Live"',
  !Object.values(marketData.STATUS_LABELS).some((l) => /live/i.test(l)));

// ══════════════════════════════════════════════════════════════════
h.section('9. AI/ML contract fix (the original defect)');

const realShape = {
  commodity: 'Groundnut', market: 'Rajkot',
  forecast: {
    status: 'success', last_price: 5075, last_date: '2025-08-14', trend: 'Stable',
    confidence: 'High', confidence_reason: 'Stable history.', volatility_cv: 0.06,
    explanation: 'Stable.',
    forecast: [{ date: '2025-08-15', predicted_price: 5100, lower_bound: 4900, upper_bound: 5300 }],
  },
  risk: { risk_score: 42, risk_level: 'Medium', risk_status: 'ok', explanation: 'Moderate.' },
  anomaly: { anomaly_flag: false, anomaly_type: 'none', anomaly_score: 0, anomaly_status: 'ok', explanation: 'Normal.' },
  overall_explanation: 'Stable with moderate risk.',
};

const read = engine.readSummary(realShape);
h.check('reads forecast.last_price (not forecast.current_price)', read.last_price === 5075);
h.check('reads nested forecast array', read.first_predicted_price === 5100);
h.check('reads forecast.confidence as reliability', read.reliability_level === 'High');
h.check('reads risk.risk_score (not summary.risk_score)', read.risk_score === 42);
h.check('reads anomaly.anomaly_flag (not summary.anomaly_detected)', read.anomaly_flag === false);
h.check('no NaN anywhere in the parsed reading',
  !Object.values(read).some((v) => typeof v === 'number' && Number.isNaN(v)));

const missing = engine.readSummary({
  forecast: { status: 'no_data', message: 'none' },
  risk: { status: 'no_data' },
  anomaly: { status: 'no_data' },
});
h.check('missing risk stays null, never 0', missing.risk_score === null);
h.check('missing risk is flagged unavailable', missing.risk_available === false);
h.check('missing anomaly stays null, never false', missing.anomaly_flag === null);
h.check('no_data forecast is flagged unavailable', missing.forecast_available === false);

// ══════════════════════════════════════════════════════════════════
h.section('10. Decision disabled when no current-price input exists');

const noPrice = engine.calculateSellNowBaseline(
  { commodity: 'Groundnut', market: 'Rajkot', quantity: 25, unit: 'quintal', certificate_status: 'not_uploaded', transport_cost: 0 },
  [],
  { forecast: { status: 'no_data' }, risk: {}, anomaly: {} }
);
h.check('no price input produces no priced option', noPrice.option === null);
h.check('no price input explains why',
  noPrice.limitations.some((l) => /cannot be shown|not a recommendation/i.test(l)));

const withPrice = engine.calculateSellNowBaseline(
  { commodity: 'Groundnut', market: 'Rajkot', quantity: 25, unit: 'quintal', certificate_status: 'not_uploaded', transport_cost: 500 },
  [],
  realShape
);
h.check('with a price, a sell-now baseline is produced', withPrice.option !== null);
h.check('degraded baseline still refuses to call itself a recommendation',
  withPrice.limitations.some((l) => /not a recommendation/i.test(l)));

// ══════════════════════════════════════════════════════════════════
h.section('11. Net realisation line items');

const br = engine.calculateNetRealisation({
  price: 5000, quantity: 25, transportCost: 1200, isCertified: false,
  storageDays: 5, storageCostPerUnitPerDay: 2, commissionRate: 0.02,
  riskTolerance: 0.5, riskPerUnit: 300,
});
const labels = br.line_items.map((l) => l.label).join(' | ');
h.check('has gross revenue', /Gross Revenue/.test(labels));
h.check('has quality penalty for an uncertified lot', /Quality Penalty/.test(labels));
h.check('has transport', /Transport/.test(labels));
h.check('has storage', /Storage Cost/.test(labels));
h.check('has mandi/transaction deduction', /Mandi \/ transaction/.test(labels));
h.check('risk adjustment is labelled as not cash', /not cash/.test(labels));
h.check('net = gross - transport - storage - commission',
  Math.abs(br.net_realisation -
    (br.gross_revenue - br.transport_cost - br.storage_cost - br.commission)) < 0.02);
h.check('risk-adjusted is strictly below cash net',
  br.risk_adjusted_realisation < br.net_realisation);

// ══════════════════════════════════════════════════════════════════
h.section('12. Quality assessment claims');

const selfDeclared = quality.describeLotQuality(LOT);
h.check('self-declared label is exact',
  selfDeclared.label === 'Farmer self-declared quality');
h.check('self-declared is not certified', selfDeclared.is_certified === false);

const uploaded = quality.describeLotQuality({
  ...LOT, quality_method: 'certificate_upload', certificate_status: 'uploaded_unverified',
});
h.check('uploaded certificate label is exact',
  uploaded.label === 'Certificate uploaded — verification pending');
h.check('uploaded certificate is NOT treated as certified', uploaded.is_certified === false);

const photos = quality.describeLotQuality({
  ...LOT, quality_method: 'camera_assisted', quality_photo_count: 3,
});
h.check('camera label is exact when no CV model exists',
  photos.label === 'Photos captured for buyer review — not a verified quality grade');
h.check('camera output is never called a certified grade',
  !/certified|laboratory/i.test(photos.label));
h.check('no visual model is claimed', quality.VISUAL_MODEL_ENABLED === false);

const emptyCamera = quality.describeLotQuality({ ...LOT, quality_method: 'camera_assisted', quality_photo_count: 0 });
h.check('camera method with no photos degrades to rank 0', emptyCamera.evidence_rank === 0);

h.check('no input can set certificate_status to verified',
  quality.normaliseQualityInput({
    quality_method: 'certificate_upload',
    certificate_status: 'verified',
    certificate: { filename: 'cert.pdf' },
  }).certificate_status === 'uploaded_unverified');
h.check('a certificate is not required to create a lot',
  quality.normaliseQualityInput({}).quality_method === 'self_declared');
h.check('camera photos store metadata only',
  JSON.parse(quality.normaliseQualityInput({
    quality_method: 'camera_assisted',
    quality_photos: [{ filename: 'a.jpg' }],
  }).quality_photos)[0].stored === false);

// ══════════════════════════════════════════════════════════════════
h.section('13. Quality compatibility in buyer matching');

const certBuyer = { ...BUYER, id: 2, name: 'Kathiawar Exports', quality_requirement: 'certificate_required', requires_certification: true };
const photoBuyer = { ...BUYER, id: 3, name: 'Photo Review Co', quality_requirement: 'photo_review' };

const selfVsCert = quality.checkQualityCompatibility(selfDeclared, 'certificate_required');
h.check('self-declared vs certificate-required is incompatible', selfVsCert.compatible === false);
h.check('and explains exactly what is missing', /requires a certificate/i.test(selfVsCert.reason));

const photoVsCert = quality.checkQualityCompatibility(photos, 'certificate_required');
h.check('camera-assisted vs certificate-required is incompatible', photoVsCert.compatible === false);

const uploadVsCert = quality.checkQualityCompatibility(uploaded, 'certificate_required');
h.check('uploaded-but-unverified is conditional, never fully eligible',
  uploadVsCert.compatible === true && uploadVsCert.conditional === true &&
  uploadVsCert.score_fraction < 1);

const photoVsPhoto = quality.checkQualityCompatibility(photos, 'photo_review');
h.check('camera-assisted satisfies photo review fully',
  photoVsPhoto.compatible === true && photoVsPhoto.conditional === false);

const selfVsPhoto = quality.checkQualityCompatibility(selfDeclared, 'photo_review');
h.check('self-declared vs photo review is conditional', selfVsPhoto.conditional === true);

const matched = matching.matchBuyers(LOT, [BUYER, certBuyer, photoBuyer]);
h.check('certificate-required buyer is not compatible for a self-declared lot',
  matched.matches.find((m) => m.buyer.id === 2).compatible === false);
h.check('every match explains quality compatibility',
  matched.matches.every((m) => m.quality_compatibility && m.quality_compatibility.reason));
h.check('compatible buyers rank above incompatible ones',
  matched.matches[0].compatible === true &&
  matched.matches[matched.matches.length - 1].compatible === false);
h.check('match score is out of 100', matched.matches.every((m) => m.match_score <= 100));
h.check('incompatible buyers carry reasons',
  matched.matches.find((m) => m.buyer.id === 2).incompatibility_reasons.length > 0);
h.check('every match is labelled demo data',
  matched.matches.every((m) => m.data_label === 'Demo buyer data for prototype.'));

const smallLot = matching.matchBuyers({ ...LOT, quantity: 2 }, [BUYER]);
h.check('below-minimum quantity blocks the match',
  smallLot.matches[0].compatible === false);
h.check('and suggests aggregation',
  /aggregat/i.test(smallLot.matches[0].incompatibility_reasons.map((r) => r.detail).join(' ')));

const wrongCrop = matching.matchBuyers({ ...LOT, commodity: 'Cotton' }, [BUYER]);
h.check('wrong crop blocks the match', wrongCrop.matches[0].compatible === false);

h.check('matching is deterministic',
  JSON.stringify(matching.matchBuyers(LOT, [BUYER]).matches) ===
  JSON.stringify(matching.matchBuyers(LOT, [BUYER]).matches));

// ══════════════════════════════════════════════════════════════════
h.section('14. Sync run auditing');

h.dbStub.reset();
let runRow = null;
h.dbStub._handler = async (text, params) => {
  if (text.includes('INSERT INTO market_data_sync_runs')) {
    runRow = { id: 99, started_at: new Date(), status: 'running' };
    return { rows: [runRow] };
  }
  if (text.includes('UPDATE market_data_sync_runs')) {
    runRow = { id: 99, status: params[1], records_received: params[2],
               records_inserted: params[3], error_message: params[6] };
    return { rows: [runRow] };
  }
  if (text.includes('INSERT INTO market_prices')) return { rows: [{ was_inserted: true }] };
  return { rows: [] };
};

// One short page, so fetchAll stops after the first request.
h.axiosStub._handler = async (method, url, config) => ({
  data: config.params.offset === 0
    ? { records: [apiRecord(), apiRecord({ market: 'Gondal' })], total: 2, count: 2 }
    : { records: [], total: 2, count: 0 },
});
const okRun = await sync.runSync({ scope: { state: 'Gujarat', commodities: ['Groundnut'], markets: ['Rajkot', 'Gondal'] }, triggeredBy: 'test' });
h.check('successful sync reports ok', okRun.ok === true);
h.check('successful sync is recorded as success', okRun.run.status === 'success');
h.check('successful sync counts inserted rows', okRun.run.records_inserted === 2);

h.axiosStub._handler = async () => { throw h.httpError(500); };
h.captureConsole();
const failRun = await sync.runSync({ scope: { state: 'Gujarat', commodities: ['Groundnut'], markets: ['Rajkot'] }, triggeredBy: 'test' });
const failLogs = h.loggedText();
h.releaseConsole();
h.check('failed sync reports not-ok', failRun.ok === false);
h.check('failed sync is audited as failed', failRun.run.status === 'failed');
h.check('failed sync records an error message', Boolean(failRun.run.error_message));
h.check('failed sync writes no prices',
  !h.dbStub.calls.slice(-3).some((c) => c.text.includes('INSERT INTO market_prices')));
h.check('failure logs never contain the API key', !failLogs.includes(API_KEY));

h.check('cron parser handles "0 8,15 * * *"', (() => {
  const p = sync.parseHours('0 8,15 * * *');
  return p.minute === 0 && p.hours.join(',') === '8,15';
})());

// ══════════════════════════════════════════════════════════════════
h.section('15. Value chain knowledge base');

const valueChain = require('../services/valueChain');
const vcStatus = valueChain.status();
h.check('value-chain CSV loaded', vcStatus.loaded === true);
h.check('it is never labelled as demand data', vcStatus.is_live_demand === false);
h.check('label is exact',
  vcStatus.label === 'Value-channel knowledge base — not live demand prediction.');

const gn = valueChain.discover('Groundnut');
h.check('Groundnut has value channels', gn.available && gn.channel_count > 0);
h.check('channels include the full chain', (() => {
  const c = gn.channels[0];
  return c.plant_part && c.industry && c.product && c.buyer_type && c.processing_required !== undefined;
})());
h.check('AGMARKNET naming is bridged ("Green Chilli" -> Chilli)',
  valueChain.discover('Green Chilli').available === true);
h.check('unknown crops are reported, not faked',
  valueChain.discover('Unobtanium').available === false);
h.check('crop list includes High/Medium/Low value counts', (() => {
  const tomato = valueChain.listCrops().find((c) => c.key === 'tomato');
  return tomato && tomato.high_value_count > 0 && tomato.channel_count > 0;
})());

// ══════════════════════════════════════════════════════════════════
h.section('16. No secret can reach the React Native bundle');

const fs = require('fs');
const path = require('path');

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const rnDir = path.join(__dirname, '..', '..', 'frontend', 'src');
const rnFiles = walk(rnDir);
const hasFrontend = rnFiles.length > 0;
if (!hasFrontend) console.log('  SKIP  frontend folder not next to backend (standalone repo) - frontend scans skipped');

// Secret-bearing identifiers that must never appear as code in the app.
// Comments explaining that the key is backend-only are fine, so we look for
// actual usage (assignment, env access, or a query parameter).
const FORBIDDEN = [
  /process\.env\.DATA_GOV_API_KEY/,
  /DATA_GOV_API_KEY\s*[:=]/,
  /['"]api-key['"]\s*:/,
  /JWT_SECRET/,
  /DATABASE_URL/,
  /postgres(ql)?:\/\//,
  /npg_[A-Za-z0-9]+/,
];

const offenders = [];
(hasFrontend ? rnFiles : []).forEach((file) => {
  const text = fs.readFileSync(file, 'utf8');
  FORBIDDEN.forEach((pattern) => {
    if (pattern.test(text)) offenders.push(`${path.basename(file)} matches ${pattern}`);
  });
});
h.check('no API key, JWT secret or DB URL is referenced in app source',
  offenders.length === 0, offenders.join('; '));

// The app must reach official prices only through the backend.
if (hasFrontend) {
  const apiService = fs.readFileSync(path.join(rnDir, 'services', 'api.ts'), 'utf8');
  h.check('app never calls api.data.gov.in directly', !/api\.data\.gov\.in/.test(apiService));
  h.check('app reads market data through the backend route', /\/api\/market\//.test(apiService));
}

h.check('.env is gitignored',
  fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8').includes('.env'));
h.check('.env.example carries no filled-in key', (() => {
  const example = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
  return /DATA_GOV_API_KEY=\s*$/m.test(example) && /JWT_SECRET=\s*$/m.test(example);
})());

h.summary('BACKEND TESTS');
})();
