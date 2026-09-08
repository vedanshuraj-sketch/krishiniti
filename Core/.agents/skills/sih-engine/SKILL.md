---
name: sih-engine
description: >-
  Provides context, architecture guidelines, and domain knowledge for the SIH PS 26132 Optimization Engine. 
  Use this skill whenever working on the decision engine, farmer lot optimization, or SIH related code.
---

# SIH PS 26132 — Optimization Engine Guidelines

You are acting as the Optimization & Decision Engine Engineer for SIH PS 26132.
Your role is to build the "decision brain" that tells a farmer whether to **sell**, **store**, or **split** their crop to maximize risk-adjusted realization.

## 1. Domain Context

This is an intelligence layer on top of existing marketplaces (e-NAM, AgriBazaar).

- **Goal**: Maximize expected net realization (Profit) minus Risk (volatility penalty).
- **Core Entities**:
  - `Lot`: The farmer's crop, amount, constraints (cash need, deadline, storage access, risk tolerance, floor price, single_buyer_only).
  - `Buyer`: Available market buyers, with capacities, minimum volumes, transport rates, and distances.
  - `MarketPrediction`: Future prices, volatility (risk), and storage costs per day.

## 2. Core Architecture Rules

All optimization logic must be kept highly decoupled. Do not place business logic inside data fetchers.

- `models.py`: Strict data classes. **Do not put optimization logic here.**
- `optimizer.py`: The core engine. It must contain:
  - `generate_candidates(lot, buyers)`: Pre-filters invalid buyers (blacklists, floor price, certification bounds).
  - `score_sell_action` & `score_store_action`: Calculates financial realization mathematically.
  - `optimize(...)`: The greedy allocator that routes lots to buyers based on constraints.
- `core.py`: A wrapper that bridges the old `sellNow` API to the new `optimizer.py` to maintain backward compatibility with `./engine/activate`.

## 3. Business Logic & Constraints

When updating `optimizer.py`, strictly adhere to these math constraints:

- **Transport Cost**: Calculated as a flat fee or rate. `cost = buyer.transport_rate * buyer.distance`.
- **Uncertified Penalty**: If `Lot.is_certified == False`, apply a strict 5% discount multiplier (`0.95`) to the buyer's price.
- **Risk Tolerance Penalty**: For storage actions, subtract a volatility penalty: `lambda (risk_tolerance) * volatility * amount`.
- **Storage Cost**: Should be modeled exponentially to account for crop perishability: `base_cost * amount * (1.05 ^ days)`.
- **Partial Liquidity**: If the farmer needs exactly ₹X (`cash_need`), greedily allocate exact fractions of the lot to the highest-paying buyers until ₹X is reached. The remainder must then be evaluated for Storage or continued Selling.

## 4. Testing Workflow (Test-Driven Development)

Before finalizing any logic changes in `optimizer.py`, you **MUST** run the test suite to mathematically prove the allocator handles edge cases perfectly.

**Command to run tests:**

```bash
python3 -m engine.test_scenarios
```

### Phase 2 Test Cases

Currently, `test_scenarios.py` includes stubs/failing tests for Phase 2:

- **Scenario 9 (Volume Mismatch)**: The engine must return an `AGGREGATE` action if a buyer's `min_volume` is greater than the lot amount.
- **Scenario 10 (Time-Window Search)**: The engine must search the `prediction.price_by_day` array to find the optimal day to sell, rather than defaulting to a 10-day store.
- **Scenario 11 (Single-Buyer Constraint)**: The engine must strictly pick one buyer, even if splitting would yield higher profit.

Your job when implementing these features is to edit `optimizer.py` until these specific test outputs in `test_scenarios.py` are correct!
