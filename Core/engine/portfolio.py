"""
Multi-Lot Portfolio Optimizer
=============================

Optimizes across **multiple crop lots** simultaneously for a single
farmer, balancing aggregate risk and maximizing total portfolio
realization.

A farmer may have:
- 500 kg of Groundnut (perishable, should sell sooner)
- 1000 kg of Wheat (stores well, can wait)
- 200 kg of Cotton (needs cash urgently)

Rather than optimizing each independently, the portfolio optimizer
considers cross-lot interactions:
- If one lot already meets the farmer's total cash need, the others
  can afford to wait.
- High-risk lots are sold first to reduce overall portfolio risk.
- Storage capacity is shared and tracked across lots.

Usage::

    from engine.portfolio import optimize_portfolio

    result = optimize_portfolio(
        lots=[lot1, lot2, lot3],
        buyers_by_crop={"Groundnut": buyers_gn, "Wheat": buyers_wh},
        predictions_by_crop={"Groundnut": pred_gn, "Wheat": pred_wh},
        total_cash_need=200_000,
    )
"""

from __future__ import annotations

from .models import Lot, Buyer, MarketPrediction, Action
from .optimizer import optimize


def _lot_urgency_score(lot: Lot, prediction: MarketPrediction | None) -> float:
    """
    Score a lot's urgency for processing order.
    Higher score = should be processed first.

    Urgency factors:
    - deadline_days == 0 (distress) → highest urgency
    - Higher cash_need → more urgent
    - Higher volatility → more urgent (risky to wait)
    - No storage access → must sell now
    - Lower deadline_days → more urgent
    """
    score = 0.0

    # Distress sale
    if lot.deadline_days == 0:
        score += 1000.0

    # No storage
    if not lot.storage_access:
        score += 500.0

    # Cash urgency (normalize to 0-100 range)
    if lot.cash_need > 0:
        score += min(lot.cash_need / 1000.0, 200.0)

    # Deadline urgency (shorter deadline = more urgent)
    if lot.deadline_days > 0:
        score += 100.0 / lot.deadline_days

    # Volatility risk (higher risk = sell sooner)
    if prediction and prediction.volatility > 0:
        score += prediction.volatility * 0.5

    return score


