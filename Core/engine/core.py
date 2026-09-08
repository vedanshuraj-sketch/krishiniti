from port import somefile
from . import constants
import csv
from .models import Lot, Buyer, MarketPrediction
from .optimizer import optimize


class CropLot:
    """Wrapper class that bridges the legacy sellNow() API to the new optimizer."""

    def __init__(self, crop, amount):
        self.crop = crop
        self.amount = float(amount)
        if self.amount < 0:
            raise ValueError(f"Amount cannot be negative: {amount}")

    def sellNow(self, portion=-1):
        sellAmt = self._resolve_portion(portion)
        if isinstance(sellAmt, int) and sellAmt < 0:
            return sellAmt  # error code

        somefile.updateCurrentPrices()

        file = self._get_price_file()
        if isinstance(file, int) and file < 0:
            return file  # error code

        buyers = self._load_buyers(file)

        lot_model = Lot(
            crop=self.crop,
            amount=sellAmt,
            deadline_days=0,  # force sell today
            is_certified=True
        )

        actions = optimize(lot_model, buyers)

        if not actions:
            return ('-', 0, 0, 0)

        # Sum up ALL actions (not just the first one) for correct inventory tracking
        total_sold = sum(a.amount for a in actions if a.action_type == "SELL")
        total_realization = sum(a.expected_realization for a in actions if a.action_type == "SELL")
        best_buyer = actions[0].buyer_name if actions else '-'

        self.amount -= total_sold
        return (best_buyer, total_sold, total_realization, len(actions))

    def _resolve_portion(self, portion):
        """Validate and resolve the portion argument into a sell amount."""
        if portion == -1:
            return self.amount
        elif isinstance(portion, (int, float)):
            portion = float(portion)
            if portion <= 0:
                return -106  # negative or zero portion
            if portion > self.amount:
                return -101  # exceeds available amount
            return portion
        elif isinstance(portion, str):
            if portion.endswith('%'):
                try:
                    pct = float(portion[:-1]) / 100
                except ValueError:
                    return -102
                if pct <= 0 or pct > 1.0:
                    return -106  # invalid percentage range
                return self.amount * pct
            else:
                return -103
        else:
            return -104

    def _get_price_file(self):
        """Return the CSV path for the crop, or an error code."""
        if self.crop.lower() == 'wheat':
            return constants.WHEAT_CURR_PATH
        else:
            return -105

    def _load_buyers(self, file):
        """Load buyer data from a CSV file."""
        buyers = []
        with open(file, mode='r', encoding='ascii', errors='replace') as f:
            read = csv.DictReader(f)
            for row in read:
                buyers.append(Buyer(
                    name=row['name'],
                    price=float(row['price']),
                    transport_rate=float(row['transport']),
                    distance=float(row['distance'])
                ))
        return buyers


# Backward compatibility alias
lot = CropLot

## testing
if __name__ == "__main__":
    l = CropLot("WHeAt", 6700)
    print(l.sellNow(50))