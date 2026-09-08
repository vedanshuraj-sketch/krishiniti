/**
 * Decision Engine
 * Consumes the AI/ML API's /summary response and produces a
 * sell / wait / split recommendation, a Net Realisation estimate,
 * and a What-If simulation. Pure business logic — no I/O, no HTTP.
 *
 * Expected shape of `summary` (from AI/ML API's GET /summary):
 * {
 *   commodity, market,
 *   forecast: { current_price, predicted_price, trend },
 *   confidence: "High" | "Medium" | "Low",
 *   risk_score: number (0-1 or 0-100, confirm with AI/ML Engineer),
 *   anomaly_detected: boolean,
 *   overall_explanation: string
 * }
 */

function decide(summary, quantity) {
  const { forecast, confidence, risk_score, anomaly_detected } = summary;
  const { current_price, predicted_price, trend } = forecast;

  const priceChangePercent = ((predicted_price - current_price) / current_price) * 100;

  let decision;
  let reason;

  if (anomaly_detected) {
    // Anomalies mean the price data itself looks unreliable right now —
    // default to caution regardless of what the trend says.
    decision = 'wait';
    reason = 'An anomaly was detected in recent price data, so waiting for a clearer signal is safer.';
  } else if (confidence === 'Low') {
    decision = 'wait';
    reason = 'Forecast confidence is low; recommend waiting for a more reliable signal.';
  } else if (priceChangePercent >= 5 && confidence !== 'Low') {
    decision = 'wait';
    reason = `Prices are trending up (${priceChangePercent.toFixed(1)}% expected increase) with ${confidence} confidence.`;
  } else if (priceChangePercent <= -5) {
    decision = 'sell';
    reason = `Prices are trending down (${priceChangePercent.toFixed(1)}% expected decrease); selling now avoids further loss.`;
  } else if (Math.abs(priceChangePercent) < 5 && confidence === 'Medium') {
    decision = 'split';
    reason = 'Price movement is uncertain; splitting the sale hedges against both outcomes.';
  } else {
    decision = 'sell';
    reason = 'Price is expected to stay roughly stable; no clear benefit to waiting.';
  }

  const netRealisation = calculateNetRealisation(current_price, quantity);

  return {
    decision,
    reason,
    net_realisation: netRealisation,
    price_change_percent: Number(priceChangePercent.toFixed(2)),
  };
}

function calculateNetRealisation(pricePerUnit, quantity, deductionRate = 0.02) {
  // deductionRate covers mandi fees / commission — adjust with real figures if available
  const gross = pricePerUnit * quantity;
  const deductions = gross * deductionRate;
  return Number((gross - deductions).toFixed(2));
}

// What-If Simulator: "what if I wait N more days"
// Applies the forecast's trend as a naive linear projection.
function whatIf(summary, quantity, extraDays) {
  const { forecast } = summary;
  const { current_price, predicted_price } = forecast;

  // AI/ML API's predicted_price is presumably for its own forecast window (e.g. 7 days).
  // This assumes a linear trend to project further — flag to the team that this is a
  // simplification and should be revisited if the AI/ML API exposes a day-by-day forecast.
  const dailyChange = (predicted_price - current_price) / 7;
  const projectedPrice = current_price + dailyChange * extraDays;

  return {
    extra_days: extraDays,
    projected_price: Number(projectedPrice.toFixed(2)),
    projected_net_realisation: calculateNetRealisation(projectedPrice, quantity),
  };
}

module.exports = { decide, calculateNetRealisation, whatIf };
