#!/usr/bin/env node
/**
 * Manual official-data sync.
 *
 *   npm run sync:mandi
 *   node scripts/syncMandi.js --commodity Groundnut --markets Rajkot,Gondal
 *
 * Pulls the demo scope (Gujarat / Groundnut / five Saurashtra markets) by
 * default. Never prints the API key.
 */
require('dotenv').config();
const client = require('../services/mandiDataClient');
const sync = require('../services/mandiSyncService');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

(async () => {
  const scope = {
    state: arg('state', client.DEFAULT_SCOPE.state),
    commodities: arg('commodity', client.DEFAULT_SCOPE.commodities.join(','))
      .split(',').map((s) => s.trim()).filter(Boolean),
    markets: arg('markets', client.DEFAULT_SCOPE.markets.join(','))
      .split(',').map((s) => s.trim()).filter(Boolean),
  };

  console.log('Scope:', JSON.stringify(scope));
  console.log('API key configured:', client.isConfigured() ? 'yes' : 'NO');

  if (!client.isConfigured()) {
    console.error(
      '\n✗ DATA_GOV_API_KEY is not set.\n' +
      '  Register free at https://data.gov.in, copy your key, and set\n' +
      '  DATA_GOV_API_KEY in backend/.env. No data was fetched.'
    );
    process.exit(1);
  }

  try {
    const result = await sync.runSync({ scope, triggeredBy: 'cli' });
    console.log('\nRun:', JSON.stringify(result.run, null, 2));
    if (result.errors?.length) console.warn('Errors:', result.errors);
    process.exit(result.ok ? 0 : 2);
  } catch (err) {
    console.error('✗ sync failed:', client.redact(err.message));
    process.exit(1);
  }
})();
