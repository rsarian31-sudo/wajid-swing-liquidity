const CANONICAL_API = "https://wajid-ai-signals.vercel.app/api/liquidity-cached";
const ATR_LENGTH = 14;
const SL_ATR_BUFFER = 0.35;
const GOLD_MAX_SL_DISTANCE = 10.0;
const CRYPTO_MAX_SL_ATR = 3.0;

// Canonical lifecycle: TP2 = WIN (+2R), SL before TP2 = LOSS (-1R), TP1 milestone only.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).json({ success: true });
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });

  const interval = String(req.query?.interval || "15min").toLowerCase() === "5min" ? "5min" : "15min";
  const symbol = String(req.query?.symbol || "XAU/USD");
  const url = `${CANONICAL_API}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=500`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data?.success) throw new Error(data?.error || "Canonical Swing Liquidity API error");

    const candles = Array.isArray(data.candles) ? data.candles : [];
    const swings = data.swings || { highs: [], lows: [] };
    const trades = buildHistory(candles, swings, symbol);
    const closed = trades.filter(t => t.status === "CLOSED");
    const wins = closed.filter(t => t.result === "WIN");
    const losses = closed.filter(t => t.result === "LOSS");
    const open = trades.filter(t => t.status === "OPEN");
    const totalR = closed.reduce((sum, t) => sum + Number(t.realizedR || 0), 0);

    return res.status(200).json({
      success: true, symbol, interval,
      summary: {
        totalTrades: trades.length, closedTrades: closed.length,
        wins: wins.length, losses: losses.length, open: open.length,
        winRate: closed.length ? Number((wins.length / closed.length * 100).toFixed(1)) : 0,
        totalR: Number(totalR.toFixed(2)),
        averageR: closed.length ? Number((totalR / closed.length).toFixed(2)) : 0
      },
      trades: trades.slice().reverse()
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || "History error" });
  }
}

function atrAt(candles, index, length = ATR_LENGTH) {
  const start = Math.max(0, index - length + 1);
  const tr = [];
  for (let i = start; i <= index; i++) {
    const c = candles[i], p = candles[i - 1];
    if (!c) continue;
    tr.push(p ? Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)) : c.high - c.low);
  }
  return tr.length ? tr.reduce((a, b) => a + b, 0) / tr.length : 0;
}

function buildTradePlan(candles, swing, entryIndex, symbol) {
  const entryCandle = candles[entryIndex];
  const swingPrice = Number(swing.price), entry = Number(entryCandle?.open), atr = atrAt(candles, entryIndex);
  if (!Number.isFinite(entry) || !Number.isFinite(swingPrice) || !atr) return null;
  const isBuy = swing.type === "SWING_LOW", isSell = swing.type === "SWING_HIGH";
  if (!isBuy && !isSell) return null;

  const stopLoss = isBuy ? Math.min(swingPrice, entry - atr * SL_ATR_BUFFER) : Math.max(swingPrice, entry + atr * SL_ATR_BUFFER);
  if (isBuy ? !(stopLoss < entry) : !(stopLoss > entry)) return null;

  const slDistance = Math.abs(entry - stopLoss);
  const isGold = symbol.toUpperCase() === "XAU/USD";
  if (isGold ? slDistance > GOLD_MAX_SL_DISTANCE : slDistance > atr * CRYPTO_MAX_SL_ATR) return null;

  const risk = Math.max(slDistance, atr * 0.25);
  return isBuy
    ? { direction: "BUY", entry, stopLoss, tp1: entry + risk, tp2: entry + risk * 2, tp3: entry + risk * 3, risk, atr }
    : { direction: "SELL", entry, stopLoss, tp1: entry - risk, tp2: entry - risk * 2, tp3: entry - risk * 3, risk, atr };
}

function resolveTrade(candles, entryIndex, plan) {
  for (let i = entryIndex; i < candles.length; i++) {
    const c = candles[i];
    if (!c) continue;
    const hitSL = plan.direction === "BUY" ? c.low <= plan.stopLoss : c.high >= plan.stopLoss;
    const hitTP2 = plan.direction === "BUY" ? c.high >= plan.tp2 : c.low <= plan.tp2;
    if (hitSL && hitTP2) return { status: "CLOSED", result: "LOSS", realizedR: -1, exit: plan.stopLoss, exitTime: c.time, barIndex: i, reason: "SL and TP2 touched in same candle; conservative SL" };
    if (hitSL) return { status: "CLOSED", result: "LOSS", realizedR: -1, exit: plan.stopLoss, exitTime: c.time, barIndex: i, reason: "SL hit before TP2" };
    if (hitTP2) return { status: "CLOSED", result: "WIN", realizedR: 2, exit: plan.tp2, exitTime: c.time, barIndex: i, reason: "TP2 hit" };
  }
  return { status: "OPEN", result: "OPEN", realizedR: 0, exit: null, exitTime: null, barIndex: null, reason: "TP2 and SL not reached in available history" };
}

function buildHistory(candles, swings, symbol) {
  const levels = [...(Array.isArray(swings.highs) ? swings.highs : []), ...(Array.isArray(swings.lows) ? swings.lows : [])]
    .filter(s => s && (s.type === "SWING_HIGH" || s.type === "SWING_LOW"))
    .map(s => ({ ...s, index: Number(s.index), price: Number(s.price) }))
    .filter(s => Number.isInteger(s.index) && Number.isFinite(s.price))
    .sort((a, b) => a.index - b.index);

  const trades = [], usedSwing = new Set();
  let nextAvailableIndex = 0;
  for (const swing of levels) {
    const entryIndex = swing.index + 1;
    if (entryIndex < nextAvailableIndex || entryIndex >= candles.length) continue;
    const swingKey = `${swing.type}:${swing.index}:${swing.price.toFixed(4)}`;
    if (usedSwing.has(swingKey)) continue;
    const plan = buildTradePlan(candles, swing, entryIndex, symbol);
    if (!plan) continue;

    const outcome = resolveTrade(candles, entryIndex, plan);
    usedSwing.add(swingKey);
    trades.push({
      id: `${candles[entryIndex].time}-${plan.direction}`,
      direction: plan.direction, signalTime: candles[entryIndex].time,
      swingTime: candles[swing.index]?.time || null, swingType: swing.type,
      swingPrice: Number(swing.price.toFixed(2)), entry: Number(plan.entry.toFixed(2)),
      stopLoss: Number(plan.stopLoss.toFixed(2)), tp1: Number(plan.tp1.toFixed(2)),
      tp2: Number(plan.tp2.toFixed(2)), tp3: Number(plan.tp3.toFixed(2)),
      risk: Number(plan.risk.toFixed(2)), realizedR: Number(Number(outcome.realizedR || 0).toFixed(2)),
      result: outcome.result, status: outcome.status,
      exit: outcome.exit == null ? null : Number(outcome.exit.toFixed(2)),
      exitTime: outcome.exitTime, reason: outcome.reason
    });
    if (outcome.barIndex != null) nextAvailableIndex = outcome.barIndex + 1;
    else break;
  }
  return trades;
}
