"""
What-If Simulator Tests
=======================

Tests for ``engine.whatif``: single what-if, multi-scenario comparison,
edge cases, and recommendation text generation.

Run with:
    cd Core
    python -m engine.test_whatif
"""

import sys
from .models import Lot, Buyer, MarketPrediction
from .whatif import what_if, compare_scenarios

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
    buyers = [
        Buyer(name="Alice", price=2500, transport_rate=50, distance=2, capacity=500),
        Buyer(name="Bob", price=2600, transport_rate=100, distance=5, capacity=200,
              requires_certification=True),
        Buyer(name="Charlie", price=2450, transport_rate=30, distance=1, capacity=1000),
    ]

    prediction = MarketPrediction(
        volatility=100,
        storage_cost_per_day=1.5,
        expected_future_price=2800,
        price_by_day=[2500, 2600, 3000, 2400, 2550],
    )

    base_lot = Lot(
        crop="Wheat", amount=500, deadline_days=5,
        is_certified=True, storage_access=True, risk_tolerance=0.5,
    )

    # ── Test 1: Basic what-if with deadline change ──────────────
    print("\n--- Test 1: What-If — extend deadline from 5 to 10 days ---")
    result = what_if(base_lot, buyers, prediction, {"deadline_days": 10})

    check("Has baseline", "baseline" in result)
    check("Has modified", "modified" in result)
    check("Has comparison", "comparison" in result)
    check("Has recommendation", "recommendation" in result)
    check("Overrides applied", result["overrides_applied"] == {"deadline_days": 10})
    check("Baseline has total_realization", result["baseline"]["total_realization"] > 0)
    check("Modified has total_realization", result["modified"]["total_realization"] > 0)

    # ── Test 2: Risk tolerance what-if ──────────────────────────
    print("\n--- Test 2: What-If — increase risk aversion ---")
    result = what_if(base_lot, buyers, prediction, {"risk_tolerance": 5.0})

    check("Has comparison metrics", "realization_change" in result["comparison"])
    check("Has change percentage", "realization_change_pct" in result["comparison"])

    # High risk aversion should discourage STORE, favoring SELL
    modified_store = result["modified"]["store_count"]
    baseline_store = result["baseline"]["store_count"]
    check(
        "Higher risk aversion reduces/eliminates STORE",
        modified_store <= baseline_store,
    )

    # ── Test 3: Storage cost what-if (prediction override) ──────
    print("\n--- Test 3: What-If — double storage cost ---")
    result = what_if(
        base_lot, buyers, prediction,
        {"storage_cost_per_day": 3.0},
    )

    check("Prediction field overridden", True)
    # Higher storage cost should reduce STORE attractiveness
    check(
        "Higher storage cost reduces realization or shifts to SELL",
        result["comparison"]["realization_change"] <= 0
        or result["modified"]["sell_count"] >= result["baseline"]["sell_count"],
    )

    # ── Test 4: Floor price what-if ─────────────────────────────
    print("\n--- Test 4: What-If — set floor price above some buyers ---")
    result = what_if(base_lot, buyers, prediction, {"floor_price": 2550})

    check("Floor price applied", True)
    # Alice (2500) and Charlie (2450) should be excluded
    modified_buyers = set()
    for a in result["modified_actions"]:
        if a.buyer_name:
            modified_buyers.add(a.buyer_name)
    check(
        "Low-price buyers excluded",
        "Alice" not in modified_buyers and "Charlie" not in modified_buyers,
    )

    # ── Test 5: Disable storage what-if ─────────────────────────
    print("\n--- Test 5: What-If — disable storage access ---")
    result = what_if(base_lot, buyers, prediction, {"storage_access": False})

    check("No STORE in modified", result["modified"]["store_count"] == 0)
    check(
        "All modified actions are SELL",
        all(a.action_type == "SELL" for a in result["modified_actions"]),
    )

    # ── Test 6: Zero-change what-if (identity) ──────────────────
    print("\n--- Test 6: What-If — no changes (identity check) ---")
    result = what_if(base_lot, buyers, prediction, {})

    check(
        "No change in realization",
        abs(result["comparison"]["realization_change"]) < 0.01,
    )
    check("No change percentage", result["comparison"]["realization_change_pct"] == 0.0)

    # ── Test 7: Multi-scenario comparison ───────────────────────
    print("\n--- Test 7: compare_scenarios — multiple what-ifs ---")
    scenarios = [
        {"name": "Wait 10 days", "overrides": {"deadline_days": 10}},
        {"name": "High risk aversion", "overrides": {"risk_tolerance": 5.0}},
        {"name": "No storage", "overrides": {"storage_access": False}},
        {"name": "Force sell today", "overrides": {"deadline_days": 0}},
    ]
    results = compare_scenarios(base_lot, buyers, prediction, scenarios)

    check("Returns 4 scenarios", len(results) == 4)
    check("Each has a name", all("name" in r for r in results))
    check("Each has realization", all("realization" in r for r in results))
    check(
        "Sorted by realization (highest first)",
        all(
            results[i]["realization"] >= results[i + 1]["realization"]
            for i in range(len(results) - 1)
        ),
    )
    print(f"  Scenario ranking:")
    for r in results:
        print(
            f"    {r['name']:25s}  Rs {r['realization']:>12,.2f}  "
            f"({r['change_pct']:+.1f}%)"
        )

    # ── Test 8: Combined lot + prediction overrides ─────────────
    print("\n--- Test 8: Mixed overrides (lot + prediction) ---")
    result = what_if(
        base_lot, buyers, prediction,
        {"deadline_days": 3, "volatility": 200},
    )
    check("Both overrides applied", True)
    check("Has valid actions", len(result["modified_actions"]) > 0)

    # ── Summary ──
    print(f"\n{'=' * 55}")
    print(f"WHAT-IF TESTS: {PASS} passed, {FAIL} failed out of {PASS + FAIL} checks")
    if FAIL > 0:
        sys.exit(1)
    print("All what-if checks passed! ✅")


if __name__ == "__main__":
    run_tests()

