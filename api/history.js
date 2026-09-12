const CANONICAL_API = "https://wajid-ai-signals.vercel.app/api/liquidity";
const CONFIRMATION_BARS = 6;
const ATR_LENGTH = 14;
const SL_ATR_BUFFER = 0.35;

// Final Swing Liquidity trade outcome rules:
// - TP1 is a milestone only; the trade remains OPEN.
// - TP2 is the official winning target: TP2 hit = WIN (+2R).
// - TP2 hit means the trade is closed for history immediately; TP3 does not change the result.
// - SL hit before TP2 = LOSS (-1R).
// - If SL and TP2 are both touched in the same candle before TP2, resolve conservatively as SL.
// - No 75%/25% partial-close calculation is used in history.
//
// History anti-spam rules:
// - Only ONE trade may be open at a time.
// - After a trade closes, the next setup is searched from the following candle.
// - The same liquidity level can only produce one historical trade.
// - This prevents overlapping BUY/SELL signals from the same market move.

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
    const swings = data.swings || { highs: [], lows: [] };
    const sweeps = detectHistoricalSweeps(candles, swings);
    const trades = buildHistory(candles, sweeps);

    const closed = trades.filter(t => t.status === "CLOSED");
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

function detectHistoricalSweeps(candles, swings) {
  const sweeps = [];
  const levels = [
    ...(Array.isArray(swings.highs) ? swings.highs : []),
    ...(Array.isArray(swings.lows) ? swings.lows : [])
  ].sort((a, b) => Number(a.index) - Number(b.index));

  for (const level of levels) {
    const levelIndex = Number(level.index);
    const confirmedIndex = Number(level.confirmedIndex ?? (levelIndex + 10));
    const price = Number(level.price);
    if (!Number.isFinite(levelIndex) || !Number.isFinite(confirmedIndex) || !Number.isFinite(price)) continue;

    const start = Math.max(confirmedIndex, levelIndex + 1, 0);
    for (let i = start; i < candles.length; i++) {
      const c = candles[i];
      if (!c) continue;
      if (level.type === "SWING_HIGH" && c.high > price && c.close < price) {
        sweeps.push({ type: "BEARISH", side: "HIGH", index: i, time: c.time, level: { index: levelIndex, price } });
      }
      if (level.type === "SWING_LOW" && c.low < price && c.close > price) {
        sweeps.push({ type: "BULLISH", side: "LOW", index: i, time: c.time, level: { index: levelIndex, price } });
      }
    }
  }

  sweeps.sort((a, b) => a.index - b.index);
  return sweeps;
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
    if (!c || !p) continue;

    // Confirmation must happen on a CLOSED candle.
    // Keep the existing confirmation mathematics, but never confirm on the sweep candle itself.
    if (sweep.type === "BULLISH" && c.close > c.open && c.close > p.high) {
      return { confirmed: true, direction: "BUY", index: i, time: c.time, price: c.close, sweep };
    }
    if (sweep.type === "BEARISH" && c.close < c.open && c.close < p.low) {
      return { confirmed: true, direction: "SELL", index: i, time: c.time, price: c.close, sweep };
    }
  }
  return { confirmed: false };
}

function tradePlan(candles, signal, index) {
  const entry = Number(signal.price);
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
    const hitSL = direction === "BUY" ? c.low <= plan.stopLoss : c.high >= plan.stopLoss;
    const hitTP2 = direction === "BUY" ? c.high >= plan.tp2 : c.low <= plan.tp2;

    // Before TP2, the full trade is considered open.
    // If SL and TP2 touch in the same candle, use the conservative SL-first rule.
    if (hitSL && hitTP2) {
      return {
        status: "CLOSED",
        result: "LOSS",
        realizedR: -1,
        exit: plan.stopLoss,
        exitTime: c.time,
        barIndex: i,
        reason: "SL before TP2; same-candle TP2 treated conservatively"
      };
    }

    if (hitSL) {
      return {
        status: "CLOSED",
        result: "LOSS",
        realizedR: -1,
        exit: plan.stopLoss,
        exitTime: c.time,
        barIndex: i,
        reason: "Stop loss before TP2"
      };
    }

    if (hitTP2) {
      return {
        status: "CLOSED",
        result: "WIN",
        realizedR: 2,
        exit: plan.tp2,
        exitTime: c.time,
        barIndex: i,
        reason: "TP2 hit"
      };
    }
  }

  return {
    status: "OPEN",
    result: "OPEN",
    realizedR: 0,
    exit: null,
    exitTime: null,
    barIndex: null,
    reason: "TP2 and SL not reached in available history"
  };
}

function buildHistory(candles, sweeps) {
  const trades = [];
  const usedConfirmation = new Set();
  const usedLiquidityLevels = new Set();

  // Process setups strictly from oldest to newest.
  // Once a trade is opened, ignore every other setup until that trade closes.
  let nextAvailableIndex = 0;

  for (const sweep of sweeps) {
    if (sweep.index < nextAvailableIndex) continue;

    const level = sweep.level || {};
    const levelKey = `${sweep.side}:${Number(level.index)}:${Number(level.price).toFixed(4)}`;
    if (usedLiquidityLevels.has(levelKey)) continue;

    const confirmation = confirmSweep(candles, sweep);
    if (!confirmation.confirmed) continue;
    if (confirmation.index < nextAvailableIndex) continue;

    const key = `${confirmation.time}:${confirmation.direction}`;
    if (usedConfirmation.has(key)) continue;

    const plan = tradePlan(candles, confirmation, confirmation.index);
    if (!plan) continue;

    usedConfirmation.add(key);
    usedLiquidityLevels.add(levelKey);

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
      realizedR: Number(Number(outcome.realizedR || 0).toFixed(2)),
      result: outcome.result,
      status: outcome.status,
      exit: outcome.exit == null ? null : Number(outcome.exit.toFixed(2)),
      exitTime: outcome.exitTime,
      reason: outcome.reason
    });

    // A second setup cannot open until this trade has actually closed.
    if (outcome.barIndex != null) {
      nextAvailableIndex = outcome.barIndex + 1;
    } else {
      // Current trade is still OPEN at the end of available history.
      // Do not manufacture another trade after it.
      break;
    }
  }

  return trades;
}
