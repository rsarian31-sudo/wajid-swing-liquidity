const HISTORY_API = "https://wajid-swing-liquidity.vercel.app/api/history";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=15");
  res.setHeader("Vercel-CDN-Cache-Control", "public, s-maxage=30, stale-while-revalidate=15");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).json({ success: true });
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });

  try {
    const symbol = String(req.query?.symbol || "XAU/USD");
    const interval = String(req.query?.interval || "15min").toLowerCase() === "5min" ? "5min" : "15min";
    const url = `${HISTORY_API}?symbol=${encodeURIComponent(symbol)}&interval=${interval}`;
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({ success: false, error: error?.message || "History proxy error" });
  }
}
