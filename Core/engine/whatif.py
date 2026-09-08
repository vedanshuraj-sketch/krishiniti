"""
What-If Simulator
=================

Allows farmers and the frontend to ask questions like:

- "What if I wait 10 days instead of 5?"
- "What if storage cost goes up 20%?"
- "What if I lower my floor price?"
- "What if I'm willing to split across buyers?"

The simulator takes a base scenario (lot + buyers + prediction),
applies one or more overrides, re-runs the optimizer, and returns
a side-by-side comparison of the original vs. modified results.

Usage::

    from engine.whatif import what_if, compare_scenarios

    result = what_if(
        lot=lot,
        buyers=buyers,
        prediction=prediction,
        overrides={"deadline_days": 10, "risk_tolerance": 0.8},
    )

    print(result["comparison"]["realization_change"])  # e.g. +₹12,000
"""

from __future__ import annotations

from dataclasses import fields
from typing import Optional

from .models import Lot, Buyer, MarketPrediction, Action
from .optimizer import optimize


# ── Fields that can be overridden on each dataclass ─────────────

_LOT_FIELDS = {f.name for f in fields(Lot)}
_PREDICTION_FIELDS = {f.name for f in fields(MarketPrediction)}


def _apply_lot_overrides(lot: Lot, overrides: dict) -> Lot:
    """Create a new Lot with selected fields overridden."""
    lot_kwargs = {}
    for f in fields(Lot):
        if f.name in overrides:
            lot_kwargs[f.name] = overrides[f.name]
        else:
            value = getattr(lot, f.name)
            # Deep-copy mutable defaults (lists)
            if isinstance(value, list):
                value = list(value)
            lot_kwargs[f.name] = value
    return Lot(**lot_kwargs)


def _apply_prediction_overrides(
    prediction: MarketPrediction,
    overrides: dict,
) -> MarketPrediction:
    """Create a new MarketPrediction with selected fields overridden."""
    pred_kwargs = {}
    for f in fields(MarketPrediction):
        if f.name in overrides:
            pred_kwargs[f.name] = overrides[f.name]
        else:
            value = getattr(prediction, f.name)
            if isinstance(value, list):
                value = list(value)
            pred_kwargs[f.name] = value
    return MarketPrediction(**pred_kwargs)


def _summarize_actions(actions: list[Action]) -> dict:
    """Summarize a list of actions into key metrics."""
    total_realization = sum(a.expected_realization for a in actions)
    total_amount = sum(a.amount for a in actions)
    sell_actions = [a for a in actions if a.action_type == "SELL"]
    store_actions = [a for a in actions if a.action_type == "STORE"]
    aggregate_actions = [a for a in actions if a.action_type == "AGGREGATE"]

    return {
        "total_realization": round(total_realization, 2),
        "total_amount": round(total_amount, 2),
        "action_count": len(actions),
        "sell_count": len(sell_actions),
        "store_count": len(store_actions),
        "aggregate_count": len(aggregate_actions),
        "sell_amount": round(sum(a.amount for a in sell_actions), 2),
        "store_amount": round(sum(a.amount for a in store_actions), 2),
        "store_days": store_actions[0].days if store_actions else 0,
        "best_buyer": sell_actions[0].buyer_name if sell_actions else None,
        "per_kg_realization": (
            round(total_realization / total_amount, 2)
            if total_amount > 0
            else 0.0
        ),
    }


