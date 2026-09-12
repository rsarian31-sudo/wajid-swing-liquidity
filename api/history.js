const CANONICAL_API = "https://wajid-ai-signals.vercel.app/api/liquidity";
const SWEEP_LOOKBACK = 8;
const CONFIRMATION_BARS = 6;
const ATR_LENGTH = 14;
const SL_ATR_BUFFER = 0.35;

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

    const candles = data.candles || [];
    const trades = buildHistory(candles, data.liquidity?.sweeps || []);
    const closed = trades.filter(t => t.status !== "OPEN");
    const wins = closed.filter(t => t.result === "WIN");
    const losses = closed.filter(t => t.result === "LOSS");
    const open = trades.filter(t => t.status === "OPEN");
    const totalR = closed.reduce((sum, t) => sum + Number(t.realizedR || 0), 0);
    const winRate = closed.length ? Number((wins.length / closed.length * 100).toFixed(1)) : 0;

    return res.status(200).json({
      success: true,
      symbol,
      interval,
      summary: {
        totalTrades: trades.length,
        closedTrades: closed.length,
        wins: wins.length,
        losses: losses.length,
        open: open.length,
        winRate,
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
    const c = candles[i];
    const p = candles[i - 1];
    tr.push(p ? Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)) : c.high - c.low);
  }
  return tr.length ? tr.reduce((a, b) => a + b, 0) / tr.length : 0;
}

function confirmSweep(candles, sweep) {
  const start = sweep.index + 1;
  const end = Math.min(candles.length - 1, sweep.index + CONFIRMATION_BARS);
  for (let i = start; i <= end; i++) {
    const c = candles[i], p = candles[i - 1];
    if (sweep.type === "BULLISH" && c.close > c.open && c.close > p.high) return { confirmed: true, direction: "BUY", index: i, time: c.time, price: c.close };
    if (sweep.type === "BEARISH" && c.close < c.open && c.close < p.low) return { confirmed: true, direction: "SELL", index: i, time: c.time, price: c.close };
  }
  return { confirmed: false };
}

function tradePlan(candles, signal, index) {
  const entry = signal.price;
  const sweepPrice = Number(signal.sweep?.level?.price);
  const atr = atrAt(candles, index);
  if (!Number.isFinite(entry) || !atr) return null;
  let sl;
  if (signal.direction === "BUY") {
    const structural = Number.isFinite(sweepPrice) ? sweepPrice : entry - atr;
    sl = Math.min(structural, entry - atr * SL_ATR_BUFFER);
  } else {
    const structural = Number.isFinite(sweepPrice) ? sweepPrice : entry + atr;
    sl = Math.max(structural, entry + atr * SL_ATR_BUFFER);
  }
  const risk = Math.max(Math.abs(entry - sl), atr * 0.25);
  return signal.direction === "BUY"
    ? { entry, stopLoss: sl, tp1: entry + risk, tp2: entry + risk * 2, tp3: entry + risk * 3, risk, atr }
    : { entry, stopLoss: sl, tp1: entry - risk, tp2: entry - risk * 2, tp3: entry - risk * 3, risk, atr };
}

function resolveTrade(candles, signalIndex, plan, direction) {
  for (let i = signalIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    if (direction === "BUY") {
      const hitSL = c.low <= plan.stopLoss;
      const hitTP3 = c.high >= plan.tp3;
      const hitTP2 = c.high >= plan.tp2;
      const hitTP1 = c.high >= plan.tp1;
      if (hitSL && (hitTP1 || hitTP2 || hitTP3)) return { status: "CLOSED", result: "LOSS", realizedR: -1, exit: plan.stopLoss, exitTime: c.time, barIndex: i, reason: "SL and target touched in same candle; conservative SL" };
      if (hitSL) return { status: "CLOSED", result: "LOSS", realizedR: -1, exit: plan.stopLoss, exitTime: c.time, barIndex: i, reason: "STOP LOSS" };
      if (hitTP3) return { status: "CLOSED", result: "WIN", realizedR: 3, exit: plan.tp3, exitTime: c.time, barIndex: i, reason: "TP3" };
      if (hitTP2) return { status: "CLOSED", result: "WIN", realizedR: 2, exit: plan.tp2, exitTime: c.time, barIndex: i, reason: "TP2" };
      if (hitTP1) return { status: "CLOSED", result: "WIN", realizedR: 1, exit: plan.tp1, exitTime: c.time, barIndex: i, reason: "TP1" };
    } else {
      const hitSL = c.high >= plan.stopLoss;
      const hitTP3 = c.low <= plan.tp3;
      const hitTP2 = c.low <= plan.tp2;
      const hitTP1 = c.low <= plan.tp1;
      if (hitSL && (hitTP1 || hitTP2 || hitTP3)) return { status: "CLOSED", result: "LOSS", realizedR: -1, exit: plan.stopLoss, exitTime: c.time, barIndex: i, reason: "SL and target touched in same candle; conservative SL" };
      if (hitSL) return { status: "CLOSED", result: "LOSS", realizedR: -1, exit: c.high >= plan.stopLoss ? plan.stopLoss : plan.stopLoss, exitTime: c.time, barIndex: i, reason: "STOP LOSS" };
      if (hitTP3) return { status: "CLOSED", result: "WIN", realizedR: 3, exit: plan.tp3, exitTime: c.time, barIndex: i, reason: "TP3" };
      if (hitTP2) return { status: "CLOSED", result: "WIN", realizedR: 2, exit: plan.tp2, exitTime: c.time, barIndex: i, reason: "TP2" };
      if (hitTP1) return { status: "CLOSED", result: "WIN", realizedR: 1, exit: plan.tp1, exitTime: c.time, barIndex: i, reason: "TP1" };
    }
  }
  return { status: "OPEN", result: "OPEN", realizedR: 0, exit: null, exitTime: null, barIndex: null, reason: "No SL/TP reached in available history" };
}

function buildHistory(candles, sweeps) {
  const trades = [];
  const usedConfirmation = new Set();
  const ordered = sweeps.slice().sort((a, b) => a.index - b.index);
  for (const sweep of ordered) {
    const confirmation = confirmSweep(candles, sweep);
    if (!confirmation.confirmed) continue;
    const key = `${confirmation.time}:${confirmation.direction}`;
    if (usedConfirmation.has(key)) continue;
    usedConfirmation.add(key);
    const plan = tradePlan(candles, { direction: confirmation.direction, price: confirmation.price, sweep }, confirmation.index);
    if (!plan) continue;
    const outcome = resolveTrade(candles, confirmation.index, plan, confirmation.direction);
    trades.push({
      id: `${confirmation.time}-${confirmation.direction}`,
      direction: confirmation.direction,
      signalTime: confirmation.time,
      entry: Number(plan.entry.toFixed(2)),
      stopLoss: Number(plan.stopLoss.toFixed(2)),
      tp1: Number(plan.tp1.toFixed(2)),
      tp2: Number(plan.tp2.toFixed(2)),
      tp3: Number(plan.tp3.toFixed(2)),
      risk: Number(plan.risk.toFixed(2)),
      realizedR: outcome.realizedR,
      result: outcome.result,
      status: outcome.status,
      exit: outcome.exit == null ? null : Number(outcome.exit.toFixed(2)),
      exitTime: outcome.exitTime,
      reason: outcome.reason
    });
  }
  return trades;
}
