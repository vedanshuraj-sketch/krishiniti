"""
KRISHINITI - Anomaly Detection

Flags unusual price behaviour in the Gujarat mandi data:
- Sudden spikes / crashes (large day-over-day % change)
- Statistical outliers (rolling z-score)
- Stale prices (same price repeated many times in a row)

All calculations use past/current observations only
(no lookahead), consistent with risk_score.py.
"""

from pathlib import Path

import numpy as np
import pandas as pd


# ============================================================
# CONFIG
# ============================================================

WINDOW = 7
MIN_OBSERVATIONS = 5

# Single-day % change beyond this is flagged as a spike/crash.
PCT_CHANGE_THRESHOLD = 0.50

# Rolling z-score beyond this magnitude is flagged as an outlier.
ZSCORE_THRESHOLD = 4.0

# Same price repeated this many times in a row is flagged as stale.
STALE_STREAK_THRESHOLD = 8

# Score contribution caps (each anomaly type contributes up to
# this many points toward the final 0-100 anomaly_score).
SPIKE_SCORE_MAX = 45
OUTLIER_SCORE_MAX = 40
STALE_SCORE_MAX = 30


# ============================================================
# PATHS
# ============================================================

ROOT = Path(__file__).resolve().parents[2]

INPUT_FILE = ROOT / "data" / "processed" / "gujarat_prices_clean.csv"
OUTPUT_FILE = ROOT / "data" / "processed" / "gujarat_anomalies.csv"


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
# ANOMALY DETECTION
# ============================================================

def detect_anomalies(group):
    """
    Detect anomalies for one commodity-market pair.

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

    observations = pd.Series(
        np.arange(1, len(group) + 1),
        index=group.index
    )

    # --------------------------------------------------------
    # Spike / crash: single-day % change
    # --------------------------------------------------------

    pct_change = prices.pct_change()

    spike_flag = pct_change > PCT_CHANGE_THRESHOLD
    crash_flag = pct_change < -PCT_CHANGE_THRESHOLD

    spike_score = (
        (pct_change.abs() / PCT_CHANGE_THRESHOLD) * SPIKE_SCORE_MAX
    ).clip(0, SPIKE_SCORE_MAX)

    spike_score = spike_score.where(
        spike_flag | crash_flag,
        0
    )

    # --------------------------------------------------------
    # Statistical outlier: rolling z-score
    #
    # Uses the WINDOW observations *before* the current one, so
    # today's price never influences its own baseline.
    # --------------------------------------------------------

    rolling_mean = (
        prices.shift(1)
        .rolling(WINDOW, min_periods=3)
        .mean()
    )

    rolling_std = (
        prices.shift(1)
        .rolling(WINDOW, min_periods=3)
        .std()
    )

    zscore = (prices - rolling_mean) / rolling_std

    outlier_flag = zscore.abs() > ZSCORE_THRESHOLD

    outlier_score = (
        (zscore.abs() / ZSCORE_THRESHOLD) * OUTLIER_SCORE_MAX
    ).clip(0, OUTLIER_SCORE_MAX)

    outlier_score = outlier_score.where(outlier_flag, 0)
    outlier_score = outlier_score.fillna(0)

    # --------------------------------------------------------
    # Stale price: same price repeated N+ times in a row
    # --------------------------------------------------------

    price_changed = prices.diff().ne(0)
    # Each time the price changes, start a new streak-id.
    streak_id = price_changed.cumsum()
    streak_length = streak_id.groupby(streak_id).cumcount() + 1

    stale_flag = streak_length >= STALE_STREAK_THRESHOLD

    stale_score = (
        (streak_length / STALE_STREAK_THRESHOLD) * STALE_SCORE_MAX
    ).clip(0, STALE_SCORE_MAX)

    stale_score = stale_score.where(stale_flag, 0)

    # --------------------------------------------------------
    # Need enough history before flagging anything.
    # --------------------------------------------------------

    valid = observations >= MIN_OBSERVATIONS

    spike_flag = spike_flag & valid
    crash_flag = crash_flag & valid
    outlier_flag = outlier_flag & valid
    stale_flag = stale_flag & valid

    spike_score = spike_score.where(valid, 0)
    outlier_score = outlier_score.where(valid, 0)
    stale_score = stale_score.where(valid, 0)

    # --------------------------------------------------------
    # Combine into a single anomaly_type label + score
    # --------------------------------------------------------

    def label_row(i):
        labels = []
        if spike_flag.loc[i]:
            labels.append("price_spike")
        if crash_flag.loc[i]:
            labels.append("price_crash")
        if outlier_flag.loc[i]:
            labels.append("statistical_outlier")
        if stale_flag.loc[i]:
            labels.append("stale_price")
        return ",".join(labels) if labels else "none"

    anomaly_type = pd.Series(
        [label_row(i) for i in group.index],
        index=group.index
    )

    anomaly_score = (
        spike_score + outlier_score + stale_score
    ).clip(0, 100).round(2)

    anomaly_flag = (
        spike_flag | crash_flag | outlier_flag | stale_flag
    )

    group["pct_change"] = (pct_change * 100).round(2)
    group["zscore"] = zscore.round(2)
    group["streak_length"] = streak_length
    group["anomaly_flag"] = anomaly_flag
    group["anomaly_type"] = anomaly_type
    group["anomaly_score"] = anomaly_score
    group["observation_count"] = observations
    group["anomaly_status"] = np.where(
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

    if row["anomaly_status"] != "ok":
        return (
            "Insufficient historical data "
            "to reliably check for anomalies."
        )

    if not row["anomaly_flag"]:
        return "No unusual price behaviour detected."

    reasons = []

    if "price_spike" in row["anomaly_type"]:
        reasons.append(
            f"price jumped {row['pct_change']:.1f}% in a single day"
        )

    if "price_crash" in row["anomaly_type"]:
        reasons.append(
            f"price dropped {abs(row['pct_change']):.1f}% in a single day"
        )

    if "statistical_outlier" in row["anomaly_type"]:
        reasons.append(
            "price is far outside its recent normal range"
        )

    if "stale_price" in row["anomaly_type"]:
        reasons.append(
            f"price has not changed for {int(row['streak_length'])} "
            "consecutive reports"
        )

    return "Anomaly detected: " + "; ".join(reasons) + "."


# ============================================================
# MAIN
# ============================================================

def main():

    print("Loading cleaned Gujarat price data...")

    df = load_data()

    print(f"Loaded {len(df):,} rows.")

    print("Detecting anomalies...")

    result = (
        df.groupby(
            ["commodity", "market"],
            group_keys=False
        )
        .apply(detect_anomalies)
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
            "pct_change",
            "zscore",
            "streak_length",
            "anomaly_flag",
            "anomaly_type",
            "anomaly_score",
            "observation_count",
            "anomaly_status",
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
        result["anomaly_status"] == "ok"
    ]

    flagged = valid[valid["anomaly_flag"]]

    print("\n" + "=" * 50)
    print("KRISHINITI - ANOMALY DETECTION")
    print("=" * 50)

    print(f"Total records   : {len(result):,}")
    print(f"Checked records : {len(valid):,}")
    print(f"Anomalies found : {len(flagged):,}")

    if not flagged.empty:

        print(
            f"Average anomaly score (flagged) : "
            f"{flagged['anomaly_score'].mean():.2f}"
        )

        print("\nAnomaly type breakdown:")

        type_counts = (
            flagged["anomaly_type"]
            .str.split(",")
            .explode()
            .value_counts()
        )

        print(type_counts)

    print(f"\nSaved to:\n{OUTPUT_FILE}")


if __name__ == "__main__":
    main()