from dataclasses import dataclass, field
from typing import List, Optional

@dataclass
class Lot:
    crop: str
    amount: float  # in kg
    is_certified: bool = False
    cash_need: float = 0.0  # ₹ target
    deadline_days: int = 0  # 0 means full distress sale today
    storage_access: bool = True
    risk_tolerance: float = 0.5  # lambda (higher = more risk averse)
    blacklist: List[str] = field(default_factory=list)
    floor_price: float = 0.0  # minimum acceptable price
    single_buyer_only: bool = False # Must sell to exactly one buyer

    def __post_init__(self):
        if self.amount < 0:
            raise ValueError(f"Lot amount cannot be negative: {self.amount}")
        if self.cash_need < 0:
            raise ValueError(f"Cash need cannot be negative: {self.cash_need}")
        if self.deadline_days < 0:
            raise ValueError(f"Deadline days cannot be negative: {self.deadline_days}")
        if self.floor_price < 0:
            raise ValueError(f"Floor price cannot be negative: {self.floor_price}")

@dataclass
class Buyer:
    name: str
    price: float
    transport_rate: float = 0.0
    distance: float = 0.0
    capacity: float = float('inf')
    min_volume: float = 0.0 # Minimum volume they are willing to buy
    requires_certification: bool = False

    def __post_init__(self):
        if self.price < 0:
            raise ValueError(f"Buyer price cannot be negative: {self.price}")
        if self.capacity < 0:
            raise ValueError(f"Buyer capacity cannot be negative: {self.capacity}")

@dataclass
class MarketPrediction:
    volatility: float  # risk score/penalty
    storage_cost_per_day: float
    expected_future_price: float = 0.0 # Fallback; prefer price_by_day
    price_by_day: List[float] = field(default_factory=list) # e.g. [price_day1, price_day2, ...]

@dataclass
class Action:
    action_type: str  # "SELL", "STORE", or "AGGREGATE"
    buyer_name: Optional[str] = None
    amount: float = 0.0
    expected_realization: float = 0.0
    score: float = 0.0
    days: int = 0
