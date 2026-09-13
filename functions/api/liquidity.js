import { CONFIG, analyze } from '../../src/strategy.js';

const ALLOWED = new Set(['5min', '15min']);

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return json({ success: true });
  if (request.method !== 'GET') return json({ success: false, error: 'Method not allowed' }, 405);

  try {
    const url = new URL(request.url);
    const symbol = 'XAU/USD';
    const interval = ALLOWED.has(url.searchParams.get('interval')) ? url.searchParams.get('interval') : '15min';
    const requested = Number(url.searchParams.get('outputsize') || CONFIG.outputSize);
    const outputsize = Number.isFinite(requested) ? Math.min(500, Math.max(100, Math.floor(requested))) : CONFIG.outputSize;
    if (!env.TWELVE_DATA_API_KEY) return json({ success: false, error: 'TWELVE_DATA_API_KEY is not configured' }, 500);

    const cache = caches.default;
    const cacheRequest = new Request(`https://wajid-cache.local/liquidity?interval=${interval}&outputsize=${outputsize}`);
    const hit = await cache.match(cacheRequest);
    if (hit) return withCacheHeader(await hit.json(), 'HIT');

    const p = new URLSearchParams({ symbol, interval, outputsize: String(outputsize), order: 'ASC', timezone: 'UTC', apikey: env.TWELVE_DATA_API_KEY });
    const r = await fetch('https://api.twelvedata.com/time_series?' + p, { headers: { Accept: 'application/json' } });
    const d = await r.json();
    if (!r.ok || d?.status === 'error' || d?.code) throw new Error(d?.message || `Twelve Data HTTP ${r.status}`);
    if (!Array.isArray(d?.values)) throw new Error(d?.message || 'Twelve Data returned no values');

    const candles = d.values.map(x => ({ time: Math.floor(x.timestamp ? Number(x.timestamp) : Date.parse(String(x.datetime || '')) / 1000), open: Number(x.open), high: Number(x.high), low: Number(x.low), close: Number(x.close), volume: Number(x.volume || 0) })).filter(x => [x.time,x.open,x.high,x.low,x.close].every(Number.isFinite));
    candles.sort((a,b) => a.time - b.time);
    const unique = [], seen = new Set();
    for (const c of candles) if (!seen.has(c.time)) { seen.add(c.time); unique.push(c); }
    if (!unique.length) throw new Error('No market candles returned');

    const a = analyze(unique);
    const data = { success:true, strategy:{id:'swing-liquidity',name:'Swing Liquidity',source:'Swing Points and Liquidity',swingLeft:15,swingRight:10,maxStopAtr:3}, market:{symbol,interval,price:unique.at(-1).close,lastCandleTime:unique.at(-1).time}, candles:unique, swings:{highs:a.swings.highs,lows:a.swings.lows}, liquidity:{levels:a.liquidityLevels,sweeps:a.sweeps}, signal:a.signal, tradePlan:a.tradePlan, diagnostics:a.diagnostics };
    const response = new Response(JSON.stringify(data), { headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=30'} });
    context.waitUntil(cache.put(cacheRequest, response.clone()));
    return withCacheHeader(data, 'MISS');
  } catch (e) { return json({ success:false, error:e?.message || 'Liquidity error' }, 500); }
}

function withCacheHeader(data, state) { return new Response(JSON.stringify(data), { headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=0, s-maxage=30, stale-while-revalidate=15','X-Wajid-Cache':state} }); }
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});}
