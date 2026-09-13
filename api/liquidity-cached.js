import { get, put } from "@vercel/blob";

const CANONICAL_API = "https://wajid-ai-signals.vercel.app/api/liquidity-cached";
const TTL_MS = 30 * 1000;
const CACHE_PREFIX = "wajid-market-cache/";

// Process-local cache + in-flight promise deduplication. Blob provides a
// short persistent cache across separate serverless instances.
const memoryCache = globalThis.__wajidMarketCache || (globalThis.__wajidMarketCache = new Map());
const inflight = globalThis.__wajidMarketInflight || (globalThis.__wajidMarketInflight = new Map());

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30, stale-while-revalidate=15");
  res.setHeader("Vercel-CDN-Cache-Control", "public, s-maxage=30, stale-while-revalidate=15");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).json({ success: true });
  if (req.method !== "GET") return res.status(405).json({ success: false, error: "Method not allowed" });

  const symbol = String(req.query?.symbol || "XAU/USD").trim();
  const interval = String(req.query?.interval || "15min").toLowerCase() === "5min" ? "5min" : "15min";
  const requested = Number(req.query?.outputsize || 500);
  const outputsize = Number.isFinite(requested) ? Math.min(500, Math.max(100, Math.floor(requested))) : 300;
  const key = `${symbol}|${interval}|${outputsize}`;

  const cached = memoryCache.get(key);
  if (cached && Date.now() - cached.savedAt < TTL_MS) {
    res.setHeader("X-Wajid-Cache", "memory-hit");
    return res.status(200).json(cached.data);
  }

  try {
    const blobCached = await readBlob(key);
    if (blobCached && Date.now() - blobCached.savedAt < TTL_MS) {
      memoryCache.set(key, blobCached);
      res.setHeader("X-Wajid-Cache", "blob-hit");
      return res.status(200).json(blobCached.data);
    }
  } catch {
    // Blob cache is an optimization; never make the API fail because of it.
  }

  if (inflight.has(key)) {
    try {
      const data = await inflight.get(key);
      res.setHeader("X-Wajid-Cache", "inflight-hit");
      return res.status(200).json(data);
    } catch (error) {
      return res.status(502).json({ success: false, error: error?.message || "Market data request failed" });
    }
  }

  const promise = fetchFresh(symbol, interval, outputsize, key);
  inflight.set(key, promise);

  try {
    const data = await promise;
    res.setHeader("X-Wajid-Cache", "fresh");
    return res.status(200).json(data);
  } catch (error) {
    return res.status(502).json({ success: false, error: error?.message || "Market data request failed" });
  } finally {
    inflight.delete(key);
  }
}

async function fetchFresh(symbol, interval, outputsize, key) {
  const url = `${CANONICAL_API}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}`;
  const response = await fetch(url, { cache: "no-store" });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Invalid response from canonical Swing Liquidity API");
  }
  if (!response.ok || !data?.success) throw new Error(data?.error || `Canonical API HTTP ${response.status}`);

  const entry = { savedAt: Date.now(), data };
  memoryCache.set(key, entry);
  try { await put(CACHE_PREFIX + safeKey(key) + ".json", JSON.stringify(entry), { access: "private", addRandomSuffix: false, allowOverwrite: true }); } catch {}
  return data;
}

async function readBlob(key) {
  const result = await get(CACHE_PREFIX + safeKey(key) + ".json", { access: "private", useCache: false });
  if (!result?.stream) return null;
  return JSON.parse(await new Response(result.stream).text());
}

function safeKey(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
