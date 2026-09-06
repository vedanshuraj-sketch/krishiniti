"""
KRISHINITI - API

Exposes the AI/ML pipeline outputs (Price Forecast, Confidence Score,
Risk Score, Anomaly Detection) as HTTP endpoints so the Backend
(Node.js/Express) and Decision Engine can consume them without
touching the underlying models, CSVs, or pandas code directly.

This is a prototype service for SIH: it loads the risk score and
anomaly detection results from their pre-computed CSVs (produced by
running risk_score.py and anomaly_detection.py separately), and
calls the price forecast module live, since that one is designed to
answer per-request.

Run with:
    uvicorn src.api.main:app --reload --port 8000

Then visit http://127.0.0.1:8000/docs for interactive API docs.
"""

import importlib.util
import math
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware


# ============================================================
# PATHS
# ============================================================

BASE_DIR = Path(__file__).resolve().parents[2]

RISK_SCORES_FILE = (
    BASE_DIR / "data" / "processed" / "gujarat_risk_scores.csv"
)

ANOMALIES_FILE = (
    BASE_DIR / "data" / "processed" / "gujarat_anomalies.csv"
)

PRICE_FORECAST_SCRIPT = (
    BASE_DIR / "src" / "forecast" / "price_forecast.py"
)


# ============================================================
# LOAD THE PRICE FORECAST MODULE
#
# Loaded directly by file path (not a normal package import) so
# this works regardless of whether src/ has __init__.py files -
# matches how each script is run standalone elsewhere in this repo.
# ============================================================

def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


if not PRICE_FORECAST_SCRIPT.exists():
    raise FileNotFoundError(
        f"Price forecast script not found:\n{PRICE_FORECAST_SCRIPT}"
    )

price_forecast = _load_module(
    "price_forecast",
    PRICE_FORECAST_SCRIPT,
)


# ============================================================
# DATA LOADED ONCE AT STARTUP
# ============================================================

_price_df: Optional[pd.DataFrame] = None
_risk_df: Optional[pd.DataFrame] = None
_anomaly_df: Optional[pd.DataFrame] = None


def load_all_data():
    """Load the cleaned price data and pre-computed result CSVs once."""

    global _price_df, _risk_df, _anomaly_df

    _price_df = price_forecast.load_data()

    if RISK_SCORES_FILE.exists():
        _risk_df = pd.read_csv(RISK_SCORES_FILE)
        _risk_df["date"] = pd.to_datetime(_risk_df["date"])
    else:
        _risk_df = pd.DataFrame()

    if ANOMALIES_FILE.exists():
        _anomaly_df = pd.read_csv(ANOMALIES_FILE)
        _anomaly_df["date"] = pd.to_datetime(_anomaly_df["date"])
    else:
        _anomaly_df = pd.DataFrame()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Runs once when the server starts, before it accepts requests.
    load_all_data()
    yield
    # (Nothing to clean up on shutdown for this prototype.)


# ============================================================
# APP SETUP
# ============================================================

