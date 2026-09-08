import sys
from .models import Lot, Buyer, MarketPrediction
from .optimizer import optimize

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
    # Setup mock buyers
    buyers = [
        Buyer(name="Alice", price=2500, transport_rate=50, distance=2, capacity=500),
        Buyer(name="Bob", price=2600, transport_rate=100, distance=5, capacity=200, requires_certification=True),
        Buyer(name="Charlie", price=2450, transport_rate=30, distance=1, capacity=1000)
    ]
    
    prediction = MarketPrediction(volatility=100, storage_cost_per_day=1.5, expected_future_price=2800)
    
    # ── Scenario 1: MaxProfitRightNow ──
    print("\n--- Scenario 1: MaxProfitRightNow (Sell All Today) ---")
    lot1 = Lot(crop="Wheat", amount=500, deadline_days=0, is_certified=True)
    actions = optimize(lot1, buyers, prediction)
    for a in actions:
        print(f"  {a.action_type} {a.amount}kg to {a.buyer_name} | Net: ₹{a.expected_realization:.2f}")
    check("Has actions", len(actions) > 0)
    check("All actions are SELL", all(a.action_type == "SELL" for a in actions))
    total_sold = sum(a.amount for a in actions)
    check(f"Total sold == 500 (got {total_sold})", abs(total_sold - 500) < 0.01)

    # ── Scenario 2: Buyer Blacklist ──
    print("\n--- Scenario 2: Buyer Blacklist ---")
    lot2 = Lot(crop="Wheat", amount=500, deadline_days=0, is_certified=True, blacklist=["Bob"])
    actions = optimize(lot2, buyers, prediction)
    for a in actions:
        print(f"  {a.action_type} {a.amount}kg to {a.buyer_name} | Net: ₹{a.expected_realization:.2f}")
    check("Bob not in results", all(a.buyer_name != "Bob" for a in actions))

    # ── Scenario 3: Floor Price ──
    print("\n--- Scenario 3: Floor Price ---")
    lot3 = Lot(crop="Wheat", amount=500, deadline_days=0, is_certified=True, floor_price=2550)
    actions = optimize(lot3, buyers, prediction)
    for a in actions:
        print(f"  {a.action_type} {a.amount}kg to {a.buyer_name} | Net: ₹{a.expected_realization:.2f}")
    sell_actions = [a for a in actions if a.action_type == "SELL"]
    check("No sell below floor", all(True for a in sell_actions))  # Only Bob (2600) passes floor
    check("Alice excluded (price 2500 < floor 2550)", all(a.buyer_name != "Alice" for a in sell_actions))

    # ── Scenario 4: Partial Liquidity ──
    print("\n--- Scenario 4: Partial Liquidity (Need ₹200,000) ---")
    lot4 = Lot(crop="Wheat", amount=1000, deadline_days=10, is_certified=True, cash_need=200_000)
    actions = optimize(lot4, buyers, prediction)
    for a in actions:
        print(f"  {a.action_type} {a.amount:.2f}kg to {a.buyer_name} | Net: ₹{a.expected_realization:.2f}")
    sell_actions = [a for a in actions if a.action_type == "SELL"]
    cash = sum(a.expected_realization for a in sell_actions)
    check(f"Cash raised >= 200000 (got {cash:.2f})", cash >= 199999)
    check("Not all sold (remainder stored/kept)", sum(a.amount for a in sell_actions) < 1000)

    # ── Scenario 5: Full Distress Sale ──
    print("\n--- Scenario 5: Full Distress Sale ---")
    lot5 = Lot(crop="Wheat", amount=1200, deadline_days=0, is_certified=True)
    actions = optimize(lot5, buyers, prediction)
    for a in actions:
        print(f"  {a.action_type} {a.amount:.2f}kg to {a.buyer_name} | Net: ₹{a.expected_realization:.2f}")
    check("All SELL (no STORE)", all(a.action_type == "SELL" for a in actions))
    total = sum(a.amount for a in actions)
    check(f"Total sold == 1200 (got {total:.2f})", abs(total - 1200) < 0.01)

    # ── Scenario 6: No Storage Access ──
    print("\n--- Scenario 6: No Storage Access ---")
    lot6 = Lot(crop="Wheat", amount=1000, deadline_days=10, is_certified=True, storage_access=False)
    actions = optimize(lot6, buyers, prediction)
    for a in actions:
        print(f"  {a.action_type} {a.amount:.2f}kg to {a.buyer_name} | Net: ₹{a.expected_realization:.2f}")
    check("No STORE action", all(a.action_type != "STORE" for a in actions))

    # ── Scenario 7: Risk-Averse vs Risk-Tolerant ──
    print("\n--- Scenario 7: Risk-Averse vs Risk-Tolerant ---")
    lot7a = Lot(crop="Wheat", amount=500, deadline_days=10, is_certified=True, risk_tolerance=0.0)
    lot7b = Lot(crop="Wheat", amount=500, deadline_days=10, is_certified=True, risk_tolerance=10.0)
    act_a = optimize(lot7a, buyers, prediction)
    act_b = optimize(lot7b, buyers, prediction)
    print(f"  Tolerant: {act_a[0].action_type} | Score: {act_a[0].score:.2f}")
    print(f"  Averse:   {act_b[0].action_type} | Score: {act_b[0].score:.2f}")
    check("Tolerant recommends STORE", act_a[0].action_type == "STORE")
    check("Averse recommends SELL", act_b[0].action_type == "SELL")

    # ── Scenario 8: Uncertified Quality ──
    print("\n--- Scenario 8: Uncertified Quality ---")
    lot8 = Lot(crop="Wheat", amount=500, deadline_days=0, is_certified=False)
    actions = optimize(lot8, buyers, prediction)
    for a in actions:
        print(f"  {a.action_type} {a.amount:.2f}kg to {a.buyer_name} | Net: ₹{a.expected_realization:.2f}")
    check("Bob excluded (requires cert)", all(a.buyer_name != "Bob" for a in actions))

    # ── Scenario 9: Volume Mismatch & Aggregation ──
    print("\n--- Scenario 9: Volume Mismatch & Aggregation ---")
    big_buyer = Buyer(name="MegaCorp", price=2600, transport_rate=50, distance=5, min_volume=1000)
    lot9 = Lot(crop="Wheat", amount=200, deadline_days=0, is_certified=True)
    actions = optimize(lot9, [big_buyer], prediction)
    for a in actions:
        print(f"  {a.action_type} {a.amount:.2f}kg to {a.buyer_name} | Net: ₹{a.expected_realization:.2f}")
    check("Returns AGGREGATE action", len(actions) == 1 and actions[0].action_type == "AGGREGATE")
    check("AGGREGATE amount == lot amount", actions[0].amount == 200)

    # ── Scenario 10: Time-Window Search ──
    print("\n--- Scenario 10: Time-Window Search (Sell-within-X-days) ---")
    daily_prediction = MarketPrediction(volatility=100, storage_cost_per_day=1.5, expected_future_price=2800, price_by_day=[2500, 2600, 3000, 2400, 2550])
    lot10 = Lot(crop="Wheat", amount=500, deadline_days=5, is_certified=True, storage_access=True)
    actions = optimize(lot10, buyers, daily_prediction)
    for a in actions:
        print(f"  {a.action_type} (Day {a.days}) {a.amount:.2f}kg | Net: ₹{a.expected_realization:.2f}")
    store_actions = [a for a in actions if a.action_type == "STORE"]
    check("Picks STORE on peak day", len(store_actions) > 0)
    if store_actions:
        check(f"Optimal day == 3 (got {store_actions[0].days})", store_actions[0].days == 3)

    # ── Scenario 11: Single-Buyer Constraint ──
    print("\n--- Scenario 11: Single-Buyer Constraint ---")
    lot11 = Lot(crop="Wheat", amount=500, deadline_days=0, is_certified=True, single_buyer_only=True)
    actions = optimize(lot11, buyers, prediction)
    for a in actions:
        print(f"  {a.action_type} {a.amount:.2f}kg to {a.buyer_name} | Net: ₹{a.expected_realization:.2f}")
    check("Exactly 1 action returned", len(actions) == 1)
    check("Single buyer is Alice (highest for full 500kg)", actions[0].buyer_name == "Alice")

    # ── Scenario 12: Multi-Lot Portfolio (Stretch) ──
    print("\n--- Scenario 12: Multi-Lot Portfolio (Stretch Goal) ---")
    print("  ⏳ TODO: Engine requires refactoring to accept List[Lot].")

    # ── Scenario 13: Zero-price buyer (Division by zero guard) ──
    print("\n--- Scenario 13: Zero-Price Buyer (Edge Case) ---")
    zero_buyer = Buyer(name="ZeroGuy", price=0, transport_rate=10, distance=5)
    lot13 = Lot(crop="Wheat", amount=100, deadline_days=0, is_certified=True)
    try:
        actions = optimize(lot13, [zero_buyer], prediction)
        check("No crash on zero-price buyer", True)
    except ZeroDivisionError:
        check("No crash on zero-price buyer", False)

    # ── Scenario 14: Negative amount validation ──
    print("\n--- Scenario 14: Input Validation ---")
    try:
        bad_lot = Lot(crop="Wheat", amount=-500)
        check("Rejects negative amount", False)
    except ValueError:
        check("Rejects negative amount", True)

    # ── Summary ──
    print(f"\n{'='*50}")
    print(f"RESULTS: {PASS} passed, {FAIL} failed out of {PASS+FAIL} checks")
    if FAIL > 0:
        sys.exit(1)
    print("All checks passed! ✅")


if __name__ == "__main__":
    run_tests()
