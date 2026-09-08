-- KRISHINITI Database Schema

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('farmer', 'buyer')),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS crop_lots (
  id SERIAL PRIMARY KEY,
  farmer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commodity VARCHAR(100) NOT NULL,   -- must match AI/ML API's expected spelling exactly
  market VARCHAR(100) NOT NULL,      -- must match AI/ML API's expected spelling exactly
  quantity NUMERIC(10, 2) NOT NULL,
  unit VARCHAR(20) DEFAULT 'quintal',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_prices (
  id SERIAL PRIMARY KEY,
  commodity VARCHAR(100) NOT NULL,
  market VARCHAR(100) NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  price_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recommendations (
  id SERIAL PRIMARY KEY,
  farmer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crop_lot_id INTEGER NOT NULL REFERENCES crop_lots(id) ON DELETE CASCADE,
  decision VARCHAR(20) NOT NULL,        -- 'sell', 'wait', 'split'
  net_realisation NUMERIC(12, 2),
  forecast_summary JSONB,               -- raw AI/ML API response, for audit/debugging
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_prices_lookup
  ON market_prices (commodity, market, price_date);

CREATE INDEX IF NOT EXISTS idx_crop_lots_farmer
  ON crop_lots (farmer_id);
