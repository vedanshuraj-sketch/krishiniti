"""
Net Realisation Calculator Tests
=================================

Tests for ``engine.net_realisation``: basic calculations, cert penalty,
storage cost, risk penalty, line items, and edge cases.

Run with:
    cd Core
    python -m engine.test_net_realisation
"""

import sys
from .net_realisation import calculate_net_realisation, realisation_from_action
from .models import Lot, Buyer, MarketPrediction, Action

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

    # ── Test 1: Basic sell-today calculation ─────────────────────
    print("\n--- Test 1: Basic sell-today (no storage, no risk) ---")
    result = calculate_net_realisation(
        price=2500, amount=500,
        transport_rate=50, distance=2,
        is_certified=True,
    )

    expected_gross = 2500 * 500
    expected_transport = 50 * 2
    expected_net = expected_gross - expected_transport

    check(f"Gross = {expected_gross} (got {result['gross_revenue']})",
          abs(result["gross_revenue"] - expected_gross) < 0.01)
    check(f"Transport = {expected_transport} (got {result['transport_cost']})",
          abs(result["transport_cost"] - expected_transport) < 0.01)
    check(f"Net = {expected_net} (got {result['net_realisation']})",
          abs(result["net_realisation"] - expected_net) < 0.01)
    check("Has line items", len(result["line_items"]) >= 2)
    check("Has explanation", len(result["explanation"]) > 0)

    # ── Test 2: Uncertified penalty ─────────────────────────────
    print("\n--- Test 2: Uncertified crop — 5% penalty ---")
    result_cert = calculate_net_realisation(price=2000, amount=100, is_certified=True)
    result_uncert = calculate_net_realisation(price=2000, amount=100, is_certified=False)

    check(f"Certified gross = 200000 (got {result_cert['gross_revenue']})",
          abs(result_cert["gross_revenue"] - 200000) < 0.01)
    check(f"Uncertified gross = 190000 (got {result_uncert['gross_revenue']})",
          abs(result_uncert["gross_revenue"] - 190000) < 0.01)
    check(f"Cert penalty = 10000 (got {result_uncert['cert_penalty']})",
          abs(result_uncert["cert_penalty"] - 10000) < 0.01)

    # ── Test 3: Storage cost calculation ────────────────────────
    print("\n--- Test 3: Storage cost (5 days) ---")
    result = calculate_net_realisation(
        price=3000, amount=100,
        is_certified=True,
        storage_days=5,
        storage_cost_per_day=2.0,
    )

    expected_storage = 2.0 * 100 * (1.05 ** 5)
    check(f"Storage cost = {expected_storage:.2f} (got {result['storage_cost']})",
          abs(result["storage_cost"] - expected_storage) < 0.01)
    check("Storage deducted from net",
          result["net_realisation"] < result["gross_revenue"])

    # ── Test 4: Risk penalty ────────────────────────────────────
    print("\n--- Test 4: Risk penalty ---")
    result = calculate_net_realisation(
        price=2500, amount=500,
        is_certified=True,
        risk_tolerance=0.5,
        volatility=100,
    )

    expected_risk = 0.5 * 100 * 500
    check(f"Risk penalty = {expected_risk} (got {result['risk_penalty']})",
          abs(result["risk_penalty"] - expected_risk) < 0.01)
    check(
        "Risk-adjusted < net",
        result["risk_adjusted_realisation"] < result["net_realisation"],
    )

    # ── Test 5: Per-kg calculation ──────────────────────────────
    print("\n--- Test 5: Per-kg net realisation ---")
    result = calculate_net_realisation(
        price=5000, amount=200,
        transport_rate=100, distance=5,
        is_certified=True,
    )

    expected_per_kg = (5000 * 200 - 100 * 5) / 200
    check(f"Per-kg net = {expected_per_kg:.2f} (got {result['per_kg_net']})",
          abs(result["per_kg_net"] - expected_per_kg) < 0.01)

    # ── Test 6: Line items structure ────────────────────────────
    print("\n--- Test 6: Line items have correct structure ---")
    result = calculate_net_realisation(
        price=2500, amount=500,
        transport_rate=50, distance=2,
        is_certified=False,
        storage_days=3,
        storage_cost_per_day=1.5,
        risk_tolerance=0.5,
        volatility=100,
    )

    check("Has at least 5 line items", len(result["line_items"]) >= 5)

    for item in result["line_items"]:
        check(f"Line item '{item['label']}' has all fields",
              all(k in item for k in ("label", "amount", "type", "formula")))

    # Verify types
    types_present = [item["type"] for item in result["line_items"]]
    check("Has 'add' type", "add" in types_present)
    check("Has 'deduct' type", "deduct" in types_present)
    check("Has 'total' type", "total" in types_present)

    # ── Test 7: Zero amount edge case ───────────────────────────
    print("\n--- Test 7: Zero amount edge case ---")
    result = calculate_net_realisation(price=2500, amount=0)
    check("Net is 0", result["net_realisation"] == 0)
    check("Per-kg is 0", result["per_kg_net"] == 0)

    # ── Test 8: realisation_from_action ─────────────────────────
    print("\n--- Test 8: realisation_from_action convenience wrapper ---")
    action = Action(action_type="SELL", buyer_name="Alice", amount=500,
                    expected_realization=1250000, score=1250000, days=0)
    lot = Lot(crop="Wheat", amount=500, is_certified=True)
    buyer = Buyer(name="Alice", price=2500, transport_rate=50, distance=2)

    result = realisation_from_action(action, lot, buyer=buyer)
    check("Has net_realisation", result["net_realisation"] > 0)
    check("Has line_items", len(result["line_items"]) > 0)

    # ── Summary ──
    print(f"\n{'=' * 60}")
    print(f"NET REALISATION TESTS: {PASS} passed, {FAIL} failed out of {PASS + FAIL} checks")
    if FAIL > 0:
        sys.exit(1)
    print("All net realisation checks passed! ✅")


if __name__ == "__main__":
    run_tests()