app = FastAPI(
    title="KRISHINITI AI/ML API",
    description=(
        "Price forecast, confidence, risk score, and anomaly "
        "detection for Gujarat mandi prices."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# Allow the Backend and Frontend to call this during development.
# Tighten this before any real deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# HELPERS
# ============================================================

def _clean_value(value):
    """
    Convert a single pandas/numpy value into something JSON-safe.

    Handles NaN (pandas' missing-value marker), numpy scalar types,
    and Timestamps, none of which the standard json encoder can
    serialize on their own.
    """

    if isinstance(value, float) and math.isnan(value):
        return None

    if pd.isna(value):
        return None

    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d")

    if hasattr(value, "item"):
        # numpy scalar (int64, float64, bool_, etc.)
        return value.item()

    return value


def _row_to_dict(row: pd.Series) -> dict:
    return {
        column: _clean_value(value)
        for column, value in row.items()
    }


def _lookup_latest(
    df: pd.DataFrame,
    commodity: str,
    market: str,
    date: Optional[str],
) -> Optional[dict]:
    """
    Find the matching row for a commodity-market pair.

    If a date is given, look for that exact date. Otherwise return
    the most recent available row for that pair.
    """

    if df.empty:
        return None

    mask = (
        df["commodity"].astype(str).str.strip().str.lower()
        == commodity.strip().lower()
    ) & (
        df["market"].astype(str).str.strip().str.lower()
        == market.strip().lower()
    )

    matches = df.loc[mask]

    if matches.empty:
        return None

    if date:
        target_date = pd.to_datetime(date, errors="coerce")

        if pd.isna(target_date):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid date format: {date}. Use YYYY-MM-DD.",
            )

        matches = matches[matches["date"] == target_date]

        if matches.empty:
            return None

        return _row_to_dict(matches.iloc[0])

    latest = matches.sort_values("date").iloc[-1]

    return _row_to_dict(latest)


def _build_overall_explanation(
    forecast_result: dict,
    risk_row: Optional[dict],
    anomaly_row: Optional[dict],
) -> str:
    """
    Combine the forecast, risk, and anomaly explanations into one
    farmer-facing summary sentence for /summary.
    """

    parts = []

    if forecast_result.get("status") == "success":
        parts.append(forecast_result["explanation"])
    else:
        parts.append(
            forecast_result.get(
                "message", "No forecast available."
            )
        )

    if anomaly_row and anomaly_row.get("anomaly_status") == "ok":
        if anomaly_row.get("anomaly_flag"):
            parts.append(anomaly_row["explanation"])
            # Anomaly is a guardrail - if flagged, say so plainly and
            # stop here rather than also giving risk-based advice on
            # data that may not be trustworthy.
            parts.append(
                "Because of this unusual activity, treat the "
                "forecast and risk score with caution."
            )
            return " ".join(parts)

    if risk_row and risk_row.get("risk_status") == "ok":
        parts.append(risk_row["explanation"])
    else:
        parts.append(
            "Not enough history yet to assess the risk of waiting."
        )

    return " ".join(parts)


# ============================================================
# ROUTES
# ============================================================

@app.get("/health")
def health():
    """Basic health check."""

    return {
        "status": "ok",
        "price_rows_loaded": (
            0 if _price_df is None else len(_price_df)
        ),
        "risk_rows_loaded": (
            0 if _risk_df is None else len(_risk_df)
        ),
        "anomaly_rows_loaded": (
            0 if _anomaly_df is None else len(_anomaly_df)
        ),
    }


@app.get("/forecast")
def get_forecast(
    commodity: str = Query(..., description="e.g. Groundnut"),
    market: str = Query(..., description="e.g. Rajkot"),
    days: int = Query(5, ge=1, le=30, description="Days to forecast"),
):
    """
    Price forecast + confidence for one commodity-market pair.

    Runs the forecast live against the cleaned price data.
    """

    result = price_forecast.forecast_prices(
        df=_price_df,
        commodity=commodity,
        market=market,
        forecast_days=days,
    )

    if result["status"] == "success":
        result["forecast"] = result["forecast"].to_dict(
            orient="records"
        )

        # Dates inside the forecast rows are pandas Timestamps.
        for row in result["forecast"]:
            row["date"] = row["date"].strftime("%Y-%m-%d")

    return result


@app.get("/risk")
def get_risk(
    commodity: str = Query(...),
    market: str = Query(...),
    date: Optional[str] = Query(
        None,
        description="YYYY-MM-DD. Omit for the most recent score.",
    ),
):
    """Risk score for one commodity-market pair."""

    row = _lookup_latest(_risk_df, commodity, market, date)

    if row is None:
        return {
            "status": "no_data",
            "commodity": commodity,
            "market": market,
            "message": (
                f"No risk score found for {commodity} at {market}."
            ),
        }

    return {"status": "success", **row}


@app.get("/anomaly")
def get_anomaly(
    commodity: str = Query(...),
    market: str = Query(...),
    date: Optional[str] = Query(
        None,
        description="YYYY-MM-DD. Omit for the most recent record.",
    ),
):
    """Anomaly detection result for one commodity-market pair."""

    row = _lookup_latest(_anomaly_df, commodity, market, date)

    if row is None:
        return {
            "status": "no_data",
            "commodity": commodity,
            "market": market,
            "message": (
                f"No anomaly record found for {commodity} at {market}."
            ),
        }

    return {"status": "success", **row}


@app.get("/summary")
def get_summary(
    commodity: str = Query(..., description="e.g. Groundnut"),
    market: str = Query(..., description="e.g. Rajkot"),
    days: int = Query(5, ge=1, le=30),
):
    """
    Combined bundle: forecast + confidence + latest risk + latest
    anomaly, all for one commodity-market pair.

    This is the single endpoint the Decision Engine should call for
    "give me everything you know about this crop at this market" -
    it hides the fact that forecast is computed live while risk and
    anomaly come from pre-computed batch results.
    """

    forecast_result = price_forecast.forecast_prices(
        df=_price_df,
        commodity=commodity,
        market=market,
        forecast_days=days,
    )

    if forecast_result["status"] == "success":
        forecast_result["forecast"] = forecast_result["forecast"].to_dict(
            orient="records"
        )
        for row in forecast_result["forecast"]:
            row["date"] = row["date"].strftime("%Y-%m-%d")

    risk_row = _lookup_latest(_risk_df, commodity, market, date=None)
    anomaly_row = _lookup_latest(_anomaly_df, commodity, market, date=None)

    overall_explanation = _build_overall_explanation(
        forecast_result, risk_row, anomaly_row
    )

    return {
        "commodity": commodity,
        "market": market,
        "forecast": forecast_result,
        "risk": risk_row or {"status": "no_data"},
        "anomaly": anomaly_row or {"status": "no_data"},
        "overall_explanation": overall_explanation,
    }