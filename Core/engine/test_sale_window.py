"""
Sale Window Recommender Tests
=============================

Tests for ``engine.sale_window``: peak day detection, storage cost
deduction, risk adjustment, edge cases.

Run with:
    cd Core
    python -m engine.test_sale_window
"""

import sys
from .models import MarketPrediction
from .sale_window import find_best_sale_window

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

    # ── Test 1: Basic peak detection ────────────────────────────
    print("\n--- Test 1: Peak day detection (day 3 is highest) ---")
    prediction = MarketPrediction(
        volatility=10,
        storage_cost_per_day=1.0,
        expected_future_price=2800,
        price_by_day=[2500, 2600, 3000, 2400, 2550],
    )

    result = find_best_sale_window(
        commodity="Wheat",
        market="TestMandi",
        amount=500,
        max_days=5,
        prediction=prediction,
        risk_tolerance=0.0,  # no risk penalty for clean test
    )

    check("Status is success", result["status"] == "success")
    check(f"Best day is 3 (got {result['best_day']})", result["best_day"] == 3)
    check(f"Best price is 3000 (got {result['best_price']})", result["best_price"] == 3000)
    check("Has daily breakdown", len(result["daily_breakdown"]) == 5)
    check("Has recommendation text", len(result["recommendation"]) > 0)
    check("Advantage over today > 0", result["advantage_over_today"] > 0)

    # ── Test 2: Storage cost makes waiting unprofitable ─────────
    print("\n--- Test 2: High storage cost — sell today is best ---")
    prediction_flat = MarketPrediction(
        volatility=10,
        storage_cost_per_day=50.0,  # very high storage cost
        expected_future_price=2500,
        price_by_day=[2500, 2510, 2520, 2530, 2540],
    )

    result = find_best_sale_window(
        commodity="Wheat",
        market="TestMandi",
        amount=500,
        max_days=5,
        prediction=prediction_flat,
        risk_tolerance=0.0,
    )

    check("Status is success", result["status"] == "success")
    check(
        f"Best day is 0 (sell today) — got {result['best_day']}",
        result["best_day"] == 0,
    )

    # ── Test 3: Risk aversion shifts optimal day ────────────────
    print("\n--- Test 3: Risk aversion shifts optimal day earlier ---")
    prediction_rising = MarketPrediction(
        volatility=100,  # high volatility
        storage_cost_per_day=1.0,
        expected_future_price=3000,
        price_by_day=[2500, 2600, 2700, 2800, 2900],
    )

    # Risk-tolerant: should wait
    result_tolerant = find_best_sale_window(
        commodity="Wheat",
        market="TestMandi",
        amount=500,
        max_days=5,
        prediction=prediction_rising,
        risk_tolerance=0.0,
    )

    # Risk-averse: should sell sooner
    result_averse = find_best_sale_window(
        commodity="Wheat",
        market="TestMandi",
        amount=500,
        max_days=5,
        prediction=prediction_rising,
        risk_tolerance=5.0,
    )

    check(
        f"Tolerant waits longer (day {result_tolerant['best_day']}) "
        f"than averse (day {result_averse['best_day']})",
        result_tolerant["best_day"] >= result_averse["best_day"],
    )

    # ── Test 4: Uncertified penalty ─────────────────────────────
    print("\n--- Test 4: Uncertified crop has lower realization ---")
    result_cert = find_best_sale_window(
        commodity="Wheat", market="Test",
        amount=1000, max_days=5,
        prediction=prediction, is_certified=True,
        risk_tolerance=0.0,
    )
    result_uncert = find_best_sale_window(
        commodity="Wheat", market="Test",
        amount=1000, max_days=5,
        prediction=prediction, is_certified=False,
        risk_tolerance=0.0,
    )

    check(
        "Certified realization > uncertified",
        result_cert["net_realization"] > result_uncert["net_realization"],
    )

    # ── Test 5: Fallback with expected_future_price only ────────
    print("\n--- Test 5: No price_by_day — uses expected_future_price ---")
    prediction_fallback = MarketPrediction(
        volatility=50,
        storage_cost_per_day=1.5,
        expected_future_price=3000,
        price_by_day=[],  # empty
    )

    result = find_best_sale_window(
        commodity="Wheat", market="Test",
        amount=500, max_days=10,
        prediction=prediction_fallback,
        risk_tolerance=0.5,
    )

    check("Status is success", result["status"] == "success")
    check("Has daily breakdown", len(result["daily_breakdown"]) > 0)
    check("Used fallback price", result["best_price"] == 3000)

    # ── Test 6: No data at all ──────────────────────────────────
    print("\n--- Test 6: No price data → returns no_data ---")
    prediction_empty = MarketPrediction(
        volatility=0,
        storage_cost_per_day=0,
        expected_future_price=0,
        price_by_day=[],
    )

    result = find_best_sale_window(
        commodity="Wheat", market="Test",
        amount=500, max_days=5,
        prediction=prediction_empty,
    )

    check("Status is no_data", result["status"] == "no_data")

    # ── Test 7: Daily breakdown correctness ─────────────────────
    print("\n--- Test 7: Daily breakdown math verification ---")
    simple_pred = MarketPrediction(
        volatility=0,
        storage_cost_per_day=2.0,
        expected_future_price=0,
        price_by_day=[1000, 1100, 1200],
    )

    result = find_best_sale_window(
        commodity="Test", market="Test",
        amount=100, max_days=3,
        prediction=simple_pred,
        is_certified=True,
        risk_tolerance=0.0,
    )

    day1 = result["daily_breakdown"][0]
    check(
        f"Day 1 gross = 1000 × 100 = 100000 (got {day1['gross_realization']})",
        abs(day1["gross_realization"] - 100000) < 0.01,
    )
    from .constants import PERISHABILITY_BASE as PB
    expected_storage_day1 = 2.0 * 100 * (PB ** 1)
    check(
        f"Day 1 storage cost correct (got {day1['cumulative_storage_cost']})",
        abs(day1["cumulative_storage_cost"] - expected_storage_day1) < 0.01,
    )

    # ── Summary ──
    print(f"\n{'=' * 55}")
    print(f"SALE WINDOW TESTS: {PASS} passed, {FAIL} failed out of {PASS + FAIL} checks")
    if FAIL > 0:
        sys.exit(1)
    print("All sale window checks passed! ✅")


if __name__ == "__main__":
    run_tests()
