const CANONICAL_API = "https://wajid-swing-liquidity.vercel.app/api/liquidity-cached";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).json({ success: true });
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return res.status(503).json({
      success: false,
      configured: false,
      error: "Telegram is not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Vercel Environment Variables."
    });
  }

  const interval = String(req.query?.interval || "15min").toLowerCase() === "5min" ? "5min" : "15min";
  const symbol = String(req.query?.symbol || "XAU/USD");
  const clientKey = String(req.query?.key || "");
  const test = String(req.query?.test || "") === "1";

  try {
    const url = `${CANONICAL_API}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=5`;
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data?.success) throw new Error(data?.error || "Canonical signal API error");

    const signal = data.signal || {};
    const plan = data.tradePlan || null;
    const direction = String(signal.direction || "WAIT").toUpperCase();

    if (direction !== "BUY" && direction !== "SELL") {
      return res.status(200).json({ success: true, configured: true, notified: false, reason: "WAIT" });
    }

    const key = [
      symbol,
      interval,
      direction,
      plan?.entry,
      plan?.stopLoss,
      plan?.tp2
    ].join("|");

    if (!test && clientKey && clientKey === key) {
      return res.status(200).json({ success: true, configured: true, notified: false, duplicate: true, key });
    }

    const latestCandle = Array.isArray(data.candles) && data.candles.length
      ? data.candles[data.candles.length - 1]
      : null;

    const emoji = direction === "BUY" ? "🟢" : "🔴";
    const message = [
      `${emoji} Wajid Swing Liquidity`,
      `New ${direction} signal — ${symbol}`,
      `⏱ ${interval}`,
      `📌 Entry: ${fmt(plan?.entry)}`,
      `🛑 SL: ${fmt(plan?.stopLoss)}`,
      `🎯 TP1: ${fmt(plan?.tp1)}`,
      `🏆 TP2: ${fmt(plan?.tp2)} (WIN)`,
      `🎯 TP3: ${fmt(plan?.tp3)}`,
      `📊 Confidence: ${fmt(signal.probability, true)}%`,
      latestCandle?.time ? `🕒 ${new Date(Number(latestCandle.time) * 1000).toLocaleString("en-GB", { timeZone: "UTC" })} UTC` : "",
      "",
      "TP2 = official WIN (+2R). TP1 is milestone only."
    ].filter(Boolean).join("\n");

    const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true })
    });
    const tgData = await tg.json();
    if (!tg.ok || !tgData?.ok) throw new Error(tgData?.description || "Telegram sendMessage failed");

    return res.status(200).json({ success: true, configured: true, notified: true, key });
  } catch (error) {
    return res.status(500).json({ success: false, configured: true, error: error?.message || "Telegram notification error" });
  }
}

function fmt(value, percent = false) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return percent ? n.toFixed(1) : n.toFixed(2);
}