def what_if(
    lot: Lot,
    buyers: list[Buyer],
    prediction: MarketPrediction,
    overrides: dict,
) -> dict:
    """
    Run a What-If simulation.

    Parameters
    ----------
    lot : Lot
        The farmer's original crop lot.
    buyers : list[Buyer]
        Available buyers.
    prediction : MarketPrediction
        Market intelligence (from AI-ML or manual).
    overrides : dict
        Fields to override. Supports all ``Lot`` fields
        (``deadline_days``, ``risk_tolerance``, ``cash_need``,
        ``storage_access``, ``floor_price``, ``single_buyer_only``, etc.)
        and all ``MarketPrediction`` fields (``volatility``,
        ``storage_cost_per_day``, ``expected_future_price``,
        ``price_by_day``).

    Returns
    -------
    dict with keys:
        ``baseline`` : dict
            Summary of original scenario.
        ``modified`` : dict
            Summary of modified scenario.
        ``comparison`` : dict
            Delta metrics (change in realization, per-kg, etc.).
        ``baseline_actions`` : list[Action]
            Full action list for original scenario.
        ``modified_actions`` : list[Action]
            Full action list for modified scenario.
        ``overrides_applied`` : dict
            The overrides that were applied.
        ``recommendation`` : str
            Human-readable verdict.
    """
    # ── Separate overrides into Lot vs Prediction fields ────────
    lot_overrides = {k: v for k, v in overrides.items() if k in _LOT_FIELDS}
    pred_overrides = {k: v for k, v in overrides.items() if k in _PREDICTION_FIELDS}

    # ── Run baseline ────────────────────────────────────────────
    baseline_actions = optimize(lot, buyers, prediction)
    baseline_summary = _summarize_actions(baseline_actions)

    # ── Apply overrides and run modified scenario ───────────────
    modified_lot = _apply_lot_overrides(lot, lot_overrides) if lot_overrides else lot
    modified_pred = (
        _apply_prediction_overrides(prediction, pred_overrides)
        if pred_overrides
        else prediction
    )

    modified_actions = optimize(modified_lot, buyers, modified_pred)
    modified_summary = _summarize_actions(modified_actions)

    # ── Compute comparison ──────────────────────────────────────
    realization_change = (
        modified_summary["total_realization"]
        - baseline_summary["total_realization"]
    )
    per_kg_change = (
        modified_summary["per_kg_realization"]
        - baseline_summary["per_kg_realization"]
    )

    comparison = {
        "realization_change": round(realization_change, 2),
        "realization_change_pct": (
            round(
                (realization_change / baseline_summary["total_realization"]) * 100,
                2,
            )
            if baseline_summary["total_realization"] > 0
            else 0.0
        ),
        "per_kg_change": round(per_kg_change, 2),
        "action_type_changed": (
            baseline_summary.get("store_count", 0) != modified_summary.get("store_count", 0)
            or baseline_summary.get("sell_count", 0) != modified_summary.get("sell_count", 0)
        ),
        "store_days_change": (
            modified_summary["store_days"] - baseline_summary["store_days"]
        ),
    }

    # ── Generate human-readable recommendation ──────────────────
    recommendation = _generate_recommendation(
        overrides, baseline_summary, modified_summary, comparison
    )

    return {
        "baseline": baseline_summary,
        "modified": modified_summary,
        "comparison": comparison,
        "baseline_actions": baseline_actions,
        "modified_actions": modified_actions,
        "overrides_applied": overrides,
        "recommendation": recommendation,
    }


def _generate_recommendation(
    overrides: dict,
    baseline: dict,
    modified: dict,
    comparison: dict,
) -> str:
    """Generate a farmer-friendly recommendation from comparison."""
    parts = []

    change = comparison["realization_change"]
    pct = comparison["realization_change_pct"]

    if abs(change) < 1:
        parts.append("This change has virtually no impact on your expected earnings.")
    elif change > 0:
        parts.append(
            f"This change could increase your earnings by "
            f"Rs {change:,.0f} ({pct:+.1f}%)."
        )
    else:
        parts.append(
            f"This change would decrease your earnings by "
            f"Rs {abs(change):,.0f} ({pct:.1f}%)."
        )

    if comparison["action_type_changed"]:
        if modified["store_count"] > baseline["store_count"]:
            parts.append(
                f"The recommendation shifts to storing for "
                f"{modified['store_days']} days instead of selling immediately."
            )
        elif modified["sell_count"] > baseline["sell_count"]:
            parts.append("The recommendation shifts to selling now instead of storing.")

    if "deadline_days" in overrides:
        new_days = overrides["deadline_days"]
        parts.append(f"With a {new_days}-day window, the engine found a better sale point.")

    if "risk_tolerance" in overrides:
        rt = overrides["risk_tolerance"]
        if rt > 1.0:
            parts.append("With higher risk aversion, the engine favors selling sooner.")
        elif rt < 0.3:
            parts.append("With lower risk aversion, the engine is willing to wait for better prices.")

    return " ".join(parts)


def compare_scenarios(
    lot: Lot,
    buyers: list[Buyer],
    prediction: MarketPrediction,
    scenarios: list[dict],
) -> list[dict]:
    """
    Compare multiple what-if scenarios against the baseline.

    Parameters
    ----------
    lot, buyers, prediction : same as ``what_if``.
    scenarios : list[dict]
        Each dict has ``name`` (str) and ``overrides`` (dict).
        Example::

            [
                {"name": "Wait 10 days", "overrides": {"deadline_days": 10}},
                {"name": "High risk aversion", "overrides": {"risk_tolerance": 5.0}},
                {"name": "No storage", "overrides": {"storage_access": False}},
            ]

    Returns
    -------
    list[dict]
        Each entry has ``name``, ``result`` (full what_if output), and
        ``realization`` for easy sorting.
    """
    results = []
    for scenario in scenarios:
        name = scenario.get("name", "Unnamed")
        overrides = scenario.get("overrides", {})
        result = what_if(lot, buyers, prediction, overrides)
        results.append({
            "name": name,
            "result": result,
            "realization": result["modified"]["total_realization"],
            "change": result["comparison"]["realization_change"],
            "change_pct": result["comparison"]["realization_change_pct"],
        })

    # Sort by highest realization
    results.sort(key=lambda r: r["realization"], reverse=True)
    return results

