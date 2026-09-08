"""
Port package — external integration adapters.

Provides the bridge between the Core optimization engine and
external services (AI-ML forecasting, data sources, etc.).
"""

from .aiml_client import fetch_market_prediction, fetch_market_prediction_safe
from .recommend import recommend

__all__ = [
    "fetch_market_prediction",
    "fetch_market_prediction_safe",
    "recommend",
]

