# KRISHINITI Backend

Node.js / Express backend: Auth, Crop Lot CRUD, Market Intelligence, and
Recommendation APIs. This is the integration hub — it's the only thing
the Frontend talks to, and it's the only thing that talks to the AI/ML API.

## Setup

```bash
npm install
cp .env.example .env
# fill in DATABASE_URL, JWT_SECRET, AI_ML_API_URL in .env

# create tables
psql "$DATABASE_URL" -f schema.sql

npm run dev   # or: npm start
```

Confirm it's alive: `GET http://localhost:5000/health`

## Endpoints

### Auth (public)
- `POST /api/auth/register` — body: `{ name, email, password, role }` (`role`: `farmer` | `buyer`)
- `POST /api/auth/login` — body: `{ email, password }` → returns `{ user, token }`

All routes below require `Authorization: Bearer <token>` from login/register.

### Crop Lots
- `POST /api/crop-lots` — body: `{ commodity, market, quantity, unit? }`
- `GET /api/crop-lots` — list the logged-in farmer's lots
- `GET /api/crop-lots/:id`
- `PUT /api/crop-lots/:id`

**Important:** `commodity` and `market` spelling must exactly match what
the AI/ML API expects (check its docs/CSV) — mismatches here are the
most common integration bug.

### Market Intelligence
- `GET /api/market/prices?commodity=X&market=Y&days=30` — raw historical prices for charts
- `GET /api/market/commodities` — distinct commodity list for dropdowns

Reads from `Database.market_prices`, which is a **separate copy** of
price data from what the AI/ML API uses for forecasting. Expect the two
to drift slightly if one is refreshed and the other isn't — this is a
known, accepted tradeoff for the prototype, not a bug.

### Recommendation (the critical integration point)
- `GET /api/recommendation/:cropLotId?days=7`
  Full chain: loads the crop lot → calls AI/ML API's `/summary` → runs
  Decision Engine logic → saves to `recommendations` → returns one
  clean response with forecast, confidence, risk, decision, and Net
  Realisation.
- `POST /api/recommendation/:cropLotId/what-if` — body: `{ extraDays }`
- `GET /api/recommendation/:cropLotId/history`

## Decision Engine

Lives in `decisionEngine.js` as a plain module — not a deployed service.
`routes/recommendation.js` imports it directly. Logic:
- **wait** if an anomaly is detected, confidence is low, or price is trending up ≥5%
- **sell** if price is trending down ≥5%, or expected to stay flat
- **split** if price movement is small and confidence is medium

Net Realisation = `(price × quantity) − mandi fee/commission deduction (default 2%)`.

What-If Simulator projects a naive linear trend from the AI/ML API's
forecast window — flagged in code as a simplification worth revisiting
once the AI/ML Engineer confirms whether day-by-day forecasts are available.

## Before demo day — the one thing that matters most

Run one real request end to end:
`POST /api/auth/register` → `POST /api/crop-lots` → `GET /api/recommendation/:id`

If that chain returns a real number, the hardest integration risk
(field mismatches, wrong URLs, auth issues) is already retired.
