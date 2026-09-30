/**
 * Buyer Matching
 * ==============
 *
 * Deterministic, explainable scoring of seeded demo buyers against one
 * crop lot. No machine learning, no randomness: the same lot and the same
 * buyer always produce the same score, and every point is attributable to
 * a named criterion.
 *
 * Scoring (100 points total)
 * --------------------------
 *   Crop compatibility        35   hard gate - 0 means incompatible
 *   Quantity compatibility    20   min/max window
 *   Quality / evidence        20   buyer's quality_requirement vs the lot
 *   Grade compatibility       10
 *   Location / distance       10
 *   Value-channel alignment    5   buyer type appears in the crop's
 *                                  value-chain knowledge base
 *
 * A buyer is `compatible: false` when a hard gate fails (wrong crop, below
 * minimum quantity, or a certificate requirement the lot cannot meet).
 * Incompatible buyers are still returned with their reasons so the farmer
 * can see what would need to change.
 */

const valueChain = require('./valueChain');
const quality = require('./qualityAssessment');

const WEIGHTS = {
  crop: 35,
  quantity: 20,
  quality: 20,
  grade: 10,
  location: 10,
  value_channel: 5,
};

const GRADE_ORDER = { 'grade a': 3, a: 3, 'grade b': 2, b: 2, 'grade c': 1, c: 1 };

function gradeRank(grade) {
  if (!grade) return null;
  return GRADE_ORDER[String(grade).trim().toLowerCase()] ?? null;
}

function normalise(text) {
  return String(text || '').trim().toLowerCase();
}

function cropMatches(buyer, commodity) {
  const wanted = normalise(commodity);
  if (!wanted) return false;
  return (buyer.crops_accepted || []).some((c) => {
    const accepted = normalise(c);
    return (
      accepted === wanted ||
      // Tolerate AGMARKNET's parenthetical naming, e.g.
      // "Ginger(Green)" vs "Ginger", "Arhar (Tur/Red Gram)(Whole)".
      accepted.split('(')[0].trim() === wanted.split('(')[0].trim()
    );
  });
}

/**
 * Score one buyer against one lot.
 * `lotQuality` comes from qualityAssessment.describeLotQuality(lot).
 */
