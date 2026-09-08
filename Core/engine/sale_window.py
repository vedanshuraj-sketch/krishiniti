"""
Sale Window Recommender
=======================

Given a commodity and market, determines the **optimal day to sell**
within a time horizon by analyzing the AI-ML price forecast trajectory
and deducting cumulative storage costs.

This is a standalone function that answers:
    "When is the best time to sell my crop in the next N days?"

It works both with live AI-ML data (via ``port.aiml_client``) and
with a pre-supplied ``MarketPrediction`` for offline / test usage.

Usage::

    from engine.sale_window import find_best_sale_window

    window = find_best_sale_window(
        commodity="Groundnut",
        market="Rajkot",
        amount=500,
        max_days=30,
        is_certified=True,
    )

    print(window["best_day"])        # e.g. 12
    print(window["best_price"])      # e.g. 6200.0
    print(window["net_realization"]) # e.g. ₹3,095,000
"""

from __future__ import annotations

from .models import Lot, MarketPrediction
from .constants import UNCERTIFIED_PENALTY, PERISHABILITY_BASE


def find_best_sale_window(
    commodity: str | None = None,
    market: str | None = None,
    amount: float = 1000.0,
    max_days: int = 30,
    is_certified: bool = True,
    storage_cost_per_day: float = 1.5,
    risk_tolerance: float = 0.5,
    prediction: MarketPrediction | None = None,
    aiml_url: str | None = None,
) -> dict:
    """
    Find the optimal sale day within a time window.

    Parameters
    ----------
    commodity : str
        Crop name. Required if ``prediction`` is not supplied.
    market : str
        APMC market name. Required if ``prediction`` is not supplied.
    amount : float
        Quantity in kg.
    max_days : int
        Maximum horizon to search (1–30).
    is_certified : bool
        Whether the crop is quality-certified.
    storage_cost_per_day : float
        ₹/kg/day storage cost.
    risk_tolerance : float
        Lambda for risk penalty (0 = risk-loving, 10 = very averse).
    prediction : MarketPrediction or None
        Pre-supplied prediction. If None, fetches from AI-ML API.
    aiml_url : str or None
        Override AI-ML base URL.

    Returns
    -------
    dict with keys:
        ``status`` : str
            ``"success"`` or ``"no_data"`` / ``"insufficient_data"``.
        ``best_day`` : int
            Optimal day number (1-indexed). 0 = sell today.
        ``best_price`` : float
            Expected price on the best day.
        ``net_realization`` : float
            Expected ₹ after storage costs on the best day.
        ``risk_adjusted_realization`` : float
            Net realization minus volatility risk penalty.
        ``sell_today_realization`` : float
            What you'd get selling today (for comparison).
        ``advantage_over_today`` : float
            How much more (or less) you'd earn by waiting.
        ``advantage_pct`` : float
            Percentage improvement over selling today.
        ``daily_breakdown`` : list[dict]
            Per-day analysis with price, storage cost, net.
        ``recommendation`` : str
            Human-readable recommendation.
        ``confidence`` : str
            Forecast confidence level (if from AI-ML).
        ``trend`` : str
            Price trend direction (if from AI-ML).
    """
    metadata = {}

    # ── Fetch prediction from AI-ML if not supplied ─────────────
    if prediction is None:
        if not commodity or not market:
            return {
                "status": "error",
                "message": "commodity and market are required when prediction is not supplied.",
            }
        try:
            from port.aiml_client import fetch_market_prediction
            prediction, metadata = fetch_market_prediction(
                commodity=commodity,
                market=market,
                forecast_days=max_days,
                storage_cost_per_day=storage_cost_per_day,
                aiml_url=aiml_url,
            )
        except Exception as exc:
            return {
                "status": "error",
                "message": f"Failed to fetch AI-ML data: {exc}",
            }

    # ── Validate we have price data ─────────────────────────────
    if not prediction.price_by_day and prediction.expected_future_price <= 0:
        return {
            "status": "no_data",
            "message": "No price forecast available for this commodity-market pair.",
        }

    cert_mult = 1.0 if is_certified else UNCERTIFIED_PENALTY

    # Use prediction's storage cost when prediction was supplied directly,
    # otherwise use the function parameter.
    effective_storage_cost = prediction.storage_cost_per_day if prediction.storage_cost_per_day > 0 else storage_cost_per_day

    # ── Compute sell-today baseline ─────────────────────────────
    # Use the current/last known price (first in price_by_day or
    # expected_future_price as approximation)
    today_price = (
        prediction.price_by_day[0]
        if prediction.price_by_day
        else prediction.expected_future_price
    )
    sell_today_realization = today_price * amount * cert_mult

    # ── Search each day for the best net realization ─────────────
    daily_breakdown = []
    best_day = 0
    best_net = sell_today_realization
    best_risk_adjusted = sell_today_realization - (risk_tolerance * prediction.volatility * amount)
    best_price = today_price

    prices = prediction.price_by_day if prediction.price_by_day else []
    search_limit = min(max_days, len(prices))

    for i in range(search_limit):
        day = i + 1
        price = prices[i]
        storage_cost = effective_storage_cost * amount * (PERISHABILITY_BASE ** day)
        gross = price * amount * cert_mult
        net = gross - storage_cost
        risk_penalty = risk_tolerance * prediction.volatility * amount
        risk_adjusted = net - risk_penalty

        daily_breakdown.append({
            "day": day,
            "predicted_price": round(price, 2),
            "gross_realization": round(gross, 2),
            "cumulative_storage_cost": round(storage_cost, 2),
            "net_realization": round(net, 2),
            "risk_adjusted": round(risk_adjusted, 2),
            "advantage_over_today": round(net - sell_today_realization, 2),
        })

        if risk_adjusted > best_risk_adjusted:
            best_risk_adjusted = risk_adjusted
            best_net = net
            best_day = day
            best_price = price

    # ── Fallback: if no price_by_day, use expected_future_price ──
    if not prices and prediction.expected_future_price > 0:
        day = min(max_days, 10)  # default horizon
        price = prediction.expected_future_price
        storage_cost = effective_storage_cost * amount * (PERISHABILITY_BASE ** day)
        gross = price * amount * cert_mult
        net = gross - storage_cost
        risk_penalty = risk_tolerance * prediction.volatility * amount
        risk_adjusted = net - risk_penalty

        if risk_adjusted > best_risk_adjusted:
            best_risk_adjusted = risk_adjusted
            best_net = net
            best_day = day
            best_price = price

        daily_breakdown.append({
            "day": day,
            "predicted_price": round(price, 2),
            "gross_realization": round(gross, 2),
            "cumulative_storage_cost": round(storage_cost, 2),
            "net_realization": round(net, 2),
            "risk_adjusted": round(risk_adjusted, 2),
            "advantage_over_today": round(net - sell_today_realization, 2),
        })

    # ── Compute advantage metrics ───────────────────────────────
    advantage = best_net - sell_today_realization
    advantage_pct = (
        round((advantage / sell_today_realization) * 100, 2)
        if sell_today_realization > 0
        else 0.0
    )

    # ── Generate recommendation ─────────────────────────────────
    recommendation = _generate_window_recommendation(
        best_day, best_price, advantage, advantage_pct, today_price,
        metadata.get("confidence", "Medium"),
    )

    return {
        "status": "success",
        "commodity": commodity or "unknown",
        "market": market or "unknown",
        "amount": amount,
        "best_day": best_day,
        "best_price": round(best_price, 2),
        "net_realization": round(best_net, 2),
        "risk_adjusted_realization": round(best_risk_adjusted, 2),
        "sell_today_realization": round(sell_today_realization, 2),
        "advantage_over_today": round(advantage, 2),
        "advantage_pct": advantage_pct,
        "daily_breakdown": daily_breakdown,
        "recommendation": recommendation,
        "confidence": metadata.get("confidence", "Medium"),
        "trend": metadata.get("trend", "Stable"),
        "days_analyzed": len(daily_breakdown),
    }


def _generate_window_recommendation(
    best_day: int,
    best_price: float,
    advantage: float,
    advantage_pct: float,
    today_price: float,
    confidence: str,
) -> str:
    """Generate a farmer-friendly sale window recommendation."""
    if best_day == 0:
        return (
            f"Selling today at Rs {today_price:,.0f}/kg appears to be "
            f"the best option. Waiting does not improve your earnings "
            f"after accounting for storage costs and risk."
        )

    text = (
        f"The best time to sell is Day {best_day} at an expected price of "
        f"Rs {best_price:,.0f}/kg. "
    )

    if advantage > 0:
        text += (
            f"This could earn you Rs {advantage:,.0f} more than selling today "
            f"({advantage_pct:+.1f}% improvement)."
        )
    else:
        text += (
            f"However, after storage costs and risk, this is Rs {abs(advantage):,.0f} "
            f"less than selling today."
        )

    if confidence == "Low":
        text += " Note: forecast confidence is low — consider selling sooner."
    elif confidence == "High":
        text += " This forecast is backed by solid historical data."

    return text
