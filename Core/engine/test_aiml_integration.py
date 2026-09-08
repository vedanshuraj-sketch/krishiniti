"""
Integration tests for AI-ML ↔ Core pipeline.

These tests mock the AI-ML HTTP API responses so they can run
without a live AI-ML server.  They verify:

  1. ``fetch_market_prediction`` correctly transforms JSON → MarketPrediction
  2. ``recommend()`` applies guardrails (anomaly, low confidence)
  3. The full pipeline produces valid Action objects
  4. Graceful degradation when AI-ML is unreachable

Run with:
    cd Core
    python -m engine.test_aiml_integration
"""

import sys
import os
from unittest.mock import patch, MagicMock

# ── Ensure project root is on path ─────────────────────────────
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from engine.models import Lot, Buyer, MarketPrediction, Action
from engine.optimizer import optimize
from port.aiml_client import fetch_market_prediction, fetch_market_prediction_safe
from port.recommend import recommend

PASS = 0
FAIL = 0


def check(name, condition):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  ✅ {name}")
    else:
        FAIL += 1
        print(f"  ❌ FAIL: {name}")


# ── Mock API response fixtures ─────────────────────────────────

MOCK_SUMMARY_RESPONSE = {
    "commodity": "Groundnut",
    "market": "Rajkot",
    "forecast": {
        "status": "success",
        "commodity": "Groundnut",
        "market": "Rajkot",
        "history_observations": 45,
        "last_date": "2025-08-15",
        "last_price": 5800.0,
        "trend": "Upward",
        "confidence": "Medium",
        "confidence_reason": "Moderate price variation in recent history.",
        "volatility_cv": 0.1123,
        "explanation": "Groundnut prices at Rajkot are expected to rise.",
        "forecast": [
            {"date": "2025-08-16", "predicted_price": 5850.0, "lower_bound": 5700.0, "upper_bound": 6000.0},
            {"date": "2025-08-17", "predicted_price": 5900.0, "lower_bound": 5750.0, "upper_bound": 6050.0},
            {"date": "2025-08-18", "predicted_price": 5950.0, "lower_bound": 5800.0, "upper_bound": 6100.0},
            {"date": "2025-08-19", "predicted_price": 6000.0, "lower_bound": 5850.0, "upper_bound": 6150.0},
            {"date": "2025-08-20", "predicted_price": 6050.0, "lower_bound": 5900.0, "upper_bound": 6200.0},
        ],
    },
    "risk": {
        "status": "success",
        "risk_score": 42.5,
        "risk_level": "Medium",
        "volatility_score": 35.0,
        "trend_score": 30.0,
        "risk_status": "ok",
        "explanation": "Moderate risk. Prices have been somewhat volatile.",
    },
    "anomaly": {
        "status": "success",
        "anomaly_flag": False,
        "anomaly_type": "none",
        "anomaly_score": 0,
        "anomaly_status": "ok",
        "explanation": "No unusual price activity detected.",
    },
    "overall_explanation": "Groundnut prices at Rajkot are expected to rise. Moderate risk.",
}

MOCK_ANOMALY_RESPONSE = {
    **MOCK_SUMMARY_RESPONSE,
    "anomaly": {
        "status": "success",
        "anomaly_flag": True,
        "anomaly_type": "price_spike",
        "anomaly_score": 72,
        "anomaly_status": "ok",
        "explanation": "Price jumped 55% in a single day.",
    },
    "overall_explanation": "Anomaly detected. Treat forecast with caution.",
}

MOCK_LOW_CONFIDENCE_RESPONSE = {
    **MOCK_SUMMARY_RESPONSE,
    "forecast": {
        **MOCK_SUMMARY_RESPONSE["forecast"],
        "confidence": "Low",
        "confidence_reason": "High recent price volatility.",
    },
}


def _make_mock_response(json_data, status_code=200):
    """Create a mock requests.Response object."""
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.json.return_value = json_data
    mock_resp.raise_for_status.return_value = None
    return mock_resp


# ── Standard test buyers ───────────────────────────────────────

