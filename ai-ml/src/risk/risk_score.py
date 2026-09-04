"""
KRISHINITI - Risk Score

Estimates the risk of waiting to sell based on:
- Recent price volatility
- Recent price trend
- Availability of historical data

Risk Score:
    0-33   -> Low
    34-66  -> Medium
    67-100 -> High

All calculations use past/current observations only.
"""

from pathlib import Path

import numpy as np
import pandas as pd


# ============================================================
# CONFIG
# ============================================================

WINDOW = 7
MIN_OBSERVATIONS = 5

VOLATILITY_WEIGHT = 0.45
TREND_WEIGHT = 0.35
DATA_WEIGHT = 0.20

LOW_THRESHOLD = 33
HIGH_THRESHOLD = 66

VOLATILITY_REFERENCE = 0.05
TREND_REFERENCE = 0.15


# ============================================================
# PATHS
# ============================================================

ROOT = Path(__file__).resolve().parents[2]

INPUT_FILE = ROOT / "data" / "processed" / "gujarat_prices_clean.csv"
OUTPUT_FILE = ROOT / "data" / "processed" / "gujarat_risk_scores.csv"


# ============================================================
# LOAD DATA
# ============================================================

def load_data():
    """Load cleaned Gujarat mandi price data."""

    if not INPUT_FILE.exists():
        raise FileNotFoundError(
            f"Input file not found:\n{INPUT_FILE}"
        )

    df = pd.read_csv(INPUT_FILE)

    required = ["date", "market", "commodity", "modal_price"]

    missing = [col for col in required if col not in df.columns]

    if missing:
        raise ValueError(
            f"Missing columns: {missing}"
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
        subset=["date", "market", "commodity", "modal_price"]
    )

    df = df[df["modal_price"] > 0]

    # One price per commodity-market-date.
    df = (
        df.groupby(
            ["commodity", "market", "date"],
            as_index=False
        )["modal_price"]
        .mean()
    )

    return df.sort_values(
        ["commodity", "market", "date"]
    ).reset_index(drop=True)


# ============================================================
# RISK CALCULATION
# ============================================================

def calculate_risk(group):
    """
    Calculate risk for one commodity-market pair.

    Only information available up to each date is used.
    """

    # Restore grouping columns if this pandas version stripped them
    # out of the sub-DataFrame passed into apply(). Only add them
    # back when missing, to avoid creating duplicate columns on
    # pandas versions that still keep them.
    commodity, market = group.name

    group = group.sort_values("date").copy()

    if "commodity" not in group.columns:
        group["commodity"] = commodity
    if "market" not in group.columns:
        group["market"] = market

    prices = group["modal_price"]

    # Previous-price return
    returns = prices.pct_change()

    # Recent volatility
    volatility = (
        returns
        .rolling(WINDOW, min_periods=2)
        .std()
    )

    # Price change over previous WINDOW observations
    trend = (
        prices - prices.shift(WINDOW)
    ) / prices.shift(WINDOW)

    # Number of observations available so far.
    observations = pd.Series(
        np.arange(1, len(group) + 1),
        index=group.index
    )

    # --------------------------------------------------------
    # Convert volatility to 0-100 risk
    # --------------------------------------------------------

    volatility_score = (
        volatility / VOLATILITY_REFERENCE * 100
    ).clip(0, 100)

    # --------------------------------------------------------
    # Convert trend to 0-100 waiting risk
    #
    # Falling price -> higher risk
    # Rising price  -> lower risk
    # --------------------------------------------------------

    trend_score = (
        50 - (trend / TREND_REFERENCE * 50)
    ).clip(0, 100)

    # --------------------------------------------------------
    # Data sufficiency
    # --------------------------------------------------------

    data_sufficiency = (
        observations / 20 * 100
    ).clip(0, 100)

    data_risk = 100 - data_sufficiency

    # --------------------------------------------------------
    # Final weighted risk
    # --------------------------------------------------------

    risk_score = (
        VOLATILITY_WEIGHT * volatility_score
        + TREND_WEIGHT * trend_score
        + DATA_WEIGHT * data_risk
    ).clip(0, 100)

    # --------------------------------------------------------
    # Need enough history before producing a score.
    # --------------------------------------------------------

    valid = (
        (observations >= MIN_OBSERVATIONS)
        & volatility_score.notna()
        & trend_score.notna()
    )

    risk_score = risk_score.where(valid)

    # IMPORTANT:
    # Use object dtype because values are strings.
    risk_level = pd.Series(
        pd.NA,
        index=group.index,
        dtype="string"
    )

    risk_level.loc[valid & (risk_score <= LOW_THRESHOLD)] = "Low"

    risk_level.loc[
        valid
        & (risk_score > LOW_THRESHOLD)
        & (risk_score <= HIGH_THRESHOLD)
    ] = "Medium"

    risk_level.loc[
        valid & (risk_score > HIGH_THRESHOLD)
    ] = "High"

    group["risk_score"] = risk_score.round(2)

    group["risk_level"] = risk_level

    group["volatility_score"] = volatility_score.round(2)

    group["trend_score"] = trend_score.round(2)

    group["data_sufficiency"] = data_sufficiency.round(2)

    group["observation_count"] = observations

    group["risk_status"] = np.where(
        valid,
        "ok",
        "insufficient_data"
    )

    return group


# ============================================================
# EXPLANATION
# ============================================================

def explain(row):
    """Create a simple explanation for the farmer."""

    if row["risk_status"] != "ok":
        return (
            "Insufficient historical data "
            "to reliably estimate waiting risk."
        )

    reasons = []

    if row["volatility_score"] >= 66:
        reasons.append("high price volatility")
    elif row["volatility_score"] >= 33:
        reasons.append("moderate price volatility")
    else:
        reasons.append("low price volatility")

    if row["trend_score"] >= 66:
        reasons.append("prices are trending downward")
    elif row["trend_score"] <= 33:
        reasons.append("prices are trending upward")
    else:
        reasons.append("prices are relatively stable")

    return (
        f"{row['risk_level']} Risk because "
        + " and ".join(reasons)
        + "."
    )


# ============================================================
# MAIN
# ============================================================

def main():

    print("Loading cleaned Gujarat price data...")

    df = load_data()

    print(f"Loaded {len(df):,} rows.")

    print("Computing risk scores...")

    result = (
        df.groupby(
            ["commodity", "market"],
            group_keys=False
        )
        .apply(calculate_risk)
        .reset_index(drop=True)
    )

    result["explanation"] = result.apply(
        explain,
        axis=1
    )

    # Keep useful columns only.
    result = result[
        [
            "date",
            "commodity",
            "market",
            "modal_price",
            "risk_score",
            "risk_level",
            "volatility_score",
            "trend_score",
            "data_sufficiency",
            "observation_count",
            "risk_status",
            "explanation",
        ]
    ]

    OUTPUT_FILE.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    result.to_csv(
        OUTPUT_FILE,
        index=False
    )

    # --------------------------------------------------------
    # Summary
    # --------------------------------------------------------

    valid = result[
        result["risk_status"] == "ok"
    ]

    print("\n" + "=" * 50)
    print("KRISHINITI - RISK SCORE")
    print("=" * 50)

    print(f"Total records : {len(result):,}")
    print(f"Valid scores  : {len(valid):,}")

    if not valid.empty:

        print(
            f"Average risk : "
            f"{valid['risk_score'].mean():.2f}"
        )

        print("\nRisk distribution:")

        print(
            valid["risk_level"]
            .value_counts()
        )

    print(f"\nSaved to:\n{OUTPUT_FILE}")


if __name__ == "__main__":
    main()