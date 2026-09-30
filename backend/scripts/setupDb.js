#!/usr/bin/env node
/**
 * Database setup + demo buyer seed.
 *
 *   npm run db:setup
 *
 * Idempotent and non-destructive: schema.sql only uses CREATE IF NOT
 * EXISTS / ADD COLUMN IF NOT EXISTS, and buyers are upserted on
 * (name, market). Existing data is never dropped.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function applySchema() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✓ schema applied (idempotent)');
}

async function seedBuyers() {
  const file = path.join(__dirname, '..', 'data', 'demo_buyers.json');
  const { buyers } = JSON.parse(fs.readFileSync(file, 'utf8'));

  let inserted = 0;
  let updated = 0;

  for (const b of buyers) {
    const result = await pool.query(
      `INSERT INTO buyers
         (name, buyer_type, intended_use, industry, crops_accepted,
          grade_requirement, min_quantity, max_quantity, market, distance_km,
          offered_price, unit, requires_certification, quality_requirement,
          commission_rate, transport_cost, is_available, is_demo, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'quintal',$12,$13,$14,$15,$16,TRUE,$17)
       ON CONFLICT (name, market) DO UPDATE SET
         buyer_type = EXCLUDED.buyer_type,
         intended_use = EXCLUDED.intended_use,
         industry = EXCLUDED.industry,
         crops_accepted = EXCLUDED.crops_accepted,
         grade_requirement = EXCLUDED.grade_requirement,
         min_quantity = EXCLUDED.min_quantity,
         max_quantity = EXCLUDED.max_quantity,
         distance_km = EXCLUDED.distance_km,
         offered_price = EXCLUDED.offered_price,
         requires_certification = EXCLUDED.requires_certification,
         quality_requirement = EXCLUDED.quality_requirement,
         commission_rate = EXCLUDED.commission_rate,
         transport_cost = EXCLUDED.transport_cost,
         is_available = EXCLUDED.is_available,
         notes = EXCLUDED.notes
       RETURNING (xmax = 0) AS was_inserted`,
      [
        b.name, b.buyer_type, b.intended_use, b.industry, b.crops_accepted,
        b.grade_requirement, b.min_quantity, b.max_quantity, b.market,
        b.distance_km, b.offered_price, b.requires_certification,
        b.quality_requirement ||
          (b.requires_certification ? 'certificate_required' : 'self_declared'),
        b.commission_rate, b.transport_cost, b.is_available, b.notes,
      ]
    );
    if (result.rows[0].was_inserted) inserted += 1;
    else updated += 1;
  }

  console.log(`✓ demo buyers seeded: ${inserted} inserted, ${updated} updated`);
  console.log('  (all rows are flagged is_demo = TRUE)');
}

(async () => {
  try {
    if (!process.env.DATABASE_URL) {
      console.error('✗ DATABASE_URL is not set. Copy .env.example to .env first.');
      process.exit(1);
    }
    await applySchema();
    await seedBuyers();
    const valueChain = require('../services/valueChain');
    const vcCount = await valueChain.seedIntoDb(pool);
    await valueChain.loadFromSql();
    console.log(`✓ crop value chain seeded: ${vcCount} rows in crop_value_chain`);
    console.log('\nDatabase ready.');
    process.exit(0);
  } catch (err) {
    console.error('✗ setup failed:', err.message);
    process.exit(1);
  }
})();
