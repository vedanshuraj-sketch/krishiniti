/**
 * Minimal test harness with dependency stubbing.
 *
 * The backend depends on axios, pg, dotenv and express. This harness
 * intercepts require() for those so the pure logic (sync, fallback policy,
 * matching, quality claims) can be tested without installing anything or
 * touching a real database or the internet.
 *
 * Run: npm test   (or: node tests/run.js)
 */
const Module = require('module');

const stubs = new Map();
let PASS = 0;
let FAIL = 0;
const FAILURES = [];

// ── Captured console output, so tests can assert the API key never leaks ──
const LOGS = [];
const realLog = console.log;
const realError = console.error;
const realWarn = console.warn;

function captureConsole() {
  LOGS.length = 0;
  console.log = (...a) => LOGS.push(a.join(' '));
  console.error = (...a) => LOGS.push(a.join(' '));
  console.warn = (...a) => LOGS.push(a.join(' '));
}
function releaseConsole() {
  console.log = realLog;
  console.error = realError;
  console.warn = realWarn;
}
function loggedText() {
  return LOGS.join('\n');
}

// ── Stubbed axios ────────────────────────────────────────────────────
const axiosStub = {
  _handler: null,
  async get(url, config) {
    if (!axiosStub._handler) throw new Error('no axios handler set');
    return axiosStub._handler('GET', url, config);
  },
  async post(url, body, config) {
    if (!axiosStub._handler) throw new Error('no axios handler set');
    return axiosStub._handler('POST', url, { ...config, data: body });
  },
};

function httpError(status, message = 'request failed') {
  const err = new Error(message);
  if (status) err.response = { status, data: { message } };
  else err.code = 'ECONNABORTED';
  return err;
}

// ── Stubbed pg ───────────────────────────────────────────────────────
const dbStub = {
  _handler: null,
  calls: [],
  async query(text, params) {
    dbStub.calls.push({ text, params });
    if (!dbStub._handler) return { rows: [], rowCount: 0 };
    const result = await dbStub._handler(text, params);
    return result || { rows: [], rowCount: 0 };
  },
  on() {},
  reset() {
    dbStub.calls = [];
    dbStub._handler = null;
  },
};

stubs.set('axios', axiosStub);
stubs.set('pg', { Pool: function Pool() { return dbStub; } });
stubs.set('dotenv', { config: () => ({}) });

const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return originalLoad.apply(this, [request, parent, isMain]);
};

/** Load a backend module fresh, clearing its cache first. */
function freshRequire(relativePath) {
  const resolved = require.resolve(relativePath);
  delete require.cache[resolved];
  return require(resolved);
}

function clearBackendCache() {
  Object.keys(require.cache)
    .filter((k) => k.includes('/backend/') && !k.includes('/tests/'))
    .forEach((k) => delete require.cache[k]);
}

// ── Assertions ───────────────────────────────────────────────────────
function check(name, condition, detail) {
  if (condition) {
    PASS += 1;
    realLog(`  PASS  ${name}`);
  } else {
    FAIL += 1;
    FAILURES.push(name);
    realLog(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  realLog(`\n=== ${title} ===`);
}

function summary(label) {
  realLog('\n' + '='.repeat(62));
  realLog(`${label}: ${PASS} passed, ${FAIL} failed out of ${PASS + FAIL} checks`);
  if (FAIL) {
    realLog('Failures:');
    FAILURES.forEach((f) => realLog(`  - ${f}`));
    process.exitCode = 1;
  } else {
    realLog('All checks passed.');
  }
}

module.exports = {
  axiosStub, dbStub, httpError, freshRequire, clearBackendCache,
  check, section, summary, captureConsole, releaseConsole, loggedText, realLog,
};
