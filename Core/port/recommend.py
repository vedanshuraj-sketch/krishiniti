"""
AI-Powered Recommendation Engine
=================================

High-level integration layer that combines AI-ML market intelligence
with the Core optimization engine.  This is the primary entry point
for any service (backend API, CLI, frontend) that wants a complete
"what should I do with this crop lot?" answer.

Usage::

    from port.recommend import recommend

    result = recommend(
        lot=Lot(crop="Groundnut", amount=500, deadline_days=5, is_certified=True),
        buyers=[...],
        market="Rajkot",
    )

    for action in result["actions"]:
        print(action.action_type, action.amount, action.expected_realization)

Guardrails
----------
- **Anomaly detected** → forces the lot to ``deadline_days=0`` and
  ``storage_access=False`` so the optimizer can only recommend
  selling today (conservative / protective mode).
- **Low forecast confidence** → doubles the ``volatility`` in
  ``MarketPrediction``, making the optimizer penalize STORE actions
  more heavily.
- **AI-ML unreachable** → falls back to no-prediction mode (the
  optimizer runs without market signals, meaning it can only rank
  SELL options and cannot evaluate STORE).
"""

from __future__ import annotations

import logging
import sys
import os
from dataclasses import replace
from typing import Optional

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from engine.models import Lot, Buyer, MarketPrediction, Action
from engine.optimizer import optimize
from port.aiml_client import fetch_market_prediction, fetch_market_prediction_safe

logger = logging.getLogger(__name__)


def recommend(
    lot: Lot,
    buyers: list[Buyer],
    market: str,
    forecast_days: int = 5,
    storage_cost_per_day: float = 1.5,
    aiml_url: str | None = None,
    fail_on_aiml_error: bool = False,
) -> dict:
    """
    Full AI-powered recommendation pipeline.

    Parameters
    ----------
    lot : Lot
        The farmer's crop lot with constraints (amount, deadline,
        certification, risk tolerance, etc.).
    buyers : list[Buyer]
        Available buyers / mandis to sell to.
    market : str
        APMC market name to query AI-ML for (e.g. ``"Rajkot"``).
    forecast_days : int
        How many days ahead to forecast (1–30).
    storage_cost_per_day : float
        ₹/kg/day for storage.  Domain constant.
    aiml_url : str or None
        Override AI-ML base URL.
    fail_on_aiml_error : bool
        If ``True``, raise on AI-ML failure.  If ``False`` (default),
        fall back to no-prediction mode.

    Returns
    -------
    dict with keys:
        ``actions`` : list[Action]
            Optimization output (SELL / STORE / AGGREGATE).
        ``ai_metadata`` : dict
            Anomaly flags, confidence, risk level, explanations.
        ``prediction_used`` : MarketPrediction or None
            The prediction fed into the optimizer (for debugging).
        ``guardrails_applied`` : list[str]
            Human-readable list of guardrails that triggered.
    """
    guardrails_applied: list[str] = []

    # ── Step 1: Fetch AI-ML predictions ─────────────────────────
    if fail_on_aiml_error:
        prediction, metadata = fetch_market_prediction(
            commodity=lot.crop,
            market=market,
            forecast_days=forecast_days,
            storage_cost_per_day=storage_cost_per_day,
            aiml_url=aiml_url,
        )
    else:
        prediction, metadata = fetch_market_prediction_safe(
            commodity=lot.crop,
            market=market,
            forecast_days=forecast_days,
            storage_cost_per_day=storage_cost_per_day,
            aiml_url=aiml_url,
        )

    if prediction is None:
        guardrails_applied.append(
            "AI-ML service unavailable — running optimizer without "
            "market predictions (STORE evaluation disabled)."
        )
        logger.warning("Running optimizer without AI-ML predictions.")

    # ── Step 2: Apply guardrails ────────────────────────────────
    adjusted_lot = lot

    # Guardrail A: Anomaly detected → force conservative sell-today
    if metadata.get("anomaly_flag"):
        anomaly_type = metadata.get("anomaly_type", "unknown")
        guardrails_applied.append(
            f"Anomaly detected ({anomaly_type}) — forcing conservative "
            f"sell-today mode. Storage recommendation suppressed."
        )
        logger.info("Guardrail: anomaly detected (%s), forcing sell-today.", anomaly_type)

        # Use dataclass-style reconstruction to avoid mutating the
        # caller's Lot object.
        adjusted_lot = Lot(
            crop=lot.crop,
            amount=lot.amount,
            is_certified=lot.is_certified,
            cash_need=lot.cash_need,
            deadline_days=0,            # force sell today
            storage_access=False,       # disable STORE evaluation
            risk_tolerance=lot.risk_tolerance,
            blacklist=list(lot.blacklist),
            floor_price=lot.floor_price,
            single_buyer_only=lot.single_buyer_only,
        )

    # Guardrail B: Low confidence → amplify volatility penalty
    if prediction is not None and metadata.get("confidence") == "Low":
        guardrails_applied.append(
            "Low forecast confidence — doubling volatility penalty "
            "to discourage speculative storage."
        )
        logger.info("Guardrail: low confidence, doubling volatility.")
        prediction = MarketPrediction(
            volatility=prediction.volatility * 2.0,
            storage_cost_per_day=prediction.storage_cost_per_day,
            expected_future_price=prediction.expected_future_price,
            price_by_day=list(prediction.price_by_day),
        )

    # ── Step 3: Run optimizer ───────────────────────────────────
    actions = optimize(adjusted_lot, buyers, prediction)

    logger.info(
        "Optimizer returned %d action(s): %s",
        len(actions),
        [a.action_type for a in actions],
    )

    return {
        "actions": actions,
        "ai_metadata": metadata,
        "prediction_used": prediction,
        "guardrails_applied": guardrails_applied,
    }

