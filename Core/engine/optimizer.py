from typing import List
from .models import Lot, Buyer, MarketPrediction, Action
from .constants import UNCERTIFIED_PENALTY, PERISHABILITY_BASE, DEFAULT_STORAGE_DAYS

def calculate_transport_cost(buyer: Buyer) -> float:
    return buyer.transport_rate * buyer.distance

def generate_candidates(lot: Lot, buyers: List[Buyer]) -> List[Buyer]:
    candidates = []
    for b in buyers:
        if b.name in lot.blacklist:
            continue
        if b.price < lot.floor_price:
            continue
        if b.requires_certification and not lot.is_certified:
            continue
        if lot.amount < b.min_volume:
            continue
        candidates.append(b)
    return candidates

def _cert_multiplier(lot: Lot) -> float:
    return 1.0 if lot.is_certified else UNCERTIFIED_PENALTY

def score_sell_action(lot: Lot, buyer: Buyer, amount: float) -> Action:
    cert_mult = _cert_multiplier(lot)
    transport_cost = calculate_transport_cost(buyer)
    net_realization = (buyer.price * amount * cert_mult) - transport_cost
    
    return Action(
        action_type="SELL",
        buyer_name=buyer.name,
        amount=amount,
        expected_realization=net_realization,
        score=net_realization,
        days=0
    )

def score_store_action(lot: Lot, amount: float, prediction: MarketPrediction) -> Action:
    best_net = -float('inf')
    best_days = DEFAULT_STORAGE_DAYS
    cert_mult = _cert_multiplier(lot)
    
    if prediction.price_by_day:
        # Search the time window for the best day
        max_days = lot.deadline_days if lot.deadline_days > 0 else len(prediction.price_by_day)
        
        for i, price in enumerate(prediction.price_by_day[:max_days]):
            days = i + 1
            storage_cost = prediction.storage_cost_per_day * amount * (PERISHABILITY_BASE ** days)
            net = (price * amount * cert_mult) - storage_cost
            if net > best_net:
                best_net = net
                best_days = days
    else:
        # Respect deadline_days even in fallback mode
        if lot.deadline_days > 0:
            best_days = lot.deadline_days
        storage_cost = prediction.storage_cost_per_day * amount * (PERISHABILITY_BASE ** best_days)
        best_net = (prediction.expected_future_price * amount * cert_mult) - storage_cost

    risk_penalty = lot.risk_tolerance * prediction.volatility * amount
    score = best_net - risk_penalty
    
    return Action(
        action_type="STORE",
        buyer_name=None,
        amount=amount,
        expected_realization=best_net,
        score=score,
        days=best_days
    )

def optimize(lot: Lot, buyers: List[Buyer], prediction: MarketPrediction = None) -> List[Action]:
    candidates = generate_candidates(lot, buyers)
    
    if not candidates:
        # Check volume mismatch against ELIGIBLE buyers only (respecting blacklist/floor/cert)
        eligible_for_volume_check = [
            b for b in buyers
            if b.name not in lot.blacklist
            and b.price >= lot.floor_price
            and (not b.requires_certification or lot.is_certified)
        ]
        volume_mismatch = any(lot.amount < b.min_volume for b in eligible_for_volume_check)
        if volume_mismatch:
            return [Action(action_type="AGGREGATE", amount=lot.amount, expected_realization=0)]
        return []

    # Rank candidates by per-kg score
    def sort_key(b: Buyer):
        amt = min(lot.amount, b.capacity)
        if amt <= 0: return 0
        effective_price = b.price * _cert_multiplier(lot)
        if effective_price <= 0: return 0
        return score_sell_action(lot, b, amt).score / amt

    candidates.sort(key=sort_key, reverse=True)
    
    actions = []
    amount_left = lot.amount
    cash_raised = 0.0
    buyer_used_capacity = {b.name: 0.0 for b in candidates}

    forced_sell_all = (lot.deadline_days == 0)
    
    if lot.single_buyer_only:
        # Evaluate the best single-buyer option
        best_act = None
        
        for b in candidates:
            if forced_sell_all:
                test_amt = min(amount_left, b.capacity)
            elif lot.cash_need > 0:
                cert_mult = _cert_multiplier(lot)
                eff_price = b.price * cert_mult
                if eff_price <= 0: continue
                transport = calculate_transport_cost(b)
                required_amt = (lot.cash_need + transport) / eff_price
                test_amt = min(amount_left, b.capacity, required_amt)
            else:
                test_amt = min(amount_left, b.capacity)
                
            if test_amt <= 0: continue
            
            act = score_sell_action(lot, b, test_amt)
            if not best_act or act.score > best_act.score:
                best_act = act
        
        # Compare single-buyer sell vs store
        store_act = None
        if lot.storage_access and prediction and not forced_sell_all:
            store_act = score_store_action(lot, amount_left, prediction)
            
        if best_act and store_act:
            if store_act.score > best_act.score:
                actions.append(store_act)
            else:
                actions.append(best_act)
        elif best_act:
            actions.append(best_act)
        elif store_act:
            actions.append(store_act)
            
        return actions
            
    # Standard multi-buyer path
    if forced_sell_all or lot.cash_need > 0:
        for b in candidates:
            if amount_left <= 0:
                break
            if not forced_sell_all and cash_raised >= lot.cash_need:
                break
                
            rem_capacity = b.capacity - buyer_used_capacity[b.name]
            sell_amt = min(amount_left, rem_capacity)
            
            if not forced_sell_all:
                cert_mult = _cert_multiplier(lot)
                eff_price = b.price * cert_mult
                if eff_price <= 0: continue
                transport = calculate_transport_cost(b)
                needed_cash = lot.cash_need - cash_raised
                required_amt = (needed_cash + transport) / eff_price
                if required_amt < sell_amt:
                    sell_amt = required_amt
                    
            if sell_amt > 0:
                act = score_sell_action(lot, b, sell_amt)
                if act.expected_realization > 0 or forced_sell_all:
                    actions.append(act)
                    cash_raised += act.expected_realization
                    amount_left -= sell_amt
                    buyer_used_capacity[b.name] += sell_amt

    # Evaluate what to do with the remaining amount (Store vs Sell)
    if amount_left > 0:
        store_act = None
        if lot.storage_access and prediction:
            store_act = score_store_action(lot, amount_left, prediction)
            
        sell_rest_actions = []
        sell_rest_score = 0
        temp_amount = amount_left
        
        for b in candidates:
            if temp_amount <= 0:
                break
            rem_capacity = b.capacity - buyer_used_capacity.get(b.name, 0)
            if rem_capacity <= 0:
                continue
                
            sell_amt = min(temp_amount, rem_capacity)
            act = score_sell_action(lot, b, sell_amt)
            
            if act.score > 0:
                sell_rest_actions.append(act)
                sell_rest_score += act.score
                temp_amount -= sell_amt
                
        # Compare Store vs Sell Rest
        if store_act and store_act.score > sell_rest_score:
            actions.append(store_act)
        else:
            actions.extend(sell_rest_actions)

    return actions