def optimize_portfolio(
    lots: list[Lot],
    buyers_by_crop: dict[str, list[Buyer]],
    predictions_by_crop: dict[str, MarketPrediction | None] | None = None,
    total_cash_need: float = 0.0,
    max_total_storage_kg: float = float("inf"),
) -> dict:
    """
    Optimize across multiple lots for a single farmer.

    Parameters
    ----------
    lots : list[Lot]
        All crop lots the farmer wants to optimize.
    buyers_by_crop : dict[str, list[Buyer]]
        Mapping from crop name (lowercase) to available buyers.
        Example: ``{"groundnut": [...], "wheat": [...]}``
    predictions_by_crop : dict or None
        Mapping from crop name (lowercase) to MarketPrediction.
        If None, all lots run without predictions.
    total_cash_need : float
        Total ₹ the farmer needs across all lots combined.
        Overrides individual lot ``cash_need`` for portfolio-level
        liquidity matching.
    max_total_storage_kg : float
        Maximum total kg that can be stored across all lots
        (shared cold storage capacity).

    Returns
    -------
    dict with keys:
        ``status`` : str
            ``"success"`` or ``"partial"`` (some lots had no buyers).
        ``per_lot_results`` : list[dict]
            Each entry has ``crop``, ``amount``, ``actions``,
            ``realization``, ``urgency_rank``.
        ``portfolio_summary`` : dict
            Aggregate metrics: total realization, total stored,
            total sold, cash raised, storage used.
        ``processing_order`` : list[str]
            Order in which lots were processed (by urgency).
        ``recommendation`` : str
            Portfolio-level recommendation.
    """
    predictions = predictions_by_crop or {}

    # ── Step 1: Score and sort lots by urgency ──────────────────
    lot_entries = []
    for lot in lots:
        crop_key = lot.crop.strip().lower()
        prediction = predictions.get(crop_key)
        urgency = _lot_urgency_score(lot, prediction)
        lot_entries.append({
            "lot": lot,
            "crop_key": crop_key,
            "prediction": prediction,
            "urgency": urgency,
        })

    lot_entries.sort(key=lambda x: x["urgency"], reverse=True)

    # ── Step 2: Process each lot, tracking shared constraints ───
    per_lot_results = []
    total_cash_raised = 0.0
    total_storage_used = 0.0
    processing_order = []

    for entry in lot_entries:
        lot = entry["lot"]
        crop_key = entry["crop_key"]
        prediction = entry["prediction"]
        buyers = buyers_by_crop.get(crop_key, [])
        processing_order.append(f"{lot.crop} ({lot.amount}kg)")

        # ── Adjust lot for portfolio-level constraints ──────────
        adjusted_lot = lot

        # Portfolio-level cash need: if we've raised enough, remove
        # cash pressure from remaining lots
        if total_cash_need > 0:
            remaining_cash_need = max(0, total_cash_need - total_cash_raised)
            adjusted_lot = Lot(
                crop=lot.crop,
                amount=lot.amount,
                is_certified=lot.is_certified,
                cash_need=remaining_cash_need,
                deadline_days=lot.deadline_days,
                storage_access=lot.storage_access,
                risk_tolerance=lot.risk_tolerance,
                blacklist=list(lot.blacklist),
                floor_price=lot.floor_price,
                single_buyer_only=lot.single_buyer_only,
            )

        # Storage capacity constraint: disable storage if remaining
        # capacity is exhausted or insufficient for this lot
        remaining_storage = max_total_storage_kg - total_storage_used
        if remaining_storage < adjusted_lot.amount and adjusted_lot.storage_access:
            if remaining_storage <= 0:
                # No capacity left at all — disable storage
                adjusted_lot = Lot(
                    crop=adjusted_lot.crop,
                    amount=adjusted_lot.amount,
                    is_certified=adjusted_lot.is_certified,
                    cash_need=adjusted_lot.cash_need,
                    deadline_days=adjusted_lot.deadline_days,
                    storage_access=False,  # no more storage capacity
                    risk_tolerance=adjusted_lot.risk_tolerance,
                    blacklist=list(adjusted_lot.blacklist),
                    floor_price=adjusted_lot.floor_price,
                    single_buyer_only=adjusted_lot.single_buyer_only,
                )
            else:
                # Partial capacity — disable storage to avoid exceeding
                # the shared limit (the optimizer can't split STORE amounts
                # to fit a capacity ceiling, so we conservatively disable)
                adjusted_lot = Lot(
                    crop=adjusted_lot.crop,
                    amount=adjusted_lot.amount,
                    is_certified=adjusted_lot.is_certified,
                    cash_need=adjusted_lot.cash_need,
                    deadline_days=adjusted_lot.deadline_days,
                    storage_access=False,
                    risk_tolerance=adjusted_lot.risk_tolerance,
                    blacklist=list(adjusted_lot.blacklist),
                    floor_price=adjusted_lot.floor_price,
                    single_buyer_only=adjusted_lot.single_buyer_only,
                )

        # ── Run optimizer ───────────────────────────────────────
        actions = optimize(adjusted_lot, buyers, prediction)

        # ── Track portfolio-level metrics ───────────────────────
        lot_realization = sum(a.expected_realization for a in actions)
        lot_sell_amount = sum(a.amount for a in actions if a.action_type == "SELL")
        lot_store_amount = sum(a.amount for a in actions if a.action_type == "STORE")

        total_cash_raised += sum(
            a.expected_realization for a in actions if a.action_type == "SELL"
        )
        total_storage_used += lot_store_amount

        per_lot_results.append({
            "crop": lot.crop,
            "amount": lot.amount,
            "urgency_rank": len(per_lot_results) + 1,
            "actions": actions,
            "action_types": [a.action_type for a in actions],
            "realization": round(lot_realization, 2),
            "sell_amount": round(lot_sell_amount, 2),
            "store_amount": round(lot_store_amount, 2),
            "store_days": (
                actions[0].days
                if actions and actions[0].action_type == "STORE"
                else 0
            ),
        })

    # ── Step 3: Portfolio summary ───────────────────────────────
    total_realization = sum(r["realization"] for r in per_lot_results)
    total_sold = sum(r["sell_amount"] for r in per_lot_results)
    total_stored = sum(r["store_amount"] for r in per_lot_results)
    total_amount = sum(r["amount"] for r in per_lot_results)

    has_failed_lots = any(len(r["actions"]) == 0 for r in per_lot_results)

    portfolio_summary = {
        "total_realization": round(total_realization, 2),
        "total_amount": round(total_amount, 2),
        "total_sold_kg": round(total_sold, 2),
        "total_stored_kg": round(total_stored, 2),
        "total_cash_raised": round(total_cash_raised, 2),
        "storage_capacity_used": round(total_storage_used, 2),
        "storage_capacity_remaining": round(
            max_total_storage_kg - total_storage_used, 2
        ) if max_total_storage_kg < float("inf") else "unlimited",
        "lots_count": len(lots),
        "lots_with_actions": sum(1 for r in per_lot_results if r["actions"]),
        "cash_need_met": (
            total_cash_raised >= total_cash_need
            if total_cash_need > 0
            else True
        ),
    }

    # ── Step 4: Portfolio recommendation ────────────────────────
    recommendation = _generate_portfolio_recommendation(
        per_lot_results, portfolio_summary, total_cash_need
    )

    return {
        "status": "partial" if has_failed_lots else "success",
        "per_lot_results": per_lot_results,
        "portfolio_summary": portfolio_summary,
        "processing_order": processing_order,
        "recommendation": recommendation,
    }


def _generate_portfolio_recommendation(
    results: list[dict],
    summary: dict,
    cash_need: float,
) -> str:
    """Generate a portfolio-level recommendation."""
    parts = []

    parts.append(
        f"Across {summary['lots_count']} crop lots "
        f"({summary['total_amount']:,.0f} kg total), "
        f"the expected total realization is Rs {summary['total_realization']:,.0f}."
    )

    if summary["total_sold_kg"] > 0 and summary["total_stored_kg"] > 0:
        parts.append(
            f"Recommendation: Sell {summary['total_sold_kg']:,.0f} kg now "
            f"and store {summary['total_stored_kg']:,.0f} kg for better prices."
        )
    elif summary["total_stored_kg"] > 0:
        parts.append("All lots are recommended for storage.")
    else:
        parts.append("All lots are recommended for immediate sale.")

    if cash_need > 0:
        if summary["cash_need_met"]:
            parts.append(
                f"Your cash requirement of Rs {cash_need:,.0f} is fully met."
            )
        else:
            shortfall = cash_need - summary["total_cash_raised"]
            parts.append(
                f"Warning: Cash shortfall of Rs {shortfall:,.0f} — "
                f"consider selling stored lots sooner."
            )

    return " ".join(parts)