TEST_BUYERS = [
    Buyer(name="Rajkot Mandi", price=5800, transport_rate=50, distance=2, capacity=500),
    Buyer(name="Junagadh Mandi", price=5900, transport_rate=80, distance=10, capacity=300),
    Buyer(name="Amreli Trader", price=5700, transport_rate=30, distance=5, capacity=1000),
]


def run_tests():
    global PASS, FAIL

    # ── Test 1: fetch_market_prediction transforms JSON correctly ──
    print("\n--- Test 1: fetch_market_prediction — JSON → MarketPrediction ---")
    with patch("port.aiml_client.requests.get") as mock_get:
        mock_get.return_value = _make_mock_response(MOCK_SUMMARY_RESPONSE)

        prediction, metadata = fetch_market_prediction(
            commodity="Groundnut",
            market="Rajkot",
            forecast_days=5,
        )

        check("Returns MarketPrediction", isinstance(prediction, MarketPrediction))
        check("price_by_day has 5 entries", len(prediction.price_by_day) == 5)
        check(
            "price_by_day[0] == 5850.0",
            prediction.price_by_day[0] == 5850.0,
        )
        check(
            "price_by_day[-1] == 6050.0",
            prediction.price_by_day[-1] == 6050.0,
        )
        check(
            "expected_future_price == last forecast price",
            prediction.expected_future_price == 6050.0,
        )
        check(
            "volatility == risk.volatility_score (35.0)",
            prediction.volatility == 35.0,
        )
        check(
            "storage_cost_per_day defaults to 1.5",
            prediction.storage_cost_per_day == 1.5,
        )
        check("metadata has confidence", metadata["confidence"] == "Medium")
        check("metadata has trend", metadata["trend"] == "Upward")
        check("metadata anomaly_flag is False", metadata["anomaly_flag"] is False)
        check("metadata risk_level is Medium", metadata["risk_level"] == "Medium")

    # ── Test 2: fetch_market_prediction with custom storage cost ──
    print("\n--- Test 2: Custom storage cost ---")
    with patch("port.aiml_client.requests.get") as mock_get:
        mock_get.return_value = _make_mock_response(MOCK_SUMMARY_RESPONSE)

        prediction, _ = fetch_market_prediction(
            commodity="Groundnut",
            market="Rajkot",
            storage_cost_per_day=3.0,
        )
        check("storage_cost_per_day == 3.0", prediction.storage_cost_per_day == 3.0)

    # ── Test 3: fetch_market_prediction_safe handles errors ──
    print("\n--- Test 3: fetch_market_prediction_safe — graceful error handling ---")
    with patch("port.aiml_client.requests.get") as mock_get:
        mock_get.side_effect = ConnectionError("AI-ML server unreachable")

        prediction, metadata = fetch_market_prediction_safe(
            commodity="Groundnut",
            market="Rajkot",
        )
        check("Returns None prediction", prediction is None)
        check("metadata has error key", "error" in metadata)
        check("metadata has fallback confidence", metadata["confidence"] == "Low")

    # ── Test 4: recommend() — normal flow ──
    print("\n--- Test 4: recommend() — normal flow (no guardrails) ---")
    with patch("port.aiml_client.requests.get") as mock_get:
        mock_get.return_value = _make_mock_response(MOCK_SUMMARY_RESPONSE)

        lot = Lot(
            crop="Groundnut",
            amount=500,
            deadline_days=5,
            is_certified=True,
            storage_access=True,
        )

        result = recommend(lot, TEST_BUYERS, market="Rajkot", forecast_days=5)

        check("Has actions", len(result["actions"]) > 0)
        check("Has ai_metadata", "ai_metadata" in result)
        check("Has prediction_used", result["prediction_used"] is not None)
        check("No guardrails triggered", len(result["guardrails_applied"]) == 0)

        # The optimizer should consider STORE since prices are rising
        action_types = [a.action_type for a in result["actions"]]
        print(f"  Actions returned: {action_types}")

    # ── Test 5: recommend() — anomaly guardrail ──
    print("\n--- Test 5: recommend() — anomaly guardrail forces sell-today ---")
    with patch("port.aiml_client.requests.get") as mock_get:
        mock_get.return_value = _make_mock_response(MOCK_ANOMALY_RESPONSE)

        lot = Lot(
            crop="Groundnut",
            amount=500,
            deadline_days=10,
            is_certified=True,
            storage_access=True,
        )

        result = recommend(lot, TEST_BUYERS, market="Rajkot")

        check("Guardrails applied", len(result["guardrails_applied"]) > 0)
        check(
            "Anomaly guardrail mentioned",
            any("Anomaly" in g for g in result["guardrails_applied"]),
        )
        check(
            "All actions are SELL (no STORE)",
            all(a.action_type == "SELL" for a in result["actions"]),
        )
        print(f"  Guardrails: {result['guardrails_applied']}")

    # ── Test 6: recommend() — low confidence guardrail ──
    print("\n--- Test 6: recommend() — low confidence doubles volatility ---")
    with patch("port.aiml_client.requests.get") as mock_get:
        mock_get.return_value = _make_mock_response(MOCK_LOW_CONFIDENCE_RESPONSE)

        lot = Lot(
            crop="Groundnut",
            amount=500,
            deadline_days=5,
            is_certified=True,
            storage_access=True,
            risk_tolerance=0.5,
        )

        result = recommend(lot, TEST_BUYERS, market="Rajkot")

        check("Low-confidence guardrail applied", len(result["guardrails_applied"]) > 0)
        check(
            "Volatility was doubled",
            result["prediction_used"].volatility == 35.0 * 2.0,
        )
        print(f"  Guardrails: {result['guardrails_applied']}")

    # ── Test 7: recommend() — AI-ML unreachable fallback ──
    print("\n--- Test 7: recommend() — AI-ML unreachable, graceful fallback ---")
    with patch("port.aiml_client.requests.get") as mock_get:
        mock_get.side_effect = ConnectionError("unreachable")

        lot = Lot(
            crop="Groundnut",
            amount=500,
            deadline_days=0,
            is_certified=True,
        )

        result = recommend(lot, TEST_BUYERS, market="Rajkot")

        check("Has actions (optimizer still runs)", len(result["actions"]) > 0)
        check("prediction_used is None", result["prediction_used"] is None)
        check(
            "Fallback guardrail applied",
            any("unavailable" in g for g in result["guardrails_applied"]),
        )
        check(
            "All actions are SELL (no STORE without prediction)",
            all(a.action_type == "SELL" for a in result["actions"]),
        )

    # ── Test 8: Full pipeline end-to-end with optimizer ──
    print("\n--- Test 8: Full pipeline — prediction flows into optimizer correctly ---")
    with patch("port.aiml_client.requests.get") as mock_get:
        mock_get.return_value = _make_mock_response(MOCK_SUMMARY_RESPONSE)

        # Risk-tolerant farmer with storage — should consider STORE
        lot = Lot(
            crop="Groundnut",
            amount=500,
            deadline_days=5,
            is_certified=True,
            storage_access=True,
            risk_tolerance=0.0,  # very risk-tolerant
        )

        result = recommend(lot, TEST_BUYERS, market="Rajkot", forecast_days=5)
        prediction = result["prediction_used"]

        check("Prediction price_by_day populated", len(prediction.price_by_day) == 5)
        check(
            "Prices are rising in prediction",
            prediction.price_by_day[-1] > prediction.price_by_day[0],
        )

        total_amount = sum(a.amount for a in result["actions"])
        check(
            f"Total actioned amount == 500 (got {total_amount:.1f})",
            abs(total_amount - 500) < 0.01,
        )

    # ── Summary ──
    print(f"\n{'=' * 55}")
    print(f"AI-ML INTEGRATION TESTS: {PASS} passed, {FAIL} failed out of {PASS + FAIL} checks")
    if FAIL > 0:
        sys.exit(1)
    print("All integration checks passed! ✅")


if __name__ == "__main__":
    run_tests()

