# KRISHINITI AI/ML API

For: Backend Engineer, Optimization & Decision Engine Engineer
From: AI/ML Engineer

This service exposes Price Forecast, Confidence Score, Risk Score, and
Anomaly Detection over HTTP. You should never need to touch the
underlying Python/pandas code, models, or CSVs directly — call these
endpoints instead.

---

## Running it locally

```powershell
cd ai-ml
py -m uvicorn src.api.main:app --reload --port 8000
```

Interactive docs (try every endpoint from the browser, no code needed):
```
http://127.0.0.1:8000/docs
```

Base URL for all requests below: `http://127.0.0.1:8000`

---

## The join key — same everywhere

Every request and response uses:

```
commodity + market   (and optionally a date)
```

e.g. `commodity=Groundnut`, `market=Rajkot`. Matching is
case-insensitive and whitespace-tolerant on the server side, but send
clean values where you can.

---

## Endpoints

### `GET /health`
Confirms the service is up and how much data it loaded.

**Example response:**
```json
{
  "status": "ok",
  "price_rows_loaded": 107555,
  "risk_rows_loaded": 102006,
  "anomaly_rows_loaded": 104279
}
```

---

### `GET /summary` — the one you probably want

Combined bundle: forecast + confidence + latest risk + latest anomaly,
all for one commodity-market pair, in a single call.

**Request:**
```
GET /summary?commodity=Groundnut&market=Rajkot&days=5
```

**Response shape:**
```json
{
  "commodity": "Groundnut",
  "market": "Rajkot",
  "forecast": {
    "status": "success",
    "last_price": 5075.0,
    "trend": "Stable",
    "confidence": "High",
    "confidence_reason": "Sufficient history with relatively stable prices.",
    "volatility_cv": 0.0671,
    "forecast": [
      { "date": "2025-08-13", "predicted_price": 5144.01, "lower_bound": 4782.44, "upper_bound": 5505.59 }
    ]
  },
  "risk": {
    "risk_score": 38.9,
    "risk_level": "Medium",
    "risk_status": "ok",
    "explanation": "Medium Risk because moderate price volatility and prices are relatively stable."
  },
  "anomaly": {
    "anomaly_flag": false,
    "anomaly_type": "none",
    "anomaly_score": 0.0,
    "anomaly_status": "ok",
    "explanation": "No unusual price behaviour detected."
  }
}
```

**Decision Engine — how to use each field:**
- `forecast.confidence` = "Low" → soften or suppress any "wait for a better price" recommendation. Low confidence means the trend/prediction shouldn't be trusted much.
- `risk.risk_level` = "High" → leans toward recommending sell now, even if the forecast trend says wait. This is the main tension your Sell/Store/Split logic needs to arbitrate.
- `anomaly.anomaly_flag` = `true` → treat the forecast and risk numbers for this pair with reduced trust. Consider showing "unusual market activity — recommend checking manually" instead of a specific number.
- `risk.explanation` / `anomaly.explanation` → pass these straight through to your own recommendation output rather than regenerating reasoning. Keeps the "why" consistent with the actual model logic.

---

### `GET /forecast`
Live price forecast + confidence, computed on demand.

```
GET /forecast?commodity=Groundnut&market=Rajkot&days=5
```

| Param | Required | Notes |
|---|---|---|
| `commodity` | yes | |
| `market` | yes | |
| `days` | no | default 5, max 30 |

---

### `GET /risk`
Risk score for one commodity-market pair.

```
GET /risk?commodity=Groundnut&market=Rajkot
GET /risk?commodity=Groundnut&market=Rajkot&date=2025-08-12
```

Omit `date` to get the most recent available score. **Served from a
pre-computed CSV, not recalculated live** — see "Data freshness" below.

---

### `GET /anomaly`
Same pattern as `/risk`, for anomaly detection results.

```
GET /anomaly?commodity=Groundnut&market=Rajkot
```

---

## Status fields — handle these, don't assume success

Every endpoint can return something other than `"status": "success"`.
**Do not treat a missing/null score as zero risk or "no anomaly" — it
means unknown, not safe.**

| Status | Meaning | What to do |
|---|---|---|
| `"success"` | Normal result | Use the data |
| `"insufficient_data"` | Pair exists but has too little history (< 14–5 observations depending on the endpoint) | Show "not enough history yet" — don't fabricate a recommendation |
| `"no_data"` | Commodity/market combo doesn't exist in the dataset at all (typo, or genuinely uncovered market) | Show "no data available for this crop/market" |
| HTTP `400` | Bad input, e.g. malformed date | Fix the request; check the `detail` field in the response |

**Example insufficient/no-data response (still HTTP 200, check the
`status` field, not the HTTP code):**
```json
{
  "status": "no_data",
  "commodity": "Mango",
  "market": "Nowhere",
  "message": "No price data found for Mango at Nowhere."
}
```

---

## Data freshness — important

- `/forecast` runs the model **live** against `gujarat_prices_clean.csv` every request.
- `/risk` and `/anomaly` are served from **pre-computed CSVs** (`gujarat_risk_scores.csv`, `gujarat_anomalies.csv`), loaded into memory once when the API starts.
- If the underlying price data changes, someone needs to re-run `risk_score.py` and `anomaly_detection.py`, **then restart the API**, for `/risk` and `/anomaly` to reflect it. This won't happen automatically.

---

## Known limitations (be aware, not blockers for demo)

- Not every commodity-market-date will have a forecast, risk score, AND anomaly result all present at once — coverage can differ slightly between pipeline stages. Decide whether your logic requires all three before recommending, or degrades gracefully if one is `no_data`.
- CORS is currently wide open (`allow_origins=["*"]`) for ease of local development. Fine for the hackathon; note it as a "tighten before real deployment" item if this ever goes further.
- Anomaly detection currently flags ~7% of records — tuned loosely for a prototype, not a strict statistical threshold.

---

## Questions / issues

Ping the AI/ML engineer with the exact request URL and response you got — that's enough to debug most integration issues quickly.