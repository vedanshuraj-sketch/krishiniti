"""
Multi-Lot Portfolio Optimizer Tests
====================================

Tests for ``engine.portfolio``: urgency ordering, shared cash need,
storage capacity limits, mixed lot scenarios.

Run with:
    cd Core
    python -m engine.test_portfolio
"""

import sys
from .models import Lot, Buyer, MarketPrediction
from .portfolio import optimize_portfolio

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


def run_tests():
    global PASS, FAIL

    # ── Setup ──────────────────────────────────────────────────
    wheat_buyers = [
        Buyer(name="Alice", price=2500, transport_rate=50, distance=2, capacity=500),
        Buyer(name="Bob", price=2600, transport_rate=100, distance=5, capacity=300,
              requires_certification=True),
    ]
    groundnut_buyers = [
        Buyer(name="Rajkot Mandi", price=5800, transport_rate=50, distance=2, capacity=1000),
        Buyer(name="Junagadh Mandi", price=5900, transport_rate=80, distance=10, capacity=500),
    ]
    cotton_buyers = [
        Buyer(name="Cotton Trader", price=6000, transport_rate=60, distance=8, capacity=300),
    ]

    wheat_pred = MarketPrediction(
        volatility=50, storage_cost_per_day=1.0,
        expected_future_price=2800,
        price_by_day=[2500, 2600, 2700, 2800, 2900],
    )
    groundnut_pred = MarketPrediction(
        volatility=80, storage_cost_per_day=2.0,
        expected_future_price=6000,
        price_by_day=[5850, 5900, 5950, 6000, 6050],
    )

    # ── Test 1: Basic multi-lot portfolio ───────────────────────
    print("\n--- Test 1: Basic 2-lot portfolio ---")
    lots = [
        Lot(crop="Wheat", amount=500, deadline_days=5, is_certified=True),
        Lot(crop="Groundnut", amount=300, deadline_days=5, is_certified=True),
    ]

    result = optimize_portfolio(
        lots=lots,
        buyers_by_crop={
            "wheat": wheat_buyers,
            "groundnut": groundnut_buyers,
        },
        predictions_by_crop={
            "wheat": wheat_pred,
            "groundnut": groundnut_pred,
        },
    )

    check("Status is success", result["status"] == "success")
    check("2 lot results", len(result["per_lot_results"]) == 2)
    check("Has portfolio summary", "portfolio_summary" in result)
    check("Has processing order", len(result["processing_order"]) == 2)
    check(
        "Total realization > 0",
        result["portfolio_summary"]["total_realization"] > 0,
    )
    check("Has recommendation", len(result["recommendation"]) > 0)
    print(f"  Total: Rs {result['portfolio_summary']['total_realization']:,.2f}")

    # ── Test 2: Urgency ordering (distress lot first) ───────────
    print("\n--- Test 2: Urgency ordering — distress lot processed first ---")
    lots = [
        Lot(crop="Wheat", amount=500, deadline_days=10, is_certified=True),  # can wait
        Lot(crop="Groundnut", amount=300, deadline_days=0, is_certified=True),  # URGENT
    ]

    result = optimize_portfolio(
        lots=lots,
        buyers_by_crop={
            "wheat": wheat_buyers,
            "groundnut": groundnut_buyers,
        },
        predictions_by_crop={
            "wheat": wheat_pred,
            "groundnut": groundnut_pred,
        },
    )

    check(
        "Distress lot (Groundnut) processed first",
        "Groundnut" in result["processing_order"][0],
    )

    # ── Test 3: Shared cash need across lots ────────────────────
    print("\n--- Test 3: Portfolio-level cash need ---")
    lots = [
        Lot(crop="Wheat", amount=500, deadline_days=5, is_certified=True),
        Lot(crop="Groundnut", amount=300, deadline_days=5, is_certified=True),
    ]

    result = optimize_portfolio(
        lots=lots,
        buyers_by_crop={
            "wheat": wheat_buyers,
            "groundnut": groundnut_buyers,
        },
        predictions_by_crop={
            "wheat": wheat_pred,
            "groundnut": groundnut_pred,
        },
        total_cash_need=500_000,
    )

    check(
        "Portfolio tracks cash raised",
        result["portfolio_summary"]["total_cash_raised"] > 0,
    )
    check(
        f"Cash need tracking in summary",
        "cash_need_met" in result["portfolio_summary"],
    )

    # ── Test 4: Storage capacity constraint ─────────────────────
    print("\n--- Test 4: Shared storage capacity limit ---")
    lots = [
        Lot(crop="Wheat", amount=500, deadline_days=5,
            is_certified=True, storage_access=True),
        Lot(crop="Groundnut", amount=500, deadline_days=5,
            is_certified=True, storage_access=True),
    ]

    result = optimize_portfolio(
        lots=lots,
        buyers_by_crop={
            "wheat": wheat_buyers,
            "groundnut": groundnut_buyers,
        },
        predictions_by_crop={
            "wheat": wheat_pred,
            "groundnut": groundnut_pred,
        },
        max_total_storage_kg=300,  # only 300 kg can be stored total
    )

    total_stored = result["portfolio_summary"]["total_stored_kg"]
    check(
        f"Total stored ≤ 300 kg (got {total_stored})",
        total_stored <= 300,
    )

    # ── Test 5: Mixed lot types ─────────────────────────────────
    print("\n--- Test 5: Mixed lots (distress + storage + no-buyers) ---")
    lots = [
        Lot(crop="Wheat", amount=500, deadline_days=0, is_certified=True),   # distress
        Lot(crop="Groundnut", amount=300, deadline_days=10, is_certified=True),  # can wait
        Lot(crop="Cotton", amount=200, deadline_days=5, is_certified=True),  # limited buyers
    ]

    result = optimize_portfolio(
        lots=lots,
        buyers_by_crop={
            "wheat": wheat_buyers,
            "groundnut": groundnut_buyers,
            "cotton": cotton_buyers,
        },
        predictions_by_crop={
            "wheat": wheat_pred,
            "groundnut": groundnut_pred,
        },
    )

    check("3 lot results", len(result["per_lot_results"]) == 3)
    check(
        "All lots have some action",
        result["portfolio_summary"]["lots_with_actions"] == 3,
    )

    # The distress wheat lot should have only SELL actions
    wheat_result = next(r for r in result["per_lot_results"] if r["crop"] == "Wheat")
    check(
        "Distress wheat lot: all SELL",
        all(t == "SELL" for t in wheat_result["action_types"]),
    )

    # ── Test 6: Empty buyers for a crop ─────────────────────────
    print("\n--- Test 6: Lot with no buyers → no actions (partial status) ---")
    lots = [
        Lot(crop="Wheat", amount=500, deadline_days=0, is_certified=True),
        Lot(crop="Mango", amount=100, deadline_days=0, is_certified=True),  # no buyers
    ]

    result = optimize_portfolio(
        lots=lots,
        buyers_by_crop={
            "wheat": wheat_buyers,
            # no "mango" entry
        },
    )

    check("Status is partial", result["status"] == "partial")
    mango_result = next(r for r in result["per_lot_results"] if r["crop"] == "Mango")
    check("Mango lot has no actions", len(mango_result["actions"]) == 0)

    # ── Test 7: Single lot portfolio (should match optimize()) ──
    print("\n--- Test 7: Single lot portfolio matches optimize() ---")
    from .optimizer import optimize

    single_lot = Lot(crop="Wheat", amount=500, deadline_days=5, is_certified=True)

    direct_actions = optimize(single_lot, wheat_buyers, wheat_pred)
    portfolio_result = optimize_portfolio(
        lots=[single_lot],
        buyers_by_crop={"wheat": wheat_buyers},
        predictions_by_crop={"wheat": wheat_pred},
    )

    direct_total = sum(a.expected_realization for a in direct_actions)
    portfolio_total = portfolio_result["portfolio_summary"]["total_realization"]

    check(
        f"Single-lot portfolio matches direct optimize "
        f"(direct={direct_total:.2f}, portfolio={portfolio_total:.2f})",
        abs(direct_total - portfolio_total) < 0.01,
    )

    # ── Summary ──
    print(f"\n{'=' * 55}")
    print(f"PORTFOLIO TESTS: {PASS} passed, {FAIL} failed out of {PASS + FAIL} checks")
    if FAIL > 0:
        sys.exit(1)
    print("All portfolio checks passed! ✅")


if __name__ == "__main__":
    run_tests()

