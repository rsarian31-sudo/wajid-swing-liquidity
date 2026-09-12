const CANONICAL_API = "https://wajid-ai-signals.vercel.app/api/liquidity";
const CONFIRMATION_BARS = 6;
const ATR_LENGTH = 14;
const SL_ATR_BUFFER = 0.35;

// Position management:
// - TP1 is a milestone only; no position is closed there.
// - TP2 closes 75% of the original position at +2R.
// - The remaining 25% stays open for TP3.
// - If TP2 is reached and the remaining 25% later hits SL, the trade is still a WIN:
//   75% * +2R + 25% * -1R = +1.25R.
// - If TP3 is reached after TP2: 75% * +2R + 25% * +3R = +2.25R.
// - If SL is reached before TP2: -1R.
// - When SL and a target are both touched in the same candle, SL is treated as first
//   conservatively, so no partial close is credited for that candle.

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
  let tp2Hit = false;
  let tp2Time = null;
  let tp2BarIndex = null;

  for (let i = signalIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    const hitSL = direction === "BUY" ? c.low <= plan.stopLoss : c.high >= plan.stopLoss;
    const hitTP2 = direction === "BUY" ? c.high >= plan.tp2 : c.low <= plan.tp2;
    const hitTP3 = direction === "BUY" ? c.high >= plan.tp3 : c.low <= plan.tp3;

    if (!tp2Hit) {
      // Before TP2, the whole position is still open. If SL and TP2/TP3 occur
      // in the same candle, resolve conservatively as SL first.
      if (hitSL && (hitTP2 || hitTP3)) {
        return {
          status: "CLOSED",
          result: "LOSS",
          realizedR: -1,
          exit: plan.stopLoss,
          exitTime: c.time,
          barIndex: i,
          reason: "SL before TP2; same-candle target treated conservatively"
        };
      }

      if (hitSL) {
        return { status: "CLOSED", result: "LOSS", realizedR: -1, exit: plan.stopLoss, exitTime: c.time, barIndex: i, reason: "STOP LOSS before TP2" };
      }

      if (hitTP2) {
        tp2Hit = true;
        tp2Time = c.time;
        tp2BarIndex = i;
        // 75% is now closed at +2R. The remaining 25% continues toward TP3/SL.
        continue;
      }

      continue;
    }

    // TP2 has already closed 75%. Only the remaining 25% is now exposed.
    if (hitSL && hitTP3) {
      // Same-candle ambiguity after TP2: conservatively treat SL as first.
      // Result is still a WIN because the 75% TP2 portion was already secured.
      const realizedR = 0.75 * 2 + 0.25 * -1;
      return {
        status: "CLOSED",
        result: "WIN",
        realizedR,
        exit: plan.stopLoss,
        exitTime: c.time,
        barIndex: i,
        reason: "TP2 hit; 75% closed at +2R, remaining 25% hit SL"
      };
    }

    if (hitSL) {
      const realizedR = 0.75 * 2 + 0.25 * -1;
      return {
        status: "CLOSED",
        result: "WIN",
        realizedR,
        exit: plan.stopLoss,
        exitTime: c.time,
        barIndex: i,
        reason: "TP2 hit; 75% closed at +2R, remaining 25% hit SL"
      };
    }

    if (hitTP3) {
      const realizedR = 0.75 * 2 + 0.25 * 3;
      return {
        status: "CLOSED",
        result: "WIN",
        realizedR,
        exit: plan.tp3,
        exitTime: c.time,
        barIndex: i,
        reason: "TP2 hit (75% closed), then TP3 hit on remaining 25%"
      };
    }
  }

  if (tp2Hit) {
    // History ended after TP2: 75% is already realized at +2R and 25% is still open.
    return {
      status: "OPEN",
      result: "OPEN",
      realizedR: 1.5,
      exit: plan.tp2,
      exitTime: tp2Time,
      barIndex: tp2BarIndex,
      reason: "TP2 hit; 75% closed at +2R, remaining 25% open for TP3/SL"
    };
  }

  return { status: "OPEN", result: "OPEN", realizedR: 0, exit: null, exitTime: null, barIndex: null, reason: "No SL/TP2 reached in available history" };
}

function buildHistory(candles, sweeps) {
  const trades = [];
  const usedConfirmation = new Set();

  for (const sweep of sweeps) {
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
      realizedR: Number(Number(outcome.realizedR || 0).toFixed(2)),
      result: outcome.result,
      status: outcome.status,
      exit: outcome.exit == null ? null : Number(outcome.exit.toFixed(2)),
      exitTime: outcome.exitTime,
      reason: outcome.reason
    });
  }

  return trades;
}
