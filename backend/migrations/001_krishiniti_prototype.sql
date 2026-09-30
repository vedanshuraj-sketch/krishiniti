-- ============================================================
-- KRISHINITI Database Schema
--
-- Idempotent: safe to run repeatedly against an existing database.
-- Everything added after the original prototype uses
-- CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so no existing
-- data is dropped or rewritten.
--
-- Run with:  psql "$DATABASE_URL" -f backend/schema.sql
--        or: npm run db:setup     (from backend/)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('farmer', 'buyer')),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- CROP LOTS
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crop_lots (
  id SERIAL PRIMARY KEY,
  farmer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commodity VARCHAR(100) NOT NULL,   -- must match AI/ML API's expected spelling exactly
  market VARCHAR(100) NOT NULL,      -- must match AI/ML API's expected spelling exactly
  quantity NUMERIC(10, 2) NOT NULL,
  unit VARCHAR(20) DEFAULT 'quintal',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Fields the UI already collected but the schema used to discard, plus the
-- decision inputs the optimizer needs.
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS grade VARCHAR(50);
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS availability_date DATE;
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS storage_available BOOLEAN DEFAULT FALSE;
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS storage_cost_per_unit_per_day NUMERIC(10, 2);
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS cash_requirement NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS transport_cost NUMERIC(10, 2) DEFAULT 0;
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS risk_tolerance NUMERIC(4, 2);

-- Certificate handling.
--   not_uploaded        - nothing supplied
--   uploaded_unverified - a document's metadata was recorded; NOBODY has checked it
--   verified            - checked by a verifying authority. NOT reachable in this
--                         prototype: no verification workflow exists yet.
-- Only file metadata is stored. There is no file upload/storage pipeline, and
-- the app must never present an uploaded certificate as verified.
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS certificate_status VARCHAR(30)
  DEFAULT 'not_uploaded';
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS certificate_filename VARCHAR(255);
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS certificate_mime_type VARCHAR(100);
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS certificate_size_bytes INTEGER;
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS certificate_uploaded_at TIMESTAMP;

ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'open';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crop_lots_certificate_status_chk'
  ) THEN
    ALTER TABLE crop_lots ADD CONSTRAINT crop_lots_certificate_status_chk
      CHECK (certificate_status IN ('not_uploaded', 'uploaded_unverified', 'verified'));
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- QUALITY ASSESSMENT (crop_lots)
--
-- A certificate is NOT required to create a crop lot. Three methods are
-- supported and each carries a different, non-upgradable claim strength:
--
--   certificate_upload - metadata only; "Certificate uploaded - verification
--                        pending". No verification workflow exists.
--   self_declared      - "Farmer self-declared quality". No verification.
--   camera_assisted    - photos only. Without a computer-vision model this
--                        is "Photos captured for buyer review - not a
--                        verified quality grade".
--
-- None of these ever becomes a certified or laboratory grade in this build.
-- ────────────────────────────────────────────────────────────
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS quality_method VARCHAR(30)
  DEFAULT 'self_declared';
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS quality_notes TEXT;
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS moisture_percent NUMERIC(5, 2);
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS size_description VARCHAR(120);
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS appearance_description VARCHAR(120);
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS quality_photo_count INTEGER DEFAULT 0;
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS quality_photos JSONB;
-- Populated only if a visual scoring heuristic is actually implemented.
-- NULL means no app-assisted assessment was produced.
ALTER TABLE crop_lots ADD COLUMN IF NOT EXISTS visual_assessment JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crop_lots_quality_method_chk'
  ) THEN
    ALTER TABLE crop_lots ADD CONSTRAINT crop_lots_quality_method_chk
      CHECK (quality_method IN ('certificate_upload', 'self_declared', 'camera_assisted'));
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- MARKET PRICES — official daily mandi records from data.gov.in / AGMARKNET
--
-- IMPORTANT: this is DAILY REPORTED mandi data, not real-time tick data.
-- Every row carries the date the market reported it (price_date) and the
-- time we pulled it (fetched_at). Those are different things and the UI
-- must show both.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_prices (
  id SERIAL PRIMARY KEY,
  commodity VARCHAR(100) NOT NULL,
  market VARCHAR(100) NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  price_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Columns added for the official pipeline. `price` is retained and kept in
-- sync with `modal_price` so any older code keeps working.
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS variety VARCHAR(100);
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS state VARCHAR(100);
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS district VARCHAR(100);
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS min_price NUMERIC(10, 2);
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS max_price NUMERIC(10, 2);
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS modal_price NUMERIC(10, 2);
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS source VARCHAR(40) DEFAULT 'AGMARKNET';
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS source_record_id VARCHAR(120);
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMP;

-- Backfill so old rows satisfy the uniqueness key.
UPDATE market_prices SET modal_price = price WHERE modal_price IS NULL;
UPDATE market_prices SET source = 'AGMARKNET' WHERE source IS NULL;
UPDATE market_prices SET state = 'Gujarat' WHERE state IS NULL;
UPDATE market_prices SET district = market WHERE district IS NULL;
UPDATE market_prices SET variety = '' WHERE variety IS NULL;

ALTER TABLE market_prices ALTER COLUMN variety SET DEFAULT '';

-- Idempotent imports: one row per market report per day per variety.
-- COALESCE is unnecessary because variety defaults to '' (never NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_market_prices_official
  ON market_prices (source, commodity, variety, state, district, market, price_date);

CREATE INDEX IF NOT EXISTS idx_market_prices_latest
  ON market_prices (commodity, market, price_date DESC);

-- ────────────────────────────────────────────────────────────
-- SYNC RUN AUDIT — every attempt to pull official data, success or not
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_data_sync_runs (
  id SERIAL PRIMARY KEY,
  source VARCHAR(40) NOT NULL DEFAULT 'AGMARKNET',
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'failed'
    CHECK (status IN ('success', 'partial', 'failed', 'running')),
  records_received INTEGER DEFAULT 0,
  records_inserted INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_rejected INTEGER DEFAULT 0,
  error_message TEXT,
  last_available_price_date DATE,
  scope JSONB,
  triggered_by VARCHAR(20) DEFAULT 'manual',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_recent
  ON market_data_sync_runs (source, started_at DESC);

-- ────────────────────────────────────────────────────────────
-- BUYERS  — seeded demo data only
--
-- Every row here is fabricated for the prototype. No buyer has agreed to
-- anything, no demand feed is connected, and prices are illustrative.
-- is_demo is TRUE on every seeded row and the API always returns it.
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS buyers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  buyer_type VARCHAR(80) NOT NULL,           -- Oil Processor, Exporter, Processor, ...
  intended_use VARCHAR(200),                 -- value channel, e.g. "Groundnut Oil"
  industry VARCHAR(80),                      -- Food, Textile, Pharma, ...
  crops_accepted TEXT[] NOT NULL,
  grade_requirement VARCHAR(50),             -- NULL = any grade accepted
  min_quantity NUMERIC(10, 2) DEFAULT 0,
  max_quantity NUMERIC(10, 2),
  market VARCHAR(100),                       -- buyer's base market
  distance_km NUMERIC(6, 1),                 -- indicative distance, demo value
  offered_price NUMERIC(10, 2),              -- demo indicative price, INR/quintal
  unit VARCHAR(20) DEFAULT 'quintal',
  requires_certification BOOLEAN DEFAULT FALSE,
  -- What quality evidence this buyer will accept:
  --   self_declared       - a farmer's own declaration is enough
  --   photo_review        - photos are enough for a first look
  --   certificate_required- a certificate is mandatory
  quality_requirement VARCHAR(30) DEFAULT 'self_declared',
  commission_rate NUMERIC(5, 4) DEFAULT 0.01,
  transport_cost NUMERIC(10, 2) DEFAULT 0,   -- indicative delivery cost, demo value
  is_available BOOLEAN DEFAULT TRUE,
  is_demo BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (name, market)
);

-- ────────────────────────────────────────────────────────────
-- OFFERS  — the persisted interest / offer workflow
--
-- Prototype state machine, no payment or logistics integration:
--   pending -> accepted | rejected | withdrawn
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offers (
  id SERIAL PRIMARY KEY,
  crop_lot_id INTEGER NOT NULL REFERENCES crop_lots(id) ON DELETE CASCADE,
  buyer_id INTEGER REFERENCES buyers(id) ON DELETE SET NULL,
  farmer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  initiated_by VARCHAR(10) NOT NULL DEFAULT 'farmer'
    CHECK (initiated_by IN ('farmer', 'buyer')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  quantity NUMERIC(10, 2) NOT NULL,
  unit VARCHAR(20) DEFAULT 'quintal',
  indicative_price NUMERIC(10, 2),           -- demo price at time of interest
  match_score NUMERIC(5, 2),
  match_reasons JSONB,
  message TEXT,
  is_demo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- RECOMMENDATIONS — audit trail of what was shown to the farmer
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recommendations (
  id SERIAL PRIMARY KEY,
  farmer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crop_lot_id INTEGER NOT NULL REFERENCES crop_lots(id) ON DELETE CASCADE,
  decision VARCHAR(20) NOT NULL,        -- SELL | STORE | SPLIT | AGGREGATE | UNAVAILABLE
  net_realisation NUMERIC(12, 2),
  forecast_summary JSONB,               -- raw AI/ML API response, for audit/debugging
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS allocation JSONB;
ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS decision_payload JSONB;

-- ────────────────────────────────────────────────────────────
-- INDEXES
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_market_prices_lookup
  ON market_prices (commodity, market, price_date);

CREATE INDEX IF NOT EXISTS idx_crop_lots_farmer
  ON crop_lots (farmer_id);

CREATE INDEX IF NOT EXISTS idx_offers_lot ON offers (crop_lot_id);
CREATE INDEX IF NOT EXISTS idx_offers_farmer ON offers (farmer_id);
CREATE INDEX IF NOT EXISTS idx_offers_buyer ON offers (buyer_id);
CREATE INDEX IF NOT EXISTS idx_buyers_available ON buyers (is_available);

ALTER TABLE buyers ADD COLUMN IF NOT EXISTS quality_requirement VARCHAR(30)
  DEFAULT 'self_declared';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'buyers_quality_requirement_chk'
  ) THEN
    ALTER TABLE buyers ADD CONSTRAINT buyers_quality_requirement_chk
      CHECK (quality_requirement IN ('self_declared', 'photo_review', 'certificate_required'));
  END IF;
END $$;
