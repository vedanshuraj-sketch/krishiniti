"""
Net Realisation Calculator
==========================

Standalone module that computes a detailed financial breakdown for
any sell or store action. This is what the frontend displays when
a farmer taps on a recommendation to see "how was this number
calculated?"

Provides line-by-line breakdown:
    Gross Revenue      = Price × Amount
    - Transport Cost   = Rate × Distance
    - Cert Penalty     = 5% if uncertified
    - Storage Cost     = BaseRate × Amount × 1.05^days
    - Risk Penalty     = λ × Volatility × Amount
    ───────────────────────────────────────
    = Net Realisation

Usage::

    from engine.net_realisation import calculate_net_realisation

    breakdown = calculate_net_realisation(
        price=5800, amount=500, transport_rate=50, distance=2,
        is_certified=True, storage_days=3, storage_cost_per_day=1.5,
        risk_tolerance=0.5, volatility=35.0,
    )

    for line in breakdown["line_items"]:
        print(f"{line['label']:30s}  Rs {line['amount']:>12,.2f}")
"""

from __future__ import annotations

from .constants import UNCERTIFIED_PENALTY, PERISHABILITY_BASE


def calculate_net_realisation(
    price: float,
    amount: float,
    transport_rate: float = 0.0,
    distance: float = 0.0,
    is_certified: bool = True,
    storage_days: int = 0,
    storage_cost_per_day: float = 0.0,
    risk_tolerance: float = 0.0,
    volatility: float = 0.0,
) -> dict:
    """
    Calculate a detailed net realisation breakdown.

    Parameters
    ----------
    price : float
        Expected selling price (₹/kg).
    amount : float
        Quantity in kg.
    transport_rate : float
        Transport cost rate (₹/km).
    distance : float
        Distance to buyer (km).
    is_certified : bool
        Whether the crop has quality certification.
    storage_days : int
        Number of days to store (0 = sell today).
    storage_cost_per_day : float
        ₹/kg/day storage cost.
    risk_tolerance : float
        Lambda (risk aversion coefficient).
    volatility : float
        Market volatility score.

    Returns
    -------
    dict with keys:
        ``gross_revenue`` : float
        ``transport_cost`` : float
        ``cert_penalty`` : float
        ``storage_cost`` : float
        ``risk_penalty`` : float
        ``net_realisation`` : float
        ``risk_adjusted_realisation`` : float
        ``per_kg_net`` : float
        ``line_items`` : list[dict]
            Ordered list of ``{label, amount, type}`` for display.
        ``explanation`` : str
            Human-readable summary.
    """
    cert_mult = 1.0 if is_certified else UNCERTIFIED_PENALTY

    # ── Compute each component ──────────────────────────────────
    gross_revenue = price * amount * cert_mult
    transport_cost = transport_rate * distance
    cert_penalty_amount = price * amount * (1.0 - cert_mult)  # the discount

    if storage_days > 0:
        storage_cost = (
            storage_cost_per_day * amount * (PERISHABILITY_BASE ** storage_days)
        )
    else:
        storage_cost = 0.0

    risk_penalty = risk_tolerance * volatility * amount

    net_realisation = gross_revenue - transport_cost - storage_cost
    risk_adjusted = net_realisation - risk_penalty

    per_kg_net = net_realisation / amount if amount > 0 else 0.0

    # ── Build line items for frontend display ───────────────────
    line_items = [
        {
            "label": "Gross Revenue (Price × Qty)",
            "amount": round(gross_revenue, 2),
            "type": "add",
            "formula": f"Rs {price:,.2f} × {amount:,.0f} kg"
                       + ("" if is_certified else f" × {cert_mult}"),
        },
    ]

    if cert_penalty_amount > 0:
        line_items.append({
            "label": "Quality Penalty (5% uncertified)",
            "amount": round(-cert_penalty_amount, 2),
            "type": "deduct",
            "formula": f"Rs {price:,.2f} × {amount:,.0f} × {1.0 - cert_mult:.2f}",
        })

    if transport_cost > 0:
        line_items.append({
            "label": "Transport Cost",
            "amount": round(-transport_cost, 2),
            "type": "deduct",
            "formula": f"Rs {transport_rate:,.2f}/km × {distance:,.1f} km",
        })

    if storage_cost > 0:
        line_items.append({
            "label": f"Storage Cost ({storage_days} days)",
            "amount": round(-storage_cost, 2),
            "type": "deduct",
            "formula": (
                f"Rs {storage_cost_per_day:,.2f}/kg/day × {amount:,.0f} kg "
                f"× {PERISHABILITY_BASE}^{storage_days}"
            ),
        })

    line_items.append({
        "label": "Net Realisation",
        "amount": round(net_realisation, 2),
        "type": "total",
        "formula": "",
    })

    if risk_penalty > 0:
        line_items.append({
            "label": "Risk Penalty (λ × Volatility × Qty)",
            "amount": round(-risk_penalty, 2),
            "type": "deduct",
            "formula": f"{risk_tolerance} × {volatility:,.1f} × {amount:,.0f}",
        })
        line_items.append({
            "label": "Risk-Adjusted Realisation",
            "amount": round(risk_adjusted, 2),
            "type": "final_total",
            "formula": "",
        })

    # ── Explanation ─────────────────────────────────────────────
    explanation_parts = [
        f"Selling {amount:,.0f} kg at Rs {price:,.0f}/kg",
    ]
    if not is_certified:
        explanation_parts.append("with a 5% quality penalty")
    if storage_days > 0:
        explanation_parts.append(f"after storing for {storage_days} days")
    explanation_parts.append(
        f"gives a net realisation of Rs {net_realisation:,.0f}"
    )
    if transport_cost > 0:
        explanation_parts.append(
            f"(after Rs {transport_cost:,.0f} transport cost)"
        )

    return {
        "gross_revenue": round(gross_revenue, 2),
        "transport_cost": round(transport_cost, 2),
        "cert_penalty": round(cert_penalty_amount, 2),
        "storage_cost": round(storage_cost, 2),
        "risk_penalty": round(risk_penalty, 2),
        "net_realisation": round(net_realisation, 2),
        "risk_adjusted_realisation": round(risk_adjusted, 2),
        "per_kg_net": round(per_kg_net, 2),
        "line_items": line_items,
        "explanation": " ".join(explanation_parts) + ".",
    }


def realisation_from_action(
    action,
    lot,
    buyer=None,
    prediction=None,
) -> dict:
    """
    Compute net realisation breakdown from an Action + context.

    Convenience wrapper that extracts parameters from engine
    dataclasses and calls ``calculate_net_realisation``.
    """
    from .models import Action, Lot, Buyer, MarketPrediction

    price = 0.0
    transport_rate = 0.0
    distance = 0.0
    storage_days = action.days

    if action.action_type == "SELL" and buyer:
        price = buyer.price
        transport_rate = buyer.transport_rate
        distance = buyer.distance
    elif action.action_type == "STORE" and prediction:
        if prediction.price_by_day and storage_days > 0:
            idx = min(storage_days - 1, len(prediction.price_by_day) - 1)
            price = prediction.price_by_day[idx]
        else:
            price = prediction.expected_future_price

    return calculate_net_realisation(
        price=price,
        amount=action.amount,
        transport_rate=transport_rate,
        distance=distance,
        is_certified=lot.is_certified,
        storage_days=storage_days,
        storage_cost_per_day=(
            prediction.storage_cost_per_day if prediction else 0.0
        ),
        risk_tolerance=lot.risk_tolerance,
        volatility=prediction.volatility if prediction else 0.0,
    )

