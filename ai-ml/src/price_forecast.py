"""
KRISHINITI - Short-Term Mandi Price Forecasting

Prototype forecasting module for SIH 2026.

Method:
    1. Filter commodity + market
    2. Aggregate prices by day
    3. Use recent observations
    4. Smooth prices with a moving average
    5. Fit a linear trend
    6. Forecast the next N days
    7. Estimate confidence from history + volatility
    8. Generate a simple uncertainty range

This is an explainable statistical baseline, not a black-box ML model.
"""

from pathlib import Path

import numpy as np
import pandas as pd


# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parents[2]

DATA_PATH = (
    BASE_DIR
    / "data"
    / "processed"
    / "gujarat_prices_clean.csv"
)

MA_WINDOW = 7
HISTORY_OBSERVATIONS = 60
FORECAST_DAYS = 5

MIN_OBSERVATIONS = 14

# Confidence thresholds
LOW_VOLATILITY_CV = 0.08
HIGH_VOLATILITY_CV = 0.15


# ============================================================
# DATA
# ============================================================

def load_data(path: Path = DATA_PATH) -> pd.DataFrame:
    """Load cleaned Gujarat mandi price data."""

    df = pd.read_csv(path)

    required = {
        "date",
        "commodity",
        "market",
        "modal_price",
    }

    missing = required - set(df.columns)

    if missing:
        raise ValueError(
            f"Missing required columns: {sorted(missing)}"
        )

    df["date"] = pd.to_datetime(
        df["date"],
        errors="coerce"
    )

    df["modal_price"] = pd.to_numeric(
        df["modal_price"],
        errors="coerce"
    )

    df = df.dropna(
        subset=[
            "date",
            "commodity",
            "market",
            "modal_price",
        ]
    )

    df = df[df["modal_price"] > 0]

    return df


# ============================================================
# PREPARE PRICE SERIES
# ============================================================

def get_price_series(
    df: pd.DataFrame,
    commodity: str,
    market: str,
) -> pd.Series:
    """
    Get daily modal price series for one commodity-market pair.
    """

    mask = (
        df["commodity"].astype(str).str.strip().str.lower()
        == commodity.strip().lower()
    ) & (
        df["market"].astype(str).str.strip().str.lower()
        == market.strip().lower()
    )

    data = df.loc[mask].copy()

    if data.empty:
        raise ValueError(
            f"No data found for {commodity} at {market}."
        )

    # If multiple records exist on the same day,
    # use the daily mean modal price.
    daily = (
        data.groupby("date")["modal_price"]
        .mean()
        .sort_index()
    )

    # Keep only the most recent observations.
    daily = daily.tail(HISTORY_OBSERVATIONS)

    return daily


# ============================================================
# MOVING AVERAGE
# ============================================================

def moving_average(
    prices: pd.Series,
    window: int = MA_WINDOW,
) -> pd.Series:
    """Calculate trailing moving average."""

    return prices.rolling(
        window=window,
        min_periods=1,
    ).mean()


# ============================================================
# TREND
# ============================================================

def calculate_trend(
    smoothed: pd.Series,
) -> tuple[float, str]:
    """
    Calculate price trend using linear regression.

    Returns:
        slope per calendar day
        trend direction
    """

    if len(smoothed) < 2:
        return 0.0, "Stable"

    days = (
        smoothed.index - smoothed.index[0]
    ).days.astype(float)

    prices = smoothed.to_numpy(dtype=float)

    slope, _ = np.polyfit(
        days,
        prices,
        1,
    )

    last_price = float(smoothed.iloc[-1])

    if last_price <= 0:
        return float(slope), "Stable"

    daily_change_percent = (
        slope / last_price
    ) * 100

    if abs(daily_change_percent) < 0.3:
        direction = "Stable"
    elif slope > 0:
        direction = "Upward"
    else:
        direction = "Downward"

    return float(slope), direction


# ============================================================
# CONFIDENCE
# ============================================================

def calculate_confidence(
    prices: pd.Series,
) -> tuple[str, str, float]:
    """
    Estimate forecast confidence.

    Confidence is based on:
        - amount of historical data
        - recent price volatility

    Returns:
        confidence level
        explanation
        coefficient of variation
    """

    observations = len(prices)

    mean_price = prices.mean()

    if mean_price <= 0:
        return (
            "Low",
            "Invalid average price.",
            float("inf"),
        )

    cv = prices.std() / mean_price

    # Very little historical data
    if observations < MIN_OBSERVATIONS:
        return (
            "Low",
            f"Only {observations} observations available.",
            cv,
        )

    # Stable prices + enough data
    if (
        observations >= 30
        and cv < LOW_VOLATILITY_CV
    ):
        return (
            "High",
            "Sufficient history with relatively stable prices.",
            cv,
        )

    # Moderate conditions
    if cv < HIGH_VOLATILITY_CV:
        return (
            "Medium",
            "Moderate price variation in recent history.",
            cv,
        )

    # Highly variable prices
    return (
        "Low",
        "High recent price volatility makes forecasting uncertain.",
        cv,
    )


# ============================================================
# FORECAST
# ============================================================

