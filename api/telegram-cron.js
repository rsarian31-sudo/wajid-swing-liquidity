import { get, put } from "@vercel/blob";

const CANONICAL_API = "https://wajid-ai-signals.vercel.app/api/liquidity";
const PAIRS = ["XAU/USD", "BTC/USD"];
const INTERVALS = ["5min", "15min"];
const STATE_PATH = "wajid-telegram/last-signal-keys.json";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ success: false, error: "Method not allowed" });

  const secret = process.env.CRON_SECRET;
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, "") || String(req.query?.secret || "");
  if (!secret || supplied !== secret) return res.status(401).json({ success: false, error: "Unauthorized" });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return res.status(503).json({ success: false, error: "Telegram environment variables are missing" });

  const state = await readState();
  const sent = [], skipped = [], errors = [];

  for (const symbol of PAIRS) {
    for (const interval of INTERVALS) {
      try {
        const signal = await getSignal(symbol, interval);
        const direction = String(signal?.signal?.direction || "WAIT").toUpperCase();
        const plan = signal?.tradePlan || null;
        if ((direction !== "BUY" && direction !== "SELL") || !plan) {
          skipped.push(`${symbol}|${interval}|WAIT`);
          continue;
        }

        const key = [symbol, interval, direction, plan.entry, plan.stopLoss, plan.tp2].join("|");
        const stateKey = `${symbol}|${interval}`;
        if (state[stateKey] === key) {
          skipped.push(`${symbol}|${interval}|duplicate`);
          continue;
        }

        const latest = Array.isArray(signal.candles) && signal.candles.length ? signal.candles[signal.candles.length - 1] : null;
        const emoji = direction === "BUY" ? "🟢" : "🔴";
        const message = [
          `${emoji} Wajid Swing Liquidity`,
          `New ${direction} signal — ${symbol}`,
          `⏱ ${interval}`,
          `📌 Entry: ${fmt(plan.entry)}`,
          `🛑 SL: ${fmt(plan.stopLoss)}`,
          `🎯 TP1: ${fmt(plan.tp1)}`,
          `🏆 TP2: ${fmt(plan.tp2)} (WIN)`,
          `🎯 TP3: ${fmt(plan.tp3)}`,
          `📊 Confidence: ${fmt(signal.signal?.probability, true)}%`,
          latest?.time ? `🕒 ${new Date(Number(latest.time) * 1000).toLocaleString("en-GB", { timeZone: "UTC" })} UTC` : "",
          "",
          "TP2 = official WIN (+2R). TP1 is milestone only."
        ].filter(Boolean).join("\n");

        await sendTelegram(token, chatId, message);
        state[stateKey] = key;
        sent.push(`${symbol}|${interval}`);
      } catch (error) {
        errors.push(`${symbol}|${interval}: ${error?.message || "error"}`);
      }
    }
  }

  await writeState(state);
  return res.status(errors.length ? 207 : 200).json({ success: errors.length === 0, sent, skipped, errors });
}

async function getSignal(symbol, interval) {
  const url = `${CANONICAL_API}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=5`;
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !data?.success) throw new Error(data?.error || "Canonical signal API error");
  return data;
}

async function sendTelegram(token, chatId, text) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
  });
  const data = await response.json();
  if (!response.ok || !data?.ok) throw new Error(data?.description || "Telegram sendMessage failed");
}

async function readState() {
  try {
    const result = await get(STATE_PATH, { access: "private", useCache: false });
    if (!result?.stream) return {};
    const text = await new Response(result.stream).text();
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

async function writeState(state) {
  await put(STATE_PATH, JSON.stringify(state), { access: "private", addRandomSuffix: false, allowOverwrite: true });
}

function fmt(value, percent = false) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return percent ? n.toFixed(1) : n.toFixed(2);
}
