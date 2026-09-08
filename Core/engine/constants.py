import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CURR_PRICE_DIR = os.path.join(BASE_DIR, "..", 'data', 'currPrices')
EST_PRICE_DIR = os.path.join(BASE_DIR, "..", 'data', 'estPrices')

WHEAT_CURR_PATH = os.path.join(CURR_PRICE_DIR, "Wheat.csv")

# ─── Centralized Hyperparameters ───────────────────────────────────────
# These were previously hardcoded across optimizer.py in 5+ locations.

UNCERTIFIED_PENALTY = 0.95          # 5% discount multiplier for uncertified crops
PERISHABILITY_BASE = 1.05           # Exponential storage decay base (per day)
DEFAULT_STORAGE_DAYS = 10           # Fallback storage horizon when no price_by_day data