def generate_forecast(
    prices: pd.Series,
    slope: float,
    confidence: str,
    forecast_days: int,
) -> pd.DataFrame:
    """
    Generate future price predictions.

    The uncertainty band is based on recent price variation.
    """

    smoothed = moving_average(prices)

    last_date = prices.index[-1]
    last_smoothed_price = float(smoothed.iloc[-1])

    # Recent price volatility.
    price_std = float(prices.std())

    # Wider interval for lower confidence.
    multiplier = {
        "High": 1.0,
        "Medium": 1.5,
        "Low": 2.0,
    }[confidence]

    uncertainty = price_std * multiplier

    rows = []

    for day in range(1, forecast_days + 1):

        predicted = (
            last_smoothed_price
            + slope * day
        )

        predicted = max(predicted, 0)

        lower = max(
            predicted - uncertainty,
            0,
        )

        upper = predicted + uncertainty

        rows.append(
            {
                "date": last_date
                + pd.Timedelta(days=day),

                "predicted_price": round(
                    predicted,
                    2,
                ),

                "lower_bound": round(
                    lower,
                    2,
                ),

                "upper_bound": round(
                    upper,
                    2,
                ),
            }
        )

    return pd.DataFrame(rows)


# ============================================================
# MAIN FORECAST FUNCTION
# ============================================================

def forecast_prices(
    df: pd.DataFrame,
    commodity: str,
    market: str,
    forecast_days: int = FORECAST_DAYS,
) -> dict:
    """
    Generate a short-term price forecast.

    This is the main function that the backend can call later.
    """

    if forecast_days < 1:
        raise ValueError(
            "forecast_days must be at least 1."
        )

    # --------------------------------------------------------
    # Look up the price history for this commodity-market pair.
    #
    # get_price_series() raises ValueError when the pair doesn't
    # exist in the data at all (e.g. a typo, or a commodity/market
    # combination that was never reported). We catch that here and
    # return a normal status dict instead of letting the exception
    # propagate - callers (API, Decision Engine) should never have
    # to wrap this in a try/except just to handle "unknown crop".
    # --------------------------------------------------------

    try:
        prices = get_price_series(
            df,
            commodity,
            market,
        )
    except ValueError:
        return {
            "status": "no_data",
            "commodity": commodity,
            "market": market,
            "message": (
                f"No price data found for "
                f"{commodity} at {market}."
            ),
        }

    if len(prices) < MIN_OBSERVATIONS:
        return {
            "status": "insufficient_data",
            "commodity": commodity,
            "market": market,
            "message": (
                f"Only {len(prices)} observations "
                f"available. At least "
                f"{MIN_OBSERVATIONS} are required."
            ),
        }

    # Smooth prices.
    smoothed = moving_average(prices)

    # Calculate trend.
    slope, trend = calculate_trend(smoothed)

    # Calculate confidence.
    confidence, confidence_reason, cv = (
        calculate_confidence(prices)
    )

    # Generate forecasts.
    forecast = generate_forecast(
        prices=prices,
        slope=slope,
        confidence=confidence,
        forecast_days=forecast_days,
    )

    return {
        "status": "success",

        "commodity": commodity,

        "market": market,

        "history_observations": len(prices),

        "last_date": prices.index[-1].strftime(
            "%Y-%m-%d"
        ),

        "last_price": round(
            float(prices.iloc[-1]),
            2,
        ),

        "trend": trend,

        "confidence": confidence,

        "confidence_reason": confidence_reason,

        "volatility_cv": round(
            float(cv),
            4,
        ),

        "forecast": forecast,
    }


# ============================================================
# DISPLAY
# ============================================================

def print_result(result: dict) -> None:
    """Display forecast in terminal."""

    print("\n" + "=" * 65)
    print("KRISHINITI - PRICE FORECAST")
    print("=" * 65)

    # "insufficient_data" and "no_data" both stop before a forecast
    # table exists, so both just print their message and return.
    if result["status"] in ("insufficient_data", "no_data"):
        print(result["message"])
        return

    print(f"Commodity       : {result['commodity']}")
    print(f"Market          : {result['market']}")
    print(
        f"History         : "
        f"{result['history_observations']} observations"
    )
    print(
        f"Last price      : "
        f"Rs {result['last_price']:,.2f}"
    )
    print(f"Trend           : {result['trend']}")
    print(f"Confidence      : {result['confidence']}")
    print(
        f"Reason          : "
        f"{result['confidence_reason']}"
    )

    print("-" * 65)

    print(
        f"{'Date':<15}"
        f"{'Forecast':>15}"
        f"{'Lower':>15}"
        f"{'Upper':>15}"
    )

    print("-" * 65)

    for _, row in result["forecast"].iterrows():

        print(
            f"{row['date'].strftime('%d %b %Y'):<15}"
            f"Rs {row['predicted_price']:>12,.2f}"
            f"Rs {row['lower_bound']:>12,.2f}"
            f"Rs {row['upper_bound']:>12,.2f}"
        )

    print("=" * 65)


# ============================================================
# TEST RUN
# ============================================================

def main():

    print("Loading Gujarat mandi data...")

    df = load_data()

    print(
        f"Loaded {len(df):,} rows."
    )

    # Example for testing.
    result = forecast_prices(
        df=df,
        commodity="Groundnut",
        market="Rajkot",
        forecast_days=5,
    )

    print_result(result)


if __name__ == "__main__":
    main()