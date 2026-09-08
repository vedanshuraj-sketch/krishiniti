# Project: SIH PS 26132 — Optimization & Decision Engine

## Objective

To build the "decision brain" for an agricultural market linkage and price discovery platform. Given a farmer's crop lot (crop type, quantity, quality, location, cash needs, storage access, and risk tolerance), the engine must recommend the optimal action (sell now, store, split across buyers, or aggregate) to maximize risk-adjusted expected net realization. The engine serves as an intelligence layer on top of existing marketplaces, not just another marketplace.

## Current State & Accomplishments

- **Decoupled Architecture**: Designed clean entities (`Lot`, `Buyer`, `MarketPrediction`, `Action`) to represent states and decisions independently of data ingestion.
- **Candidate Generation**: Implemented dynamic filters for buyer blacklists, floor prices, and certification eligibility.
- **Scoring Engine**: Implemented robust math to calculate expected realization:
  - Deducts total transport costs based on buyer distance.
  - Applies a mathematically rigorous uncertified quality penalty (e.g., 5% discount).
  - Calculates exponential non-linear storage costs for perishables.
  - Subtracts a $\lambda$-weighted volatility penalty for risk-averse farmers.
- **Greedy Optimization & Allocation**: Developed an allocator that handles:
  - Max profit routing.
  - Distress sales (must sell today).
  - Partial liquidity matching (intelligently splits sales across top buyers to meet a specific cash target, and routes the remainder to optimal storage/sale).
- **AI-ML Integration**: Connected to AI-ML forecasting service via HTTP adapter (`port/aiml_client.py`), with guardrails for anomaly detection and low-confidence forecasts.
- **What-If Simulator**: Allows farmers to tweak variables and instantly compare scenarios.
- **Sale Window Recommender**: Finds the optimal day to sell within a time horizon.
- **Multi-Lot Portfolio Optimizer**: Optimizes across multiple crop lots simultaneously, balancing aggregate risk and shared constraints.
- **Net Realisation Calculator**: Provides line-by-line financial breakdowns for frontend display.
- **Testing**: Comprehensive automated tests across all modules.

## Forward Plan & Next Steps

### Phase 2: Advanced Optimization Scenarios

- [x] **Volume Mismatch & Aggregation**: If a lot is too small for a buyer's minimum threshold, generate an "Aggregate with other FPOs" recommendation.
- [x] **Time-Window Search (Sell-within-X-days)**: Search across a future time window (e.g., 5 days) to find the absolute peak day to sell, rather than just binary "Sell Today vs Store for 10 days".
- [x] **Multi-Lot Portfolio**: Optimize across multiple different crops or lots for a single farmer simultaneously to balance aggregate risk.
- [x] **Single-Buyer Constraint**: Add a flag to force the allocator to select exactly one buyer, bypassing the partial split logic if the farmer refuses to split shipments.

### Phase 3: API Functions (Ready for Backend to Wrap)

- [x] **Recommend Function**: `port.recommend.recommend()` — full AI-powered recommendation with guardrails.
- [x] **What-If Simulator**: `engine.whatif.what_if()` and `engine.whatif.compare_scenarios()` — tweak variables and compare outcomes.
- [x] **Sale Window Recommender**: `engine.sale_window.find_best_sale_window()` — find the optimal day to sell.
- [x] **Portfolio Optimizer**: `engine.portfolio.optimize_portfolio()` — multi-lot optimization.
- [x] **Net Realisation Calculator**: `engine.net_realisation.calculate_net_realisation()` — detailed financial breakdown.

### Phase 3 REST API Note

REST endpoints (`/recommend`, `/what-if`, etc.) are the Backend Engineer's responsibility. All Python functions are ready for them to wrap with FastAPI/Express.
