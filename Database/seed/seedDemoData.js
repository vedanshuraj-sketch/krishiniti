#!/usr/bin/env node
/**
 * Seed demo farmers and crop lots for prototype presentation.
 *
 *   node scripts/seedDemoData.js
 *
 * Creates 5 demo farmer accounts (or updates them if they already exist)
 * and inserts pre-populated crop lots so the app has data to show
 * immediately without requiring any manual data entry.
 *
 * All demo accounts use the password "demo1234".
 *
 * Idempotent: re-running updates existing users and skips duplicate lots
 * (matched on farmer_id + commodity + market + quantity).
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

const DEMO_PASSWORD = 'demo1234';

const DEMO_FARMERS = [
  {
    name: 'Ramesh Patel',
    email: 'ramesh@demo.krishiniti',
    role: 'farmer',
    lots: [
      {
        commodity: 'Groundnut',
        market: 'Rajkot',
        quantity: 25,
        unit: 'quintal',
        grade: 'Grade A',
        storage_available: true,
        storage_cost_per_unit_per_day: 2.0,
        cash_requirement: 1200,
        transport_cost: 1500,
        risk_tolerance: 0.5,
        quality_method: 'self_declared',
        quality_notes: 'Good quality bold groundnut, freshly harvested from Saurashtra region.',
        moisture_percent: 7.5,
        size_description: 'Bold',
        appearance_description: 'Clean, uniform size, light brown shells',
      },
      {
        commodity: 'Groundnut',
        market: 'Gondal',
        quantity: 15,
        unit: 'quintal',
        grade: 'Grade B',
        storage_available: false,
        cash_requirement: 3000,
        transport_cost: 800,
        risk_tolerance: 0.3,
        quality_method: 'camera_assisted',
        quality_notes: 'Second lot, slightly smaller kernels. Photos taken for review.',
        moisture_percent: 8.2,
        quality_photo_count: 3,
      },
    ],
  },
  {
    name: 'Suresh Sharma',
    email: 'suresh@demo.krishiniti',
    role: 'farmer',
    lots: [
      {
        commodity: 'Groundnut',
        market: 'Junagadh',
        quantity: 40,
        unit: 'quintal',
        grade: 'Grade A',
        storage_available: true,
        storage_cost_per_unit_per_day: 1.5,
        cash_requirement: 0,
        transport_cost: 2200,
        risk_tolerance: 0.7,
        quality_method: 'certificate_upload',
        quality_notes: 'APEDA certificate for export quality groundnut.',
        moisture_percent: 6.8,
        size_description: 'Bold premium',
        appearance_description: 'Premium export grade, hand-sorted',
        certificate_status: 'uploaded_unverified',
        certificate_filename: 'apeda_cert_2026.pdf',
        certificate_mime_type: 'application/pdf',
        certificate_size_bytes: 245000,
      },
    ],
  },
  {
    name: 'Meena Devi',
    email: 'meena@demo.krishiniti',
    role: 'farmer',
    lots: [
      {
        commodity: 'Groundnut',
        market: 'Amreli',
        quantity: 12,
        unit: 'quintal',
        grade: 'Grade A',
        storage_available: true,
        storage_cost_per_unit_per_day: 3.0,
        cash_requirement: 5000,
        transport_cost: 600,
        risk_tolerance: 0.2,
        quality_method: 'self_declared',
        quality_notes: 'Small family farm harvest. Need cash urgently for next season seeds.',
        moisture_percent: 8.0,
        size_description: 'Medium',
        appearance_description: 'Clean, no visible damage',
      },
    ],
  },
  {
    name: 'Arjun Singh',
    email: 'arjun@demo.krishiniti',
    role: 'farmer',
    lots: [
      {
        commodity: 'Groundnut',
        market: 'Rajkot',
        quantity: 60,
        unit: 'quintal',
        grade: 'Grade A',
        storage_available: true,
        storage_cost_per_unit_per_day: 1.0,
        cash_requirement: 0,
        transport_cost: 3500,
        risk_tolerance: 0.8,
        quality_method: 'self_declared',
        quality_notes: 'Large lot from cooperative. Own godown available, no urgency to sell.',
        moisture_percent: 7.0,
        size_description: 'Bold',
        appearance_description: 'Well-dried, uniform, clean lot',
      },
      {
        commodity: 'Groundnut',
        market: 'Jamnagar',
        quantity: 20,
        unit: 'quintal',
        grade: 'Grade B',
        storage_available: false,
        cash_requirement: 8000,
        transport_cost: 1800,
        risk_tolerance: 0.4,
        quality_method: 'camera_assisted',
        quality_notes: 'Secondary lot, photos taken. Transport to Jamnagar mandi arranged.',
        quality_photo_count: 5,
      },
    ],
  },
  {
    name: 'Lakshmi Bai',
    email: 'lakshmi@demo.krishiniti',
    role: 'farmer',
    lots: [
      {
        commodity: 'Groundnut',
        market: 'Gondal',
        quantity: 18,
        unit: 'quintal',
        grade: 'Grade A',
        storage_available: true,
        storage_cost_per_unit_per_day: 2.5,
        cash_requirement: 2000,
        transport_cost: 900,
        risk_tolerance: 0.6,
        quality_method: 'self_declared',
        quality_notes: 'Organic farming, no pesticide. Self-declared organic quality.',
        moisture_percent: 7.2,
        size_description: 'Bold',
        appearance_description: 'Organic, light-coloured, well sorted',
      },
    ],
  },
];

async function seedDemoData() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  let usersCreated = 0;
  let usersUpdated = 0;
  let lotsCreated = 0;

  for (const farmer of DEMO_FARMERS) {
    // Upsert user
    const userResult = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash
       RETURNING id, (xmax = 0) AS was_inserted`,
      [farmer.name, farmer.email, passwordHash, farmer.role]
    );

    const userId = userResult.rows[0].id;
    if (userResult.rows[0].was_inserted) usersCreated++;
    else usersUpdated++;

    console.log(`  ${userResult.rows[0].was_inserted ? '✓ Created' : '↻ Updated'} farmer: ${farmer.name} (${farmer.email}) → id ${userId}`);

    // Insert crop lots
    for (const lot of farmer.lots) {
      // Check if lot already exists (same farmer + commodity + market + quantity)
      const existing = await pool.query(
        `SELECT id FROM crop_lots
         WHERE farmer_id = $1 AND commodity = $2 AND market = $3 AND quantity = $4`,
        [userId, lot.commodity, lot.market, lot.quantity]
      );

      if (existing.rows.length > 0) {
        console.log(`    ↻ Lot already exists: ${lot.commodity} ${lot.quantity}q @ ${lot.market} (id ${existing.rows[0].id})`);
        continue;
      }

      const result = await pool.query(
        `INSERT INTO crop_lots (
           farmer_id, commodity, market, quantity, unit, grade,
           storage_available, storage_cost_per_unit_per_day,
           cash_requirement, transport_cost, risk_tolerance,
           quality_method, quality_notes, moisture_percent,
           size_description, appearance_description,
           quality_photo_count, certificate_status,
           certificate_filename, certificate_mime_type, certificate_size_bytes,
           status
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11,
           $12, $13, $14, $15, $16,
           $17, $18, $19, $20, $21,
           'open'
         ) RETURNING id`,
        [
          userId,
          lot.commodity,
          lot.market,
          lot.quantity,
          lot.unit || 'quintal',
          lot.grade || null,
          lot.storage_available || false,
          lot.storage_cost_per_unit_per_day || null,
          lot.cash_requirement || 0,
          lot.transport_cost || 0,
          lot.risk_tolerance || null,
          lot.quality_method || 'self_declared',
          lot.quality_notes || null,
          lot.moisture_percent || null,
          lot.size_description || null,
          lot.appearance_description || null,
          lot.quality_photo_count || 0,
          lot.certificate_status || 'not_uploaded',
          lot.certificate_filename || null,
          lot.certificate_mime_type || null,
          lot.certificate_size_bytes || null,
        ]
      );

      lotsCreated++;
      console.log(`    ✓ Created lot: ${lot.commodity} ${lot.quantity}q @ ${lot.market} (id ${result.rows[0].id})`);
    }
  }

  console.log(`\n══════════════════════════════════════════════`);
  console.log(`Demo data seeded successfully!`);
  console.log(`  Farmers: ${usersCreated} created, ${usersUpdated} updated`);
  console.log(`  Crop lots: ${lotsCreated} created`);
  console.log(`\n  All accounts use password: ${DEMO_PASSWORD}`);
  console.log(`\n  Demo farmer emails:`);
  for (const f of DEMO_FARMERS) {
    console.log(`    ${f.name.padEnd(16)} → ${f.email}`);
  }
  console.log(`══════════════════════════════════════════════\n`);
}

(async () => {
  try {
    if (!process.env.DATABASE_URL) {
      console.error('✗ DATABASE_URL is not set. Copy .env.example to .env first.');
      process.exit(1);
    }
    await seedDemoData();
    process.exit(0);
  } catch (err) {
    console.error('✗ seed failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
