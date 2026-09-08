"""
AI-ML Client Adapter
====================

Bridge between the Core Optimization Engine and the AI-ML forecasting
service.  Calls the AI-ML REST API and transforms the JSON response
into a ``MarketPrediction`` dataclass that ``engine.optimizer.optimize``
can consume directly.

Usage::

    from port.aiml_client import fetch_market_prediction

    prediction, metadata = fetch_market_prediction(
        commodity="Groundnut",
        market="Rajkot",
        forecast_days=5,
    )

The *metadata* dict carries anomaly flags, confidence levels, and
human-readable explanations that the recommendation layer can use
for guardrail logic.
"""

from __future__ import annotations

import logging
import sys
import os

# ── Make sure the project root (Core/) is on sys.path so that
#    ``from engine.models import ...`` works when this file is
#    imported from any working directory.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

import requests
from engine.models import MarketPrediction

logger = logging.getLogger(__name__)

# ── Configuration ───────────────────────────────────────────────
# Default base URL for the AI-ML FastAPI service.
# Override via environment variable or function argument.
AIML_BASE_URL = os.environ.get("AIML_BASE_URL", "http://localhost:8000")

# Storage cost is a physical / logistical constant, not an ML output.
# This default can be overridden per-call or via env var.
DEFAULT_STORAGE_COST = float(os.environ.get("DEFAULT_STORAGE_COST", "1.5"))

# HTTP timeout in seconds for AI-ML API calls.
REQUEST_TIMEOUT = int(os.environ.get("AIML_TIMEOUT", "10"))

# Default volatility when AI-ML risk data is unavailable.
DEFAULT_VOLATILITY = 50.0


def fetch_market_prediction(
    commodity: str,
    market: str,
    forecast_days: int = 5,
    storage_cost_per_day: float | None = None,
    aiml_url: str | None = None,
) -> tuple[MarketPrediction, dict]:
    """
    Call the AI-ML ``/summary`` endpoint and return a
    ``(MarketPrediction, metadata)`` tuple.

    Parameters
    ----------
    commodity : str
        Crop name (e.g. ``"Groundnut"``, ``"Wheat"``).
    market : str
        Mandi / APMC market name (e.g. ``"Rajkot"``).
    forecast_days : int
        Number of days to forecast (1–30).
    storage_cost_per_day : float or None
        ₹/kg/day storage cost.  Falls back to ``DEFAULT_STORAGE_COST``.
    aiml_url : str or None
        Base URL of the AI-ML service.  Falls back to ``AIML_BASE_URL``.

    Returns
    -------
    prediction : MarketPrediction
        Populated dataclass ready for ``optimize()``.
    metadata : dict
        Extra AI-ML signals for guardrail / presentation logic:
        ``confidence``, ``trend``, ``anomaly_flag``, ``anomaly_type``,
        ``anomaly_score``, ``risk_level``, ``risk_score``,
        ``overall_explanation``.

    Raises
    ------
    ConnectionError
        If the AI-ML service is unreachable after retries.
    requests.HTTPError
        If the AI-ML service returns a 4xx / 5xx status.
    """
    base_url = (aiml_url or AIML_BASE_URL).rstrip("/")
    cost = storage_cost_per_day if storage_cost_per_day is not None else DEFAULT_STORAGE_COST

    url = f"{base_url}/summary"
    params = {
        "commodity": commodity,
        "market": market,
        "days": forecast_days,
    }

    logger.info("Calling AI-ML API: %s  params=%s", url, params)

    response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    data = response.json()

    # ── Extract price_by_day from forecast ──────────────────────
    price_by_day: list[float] = []
    forecast_data = data.get("forecast", {})

    if forecast_data.get("status") == "success":
        forecast_rows = forecast_data.get("forecast", [])
        price_by_day = [
            float(row["predicted_price"])
            for row in forecast_rows
            if "predicted_price" in row
        ]

    # ── Extract volatility from risk score ──────────────────────
    risk_data = data.get("risk", {})
    volatility = float(risk_data.get("volatility_score", DEFAULT_VOLATILITY))

    # ── Build expected_future_price (fallback) ──────────────────
    expected_future_price = price_by_day[-1] if price_by_day else 0.0

    # ── Assemble MarketPrediction ───────────────────────────────
    prediction = MarketPrediction(
        volatility=volatility,
        storage_cost_per_day=cost,
        expected_future_price=expected_future_price,
        price_by_day=price_by_day,
    )

    # ── Assemble metadata for guardrails ────────────────────────
    anomaly_data = data.get("anomaly", {})

    metadata = {
        # Forecast signals
        "confidence": forecast_data.get("confidence", "Low"),
        "confidence_reason": forecast_data.get("confidence_reason", ""),
        "trend": forecast_data.get("trend", "Stable"),
        "volatility_cv": forecast_data.get("volatility_cv", None),
        "last_price": forecast_data.get("last_price", None),

        # Anomaly signals
        "anomaly_flag": bool(anomaly_data.get("anomaly_flag", False)),
        "anomaly_type": anomaly_data.get("anomaly_type", "none"),
        "anomaly_score": anomaly_data.get("anomaly_score", 0),

        # Risk signals
        "risk_level": risk_data.get("risk_level", "Medium"),
        "risk_score": risk_data.get("risk_score", None),
        "trend_score": risk_data.get("trend_score", None),

        # Combined explanation from AI-ML
        "overall_explanation": data.get("overall_explanation", ""),
    }

    logger.info(
        "AI-ML response: %d forecast days, volatility=%.1f, "
        "anomaly_flag=%s, confidence=%s",
        len(price_by_day),
        volatility,
        metadata["anomaly_flag"],
        metadata["confidence"],
    )

    return prediction, metadata


def fetch_market_prediction_safe(
    commodity: str,
    market: str,
    forecast_days: int = 5,
    storage_cost_per_day: float | None = None,
    aiml_url: str | None = None,
) -> tuple[MarketPrediction | None, dict]:
    """
    Like ``fetch_market_prediction`` but catches network / API errors
    and returns ``(None, error_metadata)`` instead of raising.

    Use this when the optimizer should fall back to no-prediction mode
    rather than crashing if AI-ML is unreachable.
    """
    try:
        return fetch_market_prediction(
            commodity=commodity,
            market=market,
            forecast_days=forecast_days,
            storage_cost_per_day=storage_cost_per_day,
            aiml_url=aiml_url,
        )
    except Exception as exc:
        logger.warning("AI-ML API call failed: %s", exc)
        return None, {
            "error": str(exc),
            "confidence": "Low",
            "trend": "Stable",
            "anomaly_flag": False,
            "anomaly_type": "none",
            "anomaly_score": 0,
            "risk_level": "Medium",
            "risk_score": None,
            "trend_score": None,
            "overall_explanation": "AI-ML service unavailable; using fallback.",
        }

