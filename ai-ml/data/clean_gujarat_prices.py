"""
Clean and filter AGMARKNET mandi price data for Gujarat.

Reads raw price data from CSV, applies cleaning steps, filters for
Gujarat, and saves the processed output for downstream ML/analysis.

Usage:
    python clean_gujarat_prices.py
"""

from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------------------
# Paths (relative to this script's location inside ai-ml/data/)
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
RAW_CSV = SCRIPT_DIR / "raw" / "agmarknet_prices_oct24_aug25.csv"
OUTPUT_CSV = SCRIPT_DIR / "processed" / "gujarat_prices_clean.csv"

# Columns to keep after cleaning
FINAL_COLUMNS = [
    "date",
    "state",
    "district",
    "market",
    "commodity",
    "modal_price",
    "min_price",
    "max_price",
]

# Mapping from raw CSV column names to standardized names
COLUMN_RENAME_MAP = {
    "sl no.": "sl_no",
    "district name": "district",
    "market name": "market",
    "commodity": "commodity",
    "variety": "variety",
    "grade": "grade",
    "min price (rs./quintal)": "min_price",
    "max price (rs./quintal)": "max_price",
    "modal price (rs./quintal)": "modal_price",
    "price date": "date",
    "state": "state",
}


def load_raw_data(csv_path: Path) -> pd.DataFrame:
    """Load the raw AGMARKNET CSV into a DataFrame."""
    print(f"Loading data from: {csv_path}")
    df = pd.read_csv(csv_path)
    print(f"  Loaded {len(df):,} rows, {len(df.columns)} columns")
    return df


def standardize_column_names(df: pd.DataFrame) -> pd.DataFrame:
    """
    Convert column names to lowercase with underscores.

    Example: 'District Name' -> 'district', 'Modal Price (Rs./Quintal)' -> 'modal_price'
    """
    df = df.copy()
    df.columns = (
        df.columns.str.strip().str.lower().str.replace(r"\s+", " ", regex=True)
    )
    df = df.rename(columns=COLUMN_RENAME_MAP)
    return df


def clean_data(df: pd.DataFrame) -> pd.DataFrame:
    """
    Apply data cleaning steps:
      - Parse dates
      - Convert price columns to numeric
      - Drop rows with missing or zero modal price
    """
    df = df.copy()

    # Parse price date (format: '05 Apr 2025')
    df["date"] = pd.to_datetime(df["date"], format="%d %b %Y", errors="coerce")

    # Convert price columns to numeric; invalid values become NaN
    price_cols = ["min_price", "max_price", "modal_price"]
    for col in price_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Remove rows where modal price is missing or zero
    before = len(df)
    df = df.dropna(subset=["date", "modal_price"])
    df = df[df["modal_price"] > 0]
    removed = before - len(df)
    print(f"  Removed {removed:,} rows (missing date or invalid/zero modal price)")

    return df


def filter_gujarat(df: pd.DataFrame) -> pd.DataFrame:
    """Keep only records where state is Gujarat."""
    df = df.copy()
    df["state"] = df["state"].str.strip()
    filtered = df[df["state"].str.lower() == "gujarat"]
    print(f"  Gujarat rows: {len(filtered):,} (from {len(df):,} total after cleaning)")
    return filtered


def select_and_sort(df: pd.DataFrame) -> pd.DataFrame:
    """Keep important columns and sort by commodity, market, date."""
    df = df[FINAL_COLUMNS].copy()
    df = df.sort_values(["commodity", "market", "date"]).reset_index(drop=True)
    return df


def save_cleaned_data(df: pd.DataFrame, output_path: Path) -> None:
    """Save cleaned DataFrame to CSV, creating parent directories if needed."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)
    print(f"\nSaved cleaned data to: {output_path}")


def print_summary(df: pd.DataFrame) -> None:
    """Print basic summary statistics about the cleaned Gujarat dataset."""
    print("\n" + "=" * 60)
    print("CLEANED DATA SUMMARY (GUJARAT)")
    print("=" * 60)

    print(f"\nTotal rows: {len(df):,}")

    if len(df) == 0:
        print("\nNo Gujarat records found in the dataset.")
        return

    print(
        f"Date range: {df['date'].min().strftime('%d %b %Y')} "
        f"to {df['date'].max().strftime('%d %b %Y')}"
    )

    print("\nTop 10 commodities:")
    top_commodities = df["commodity"].value_counts().head(10)
    for name, count in top_commodities.items():
        print(f"  {name:30s} {count:>8,}")

    print("\nTop 10 markets:")
    top_markets = df["market"].value_counts().head(10)
    for name, count in top_markets.items():
        print(f"  {name:30s} {count:>8,}")


def main() -> None:
    """Run the full cleaning pipeline."""
    # 1. Load
    df = load_raw_data(RAW_CSV)

    # 2. Clean
    print("\nCleaning data...")
    df = standardize_column_names(df)
    df = clean_data(df)

    # 3. Filter Gujarat
    print("\nFiltering for Gujarat...")
    df = filter_gujarat(df)

    # 4 & 5. Select columns and sort
    df = select_and_sort(df)

    # 6. Save
    save_cleaned_data(df, OUTPUT_CSV)

    # 7. Print summary
    print_summary(df)


if __name__ == "__main__":
    main()
