# KRISHINITI — AI/ML → Database 

For: Database & Data Engineer
From: AI/ML Engineer

This document covers what I need coming **in** (price data to read)
and what I need going **out** (result tables to write), plus the
access and setup details to sort out before integration.

---

## 1. Input: the price data table

Right now I'm reading `gujarat_prices_clean.csv` directly. Once
there's a database, I want a table to query instead of a CSV.

**`market_prices`**

| Column | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `commodity` | VARCHAR | e.g. "Wheat" |
| `market` | VARCHAR | e.g. "Rajkot" |
| `state` | VARCHAR | can hardcode "Gujarat" for now |
| `date` | DATE | |
| `modal_price` | NUMERIC | what I use today |
| `min_price` | NUMERIC | include if AGMARKNET provides it — useful for future volatility work even if unused right now |
| `max_price` | NUMERIC | same as above |
| `created_at` | TIMESTAMP | ingestion time, for freshness checks |

**Index needed:** composite `(commodity, market, date)` — every one
of my queries filters on this triplet.

**Questions to answer together:**
- How often does this table refresh — daily? weekly?
- Do I get read access to query it live, or will you hand me
  periodic exports?

For a prototype, a simple read-only DB user querying live is
cleanest — it avoids me depending on someone manually re-exporting a
CSV every time the data changes.

---

## 2. Output: tables for my results

Each of my pipeline stages needs its own table so results are
queryable rather than living only in local CSVs.

**`price_forecasts`**

| Column | Type |
|---|---|
| `id` | SERIAL PK |
| `commodity` | VARCHAR |
| `market` | VARCHAR |
| `forecast_date` | DATE |
| `forecast_price` | NUMERIC |
| `confidence_level` | VARCHAR (High/Medium/Low) |
| `confidence_score` | NUMERIC |
| `model_version` | VARCHAR |
| `generated_at` | TIMESTAMP |

**`risk_scores`** — matches `gujarat_risk_scores.csv` directly:

| Column | Type |
|---|---|
| `id` | SERIAL PK |
| `commodity`, `market` | VARCHAR |
| `date` | DATE |
| `risk_score` | NUMERIC |
| `risk_level` | VARCHAR |
| `volatility_score`, `trend_score`, `data_sufficiency` | NUMERIC |
| `risk_status` | VARCHAR |
| `explanation` | TEXT |
| `generated_at` | TIMESTAMP |

**`price_anomalies`** — matches `gujarat_anomalies.csv` directly:

| Column | Type |
|---|---|
| `id` | SERIAL PK |
| `commodity`, `market` | VARCHAR |
| `date` | DATE |
| `pct_change`, `zscore` | NUMERIC |
| `streak_length` | INTEGER |
| `anomaly_flag` | BOOLEAN |
| `anomaly_type` | VARCHAR |
| `anomaly_score` | NUMERIC |
| `anomaly_status` | VARCHAR |
| `explanation` | TEXT |
| `generated_at` | TIMESTAMP |

**Same composite index on each:** `(commodity, market, date)` — this
is the join key everyone downstream (Decision Engine, Backend) will
query on.

---

## 3. Access & practical setup to request

- **Write access** to the three output tables above (or agree I write
  CSVs and you load them — simpler for a hackathon, but a direct write
  via `psycopg2`/SQLAlchemy is barely more work and skips a manual
  step each time).
- **Read access** to `market_prices` and to `crop_lots` (so I can
  eventually know what a specific farmer's lot is — commodity, market,
  quantity — for per-lot recommendations rather than only
  per-commodity-market averages).
- **Connection details**: host, port, DB name, a dedicated user and
  password (or `.env` variable names) — not shared root credentials.
- **Confirm the join key spelling matches exactly** — `commodity` /
  `market` vs `crop_name` / `mandi_name`. Small naming mismatches are
  the #1 integration bug; we already hit a version of this with a
  pandas column-naming issue in my own script, so this is a real risk,
  not a hypothetical one.

---

## 4. One decision to make together now

Should my AI/ML service write directly to Postgres, or should I just
serve results over my FastAPI (`/summary`, `/risk`, `/anomaly`
endpoints), with the **Backend Engineer** responsible for persisting
them?

Either works for a prototype — but agree on **one owner** for "who
writes to these tables" now, so we don't end up with duplicate or
conflicting writes later.