function scoreBuyer(lot, buyer, lotQuality, channelBuyerTypes) {
  const reasons = [];
  const blockers = [];
  let score = 0;

  const quantity = Number(lot.quantity);
  const minQty = Number(buyer.min_quantity || 0);
  const maxQty = buyer.max_quantity == null ? null : Number(buyer.max_quantity);

  // ── Crop (hard gate) ──────────────────────────────────────────
  const cropOk = cropMatches(buyer, lot.commodity);
  if (cropOk) {
    score += WEIGHTS.crop;
    reasons.push({
      criterion: 'Crop',
      points: WEIGHTS.crop,
      max_points: WEIGHTS.crop,
      detail: `Buys ${lot.commodity}.`,
    });
  } else {
    blockers.push({
      criterion: 'Crop',
      detail: `Does not buy ${lot.commodity}. Accepts: ${(buyer.crops_accepted || []).join(', ')}.`,
    });
  }

  // ── Quantity ──────────────────────────────────────────────────
  let quantityOk = true;
  if (quantity < minQty) {
    quantityOk = false;
    blockers.push({
      criterion: 'Quantity',
      detail:
        `Minimum order is ${minQty} ${lot.unit || 'quintal'}; this lot is ` +
        `${quantity}. Aggregating with other farmers would close the gap.`,
    });
  } else if (maxQty != null && quantity > maxQty) {
    // Not a blocker: they can take a partial load.
    score += WEIGHTS.quantity / 2;
    reasons.push({
      criterion: 'Quantity',
      points: WEIGHTS.quantity / 2,
      max_points: WEIGHTS.quantity,
      detail: `Can take up to ${maxQty} ${lot.unit || 'quintal'} of your ${quantity}; the rest needs another channel.`,
    });
  } else {
    score += WEIGHTS.quantity;
    reasons.push({
      criterion: 'Quantity',
      points: WEIGHTS.quantity,
      max_points: WEIGHTS.quantity,
      detail: `${quantity} ${lot.unit || 'quintal'} fits their ${minQty}–${maxQty ?? 'unlimited'} window.`,
    });
  }

  // ── Quality evidence ──────────────────────────────────────────
  const qualityCheck = quality.checkQualityCompatibility(
    lotQuality,
    buyer.quality_requirement
  );
  const qualityPoints = WEIGHTS.quality * qualityCheck.score_fraction;
  score += qualityPoints;

  if (qualityCheck.compatible) {
    reasons.push({
      criterion: 'Quality evidence',
      points: Math.round(qualityPoints * 10) / 10,
      max_points: WEIGHTS.quality,
      detail: qualityCheck.reason,
      conditional: qualityCheck.conditional,
    });
  } else {
    blockers.push({ criterion: 'Quality evidence', detail: qualityCheck.reason });
  }

  // ── Grade ─────────────────────────────────────────────────────
  const requiredGrade = gradeRank(buyer.grade_requirement);
  const declaredGrade = gradeRank(lot.grade);
  if (!buyer.grade_requirement) {
    score += WEIGHTS.grade;
    reasons.push({
      criterion: 'Grade',
      points: WEIGHTS.grade,
      max_points: WEIGHTS.grade,
      detail: 'Accepts any grade.',
    });
  } else if (declaredGrade == null) {
    score += WEIGHTS.grade / 2;
    reasons.push({
      criterion: 'Grade',
      points: WEIGHTS.grade / 2,
      max_points: WEIGHTS.grade,
      detail: `Wants ${buyer.grade_requirement}; your lot has no grade recorded, so this is unconfirmed.`,
    });
  } else if (declaredGrade >= requiredGrade) {
    score += WEIGHTS.grade;
    reasons.push({
      criterion: 'Grade',
      points: WEIGHTS.grade,
      max_points: WEIGHTS.grade,
      detail: `Your declared ${lot.grade} meets their ${buyer.grade_requirement} requirement.`,
    });
  } else {
    reasons.push({
      criterion: 'Grade',
      points: 0,
      max_points: WEIGHTS.grade,
      detail: `Wants ${buyer.grade_requirement}; your lot is declared ${lot.grade}.`,
    });
  }

  // ── Location ──────────────────────────────────────────────────
  const sameMarket = normalise(buyer.market) === normalise(lot.market);
  const distance = buyer.distance_km == null ? null : Number(buyer.distance_km);
  if (sameMarket) {
    score += WEIGHTS.location;
    reasons.push({
      criterion: 'Location',
      points: WEIGHTS.location,
      max_points: WEIGHTS.location,
      detail: `Based in your market (${buyer.market}).`,
    });
  } else if (distance != null) {
    // Full marks under 25 km, tapering to zero at 200 km.
    const points = Math.max(0, WEIGHTS.location * (1 - Math.max(0, distance - 25) / 175));
    score += points;
    reasons.push({
      criterion: 'Location',
      points: Math.round(points * 10) / 10,
      max_points: WEIGHTS.location,
      detail: `${buyer.market}, about ${distance} km away.`,
    });
  }

  // ── Value channel ─────────────────────────────────────────────
  if (channelBuyerTypes.length && channelBuyerTypes.includes(buyer.buyer_type)) {
    score += WEIGHTS.value_channel;
    reasons.push({
      criterion: 'Value channel',
      points: WEIGHTS.value_channel,
      max_points: WEIGHTS.value_channel,
      detail:
        `The value-chain knowledge base lists ${buyer.buyer_type} as a channel ` +
        `for ${lot.commodity}.`,
    });
  }

  const compatible = cropOk && quantityOk && qualityCheck.compatible;

  return {
    buyer: {
      id: buyer.id,
      name: buyer.name,
      buyer_type: buyer.buyer_type,
      intended_use: buyer.intended_use,
      industry: buyer.industry,
      market: buyer.market,
      distance_km: distance,
      offered_price: buyer.offered_price == null ? null : Number(buyer.offered_price),
      unit: buyer.unit || 'quintal',
      min_quantity: minQty,
      max_quantity: maxQty,
      grade_requirement: buyer.grade_requirement,
      quality_requirement: quality.normaliseRequirement(buyer.quality_requirement),
      requires_certification: Boolean(buyer.requires_certification),
      commission_rate: buyer.commission_rate == null ? null : Number(buyer.commission_rate),
      transport_cost: Number(buyer.transport_cost || 0),
      is_available: buyer.is_available !== false,
      is_demo: true,
      notes: buyer.notes,
    },
    match_score: Math.round(Math.min(100, score) * 10) / 10,
    compatible,
    conditional: qualityCheck.conditional,
    match_reasons: reasons,
    incompatibility_reasons: blockers,
    quality_compatibility: qualityCheck,
    data_label: 'Demo buyer data for prototype.',
  };
}

/**
 * Rank all buyers for a lot. Compatible buyers first, then by score.
 */
function matchBuyers(lot, buyers) {
  const lotQuality = quality.describeLotQuality(lot);
  const channelBuyerTypes = valueChain.buyerTypesFor(lot.commodity);

  const matches = (buyers || [])
    .map((buyer) => scoreBuyer(lot, buyer, lotQuality, channelBuyerTypes))
    .sort((a, b) => {
      if (a.compatible !== b.compatible) return a.compatible ? -1 : 1;
      return b.match_score - a.match_score;
    });

  return {
    lot_quality: lotQuality,
    value_channel_buyer_types: channelBuyerTypes,
    value_channel_label: valueChain.LABEL,
    data_label: 'Demo buyer data for prototype.',
    scoring_weights: WEIGHTS,
    matches,
    compatible_count: matches.filter((m) => m.compatible).length,
    total_count: matches.length,
  };
}

module.exports = { WEIGHTS, matchBuyers, scoreBuyer, cropMatches };
