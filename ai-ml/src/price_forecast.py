"""
Short-term mandi price forecasting for KRISHINITI (Gujarat).

Uses a simple Moving Average + Linear Trend model to forecast modal prices
for a given commodity–market pair. Designed to be explainable for hackathon demos.

Usage:
    python price_forecast.py
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
DATA_PATH = SCRIPT_DIR.parent / "data" / "processed" / "gujarat_prices_clean.csv"

MIN_HISTORY_DAYS = 60   # Prefer at least this many daily observations
MAX_HISTORY_DAYS = 90   # Use at most this many recent daily observations
MA_WINDOW = 7           # Moving-average window (days)

# Coefficient of variation thresholds for confidence labelling
CV_HIGH_THRESHOLD = 0.10    # Below this → stable prices
CV_MEDIUM_THRESHOLD = 0.20  # Below this → moderate volatility


@dataclass
class ForecastResult:
    """Container for a single forecast day."""

    date: pd.Timestamp
    predicted_price: float
    lower_bound: float
    upper_bound: float


@dataclass
class ForecastOutput:
    """Full forecast response for a commodity–market pair."""

    commodity: str
    market: str
    forecast_days: int
    history_days_used: int
    last_known_date: pd.Timestamp
    last_known_price: float
    forecasts: list[ForecastResult]
    confidence: str          # "High" | "Medium" | "Low"
    confidence_reason: str
    trend_direction: str     # "Upward" | "Downward" | "Stable"


# ---------------------------------------------------------------------------
# Data loading & preparation
# ---------------------------------------------------------------------------


def load_gujarat_data(csv_path: Path = DATA_PATH) -> pd.DataFrame:
    """Load the cleaned Gujarat price CSV and parse dates."""
    df = pd.read_csv(csv_path, parse_dates=["date"])
    df = df.sort_values("date").reset_index(drop=True)
    return df


def filter_commodity_market(
    df: pd.DataFrame,
    commodity: str,
    market: str,
) -> pd.DataFrame:
    """Return rows matching the given commodity and market (case-insensitive)."""
    mask = (
        df["commodity"].str.lower() == commodity.lower()
    ) & (
        df["market"].str.lower() == market.lower()
    )
    return df.loc[mask].copy()


def prepare_daily_series(
    df: pd.DataFrame,
    min_days: int = MIN_HISTORY_DAYS,
    max_days: int = MAX_HISTORY_DAYS,
) -> pd.Series:
    """
    Aggregate modal prices to one value per day (daily mean),
    then keep the most recent window of 60–90 days when available.

    Note this returns one row per day that actually *has* data, not one row
    per calendar day in range — a market that reports 3x/week will have
    gaps. `fit_linear_trend` below relies on this series' DatetimeIndex
    (rather than row position) to account for those gaps correctly.
    """
    if df.empty:
        return pd.Series(dtype=float)

    # Average multiple entries on the same day
    daily = (
        df.groupby("date")["modal_price"]
        .mean()
        .sort_index()
    )

    # Use up to max_days; require at least min_days when possible
    if len(daily) >= max_days:
        daily = daily.iloc[-max_days:]
    elif len(daily) >= min_days:
        daily = daily.iloc[-min_days:]
    # else: use whatever is available (confidence will reflect shortage)

    return daily


# ---------------------------------------------------------------------------
# Forecasting helpers
# ---------------------------------------------------------------------------


def compute_moving_average(series: pd.Series, window: int = MA_WINDOW) -> pd.Series:
    """Calculate a simple rolling mean over the price series."""
    return series.rolling(window=window, min_periods=1).mean()


def fit_linear_trend(ma_series: pd.Series) -> tuple[float, float]:
    """
    Fit y = intercept + slope * x on the moving-average series, where x is
    the actual number of elapsed calendar days since the series' first
    observation — not the row position.

    Why this matters: `prepare_daily_series` only keeps days that actually
    have data. For a market that reports irregularly (e.g. 3x/week), row N
    and row N+1 might be 1 day apart or a week apart. Fitting against row
    position (the old `np.arange(len(ma_series))` approach) silently treats
    every gap as exactly one day, so the fitted slope comes out in
    price-per-row rather than price-per-day. `generate_forecasts` then
    projects that slope forward using real `pd.Timedelta(days=...)` steps,
    so a price-per-row slope gets misapplied as a price-per-day slope and
    the forecast drifts at the wrong rate — worse the more irregular the
    reporting, and with no error raised.

    Returns (slope, last_ma_value) where slope is the price change per
    calendar day.
    """
    if not isinstance(ma_series.index, pd.DatetimeIndex):
        raise TypeError(
            "fit_linear_trend requires ma_series to be indexed by date "
            "(got index type %r) so the trend can be fit against real "
            "elapsed days rather than row position." % type(ma_series.index).__name__
        )

    elapsed_days = (ma_series.index - ma_series.index[0]).days
    x = np.asarray(elapsed_days, dtype=float)
    y = ma_series.values
    slope, intercept = np.polyfit(x, y, 1)
    last_ma = float(ma_series.iloc[-1])
    return float(slope), last_ma


def generate_forecasts(
    last_date: pd.Timestamp,
    last_ma: float,
    slope: float,
    forecast_days: int,
    price_std: float,
    confidence: str,
) -> list[ForecastResult]:
    """
    Project prices forward using: forecast = last_MA + slope * day_offset.

    `slope` must already be denominated in price-per-calendar-day (see
    `fit_linear_trend`) since `day_offset` here is real calendar days via
    `pd.Timedelta`.

    Uncertainty band width scales with recent volatility and confidence level.
    """
    # Wider bands when confidence is lower
    band_multiplier = {"High": 1.0, "Medium": 1.5, "Low": 2.0}.get(confidence, 2.0)
    half_band = price_std * band_multiplier

    results: list[ForecastResult] = []
    for day in range(1, forecast_days + 1):
        predicted = last_ma + slope * day
        forecast_date = last_date + pd.Timedelta(days=day)
        results.append(
            ForecastResult(
                date=forecast_date,
                predicted_price=round(predicted, 2),
                lower_bound=round(max(predicted - half_band, 0), 2),
                upper_bound=round(predicted + half_band, 2),
            )
        )
    return results


# ---------------------------------------------------------------------------
# Confidence assessment
# ---------------------------------------------------------------------------


def assess_confidence(daily: pd.Series) -> tuple[str, str]:
    """
    Rule-based confidence from data quantity and recent volatility.

    Uses coefficient of variation (CV = std / mean):
      - High   → enough history AND low volatility
      - Medium → moderate volatility OR limited history
      - Low    → high volatility OR very little data
    """
    n_days = len(daily)

    if n_days < 30:
        return (
            "Low",
            f"Only {n_days} days of data available (need ≥30 for reliable forecast).",
        )

    cv = daily.std() / daily.mean() if daily.mean() > 0 else float("inf")

    if n_days >= MIN_HISTORY_DAYS and cv < CV_HIGH_THRESHOLD:
        return (
            "High",
            f"{n_days} days of history with low price volatility (CV={cv:.1%}).",
        )

    if n_days >= 30 and cv < CV_MEDIUM_THRESHOLD:
        return (
            "Medium",
            f"{n_days} days of history with moderate volatility (CV={cv:.1%}).",
        )

    return (
        "Low",
        f"High price volatility (CV={cv:.1%}) makes short-term prediction uncertain.",
    )


def describe_trend(slope: float, last_ma: float) -> str:
    """Convert daily slope into a human-readable trend label."""
    pct_change = (slope / last_ma) * 100 if last_ma > 0 else 0
    if abs(pct_change) < 0.3:
        return "Stable"
    return "Upward" if slope > 0 else "Downward"


# ---------------------------------------------------------------------------
# Main forecast function
# ---------------------------------------------------------------------------


def forecast_prices(
    commodity: str,
    market: str,
    forecast_days: int = 5,
    df: pd.DataFrame | None = None,
) -> ForecastOutput | None:
    """
    Forecast modal prices for the next `forecast_days` for a commodity–market pair.

    Parameters
    ----------
    commodity : str
        Commodity name as it appears in the dataset (e.g. "Groundnut").
    market : str
        Market name as it appears in the dataset (e.g. "Rajkot").
    forecast_days : int
        Number of days to forecast ahead (default 5).
    df : pd.DataFrame, optional
        Pre-loaded data; loads from disk if not provided.

    Returns
    -------
    ForecastOutput or None if no matching data found.
    """
    if df is None:
        df = load_gujarat_data()

    # Step 1 – filter and sort
    subset = filter_commodity_market(df, commodity, market)
    if subset.empty:
        print(f"No data found for commodity='{commodity}', market='{market}'.")
        return None

    subset = subset.sort_values("date")

    # Step 2 – build recent daily price window (60–90 days)
    daily = prepare_daily_series(subset)
    if len(daily) < 2:
        print("Not enough price history to generate a forecast.")
        return None

    # Step 3 – moving average + linear trend
    ma = compute_moving_average(daily)
    slope, last_ma = fit_linear_trend(ma)
    price_std = float(daily.std())

    # Step 4 – confidence
    confidence, confidence_reason = assess_confidence(daily)

    # Step 5 – generate day-by-day forecasts
    last_date = daily.index[-1]
    forecasts = generate_forecasts(
        last_date=last_date,
        last_ma=last_ma,
        slope=slope,
        forecast_days=forecast_days,
        price_std=price_std,
        confidence=confidence,
    )

    return ForecastOutput(
        commodity=commodity,
        market=market,
        forecast_days=forecast_days,
        history_days_used=len(daily),
        last_known_date=last_date,
        last_known_price=round(float(daily.iloc[-1]), 2),
        forecasts=forecasts,
        confidence=confidence,
        confidence_reason=confidence_reason,
        trend_direction=describe_trend(slope, last_ma),
    )


# ---------------------------------------------------------------------------
# Pretty printing
# ---------------------------------------------------------------------------


def print_forecast(result: ForecastOutput) -> None:
    """Print forecast results in a clean, readable format."""
    print("\n" + "=" * 65)
    print("  KRISHINITI - Short-Term Price Forecast")
    print("=" * 65)
    print(f"  Commodity      : {result.commodity}")
    print(f"  Market         : {result.market}")
    print(f"  History used   : {result.history_days_used} days")
    print(f"  Last known date: {result.last_known_date.strftime('%d %b %Y')}")
    print(f"  Last price     : Rs.{result.last_known_price:,.2f} / quintal")
    print(f"  Trend          : {result.trend_direction}")
    print(f"  Confidence     : {result.confidence}")
    print(f"  Reason         : {result.confidence_reason}")
    print("-" * 65)
    print(f"  {'Date':<14} {'Predicted':>12} {'Range (Rs.)':>22}")
    print("-" * 65)

    for fc in result.forecasts:
        date_str = fc.date.strftime("%d %b %Y")
        range_str = f"{fc.lower_bound:,.0f} - {fc.upper_bound:,.0f}"
        print(f"  {date_str:<14} Rs.{fc.predicted_price:>9,.2f}   {range_str:>22}")

    print("=" * 65 + "\n")


# ---------------------------------------------------------------------------
# Example run
# ---------------------------------------------------------------------------


def main() -> None:
    """Load data and run an example forecast."""
    print("Loading Gujarat price data...")
    df = load_gujarat_data()
    print(f"  Loaded {len(df):,} records across {df['commodity'].nunique()} commodities.")

    # Groundnut + Rajkot has the richest history in the dataset (714 records)
    example_commodity = "Groundnut"
    example_market = "Rajkot"
    example_days = 5

    print(f"\nRunning example forecast: {example_commodity} @ {example_market}")
    result = forecast_prices(
        commodity=example_commodity,
        market=example_market,
        forecast_days=example_days,
        df=df,
    )

    if result:
        print_forecast(result)


if __name__ == "__main__":
    main()