import { CONFIG, analyze, buildHistory } from '../../src/strategy.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return json({ success:false, error:'Method not allowed' }, 405);
  try {
    const url = new URL(request.url);
    const interval = url.searchParams.get('interval') === '5min' ? '5min' : '15min';
    if (!env.TWELVE_DATA_API_KEY) return json({ success:false, error:'TWELVE_DATA_API_KEY is not configured' },500);

    const cache = caches.default;
    const cacheRequest = new Request(`https://wajid-cache.local/history?interval=${interval}`);
    const hit = await cache.match(cacheRequest);
    if (hit) return hit;

    const p = new URLSearchParams({ symbol:'XAU/USD', interval, outputsize:'500', order:'ASC', timezone:'UTC', apikey:env.TWELVE_DATA_API_KEY });
    const r = await fetch('https://api.twelvedata.com/time_series?' + p, { headers:{Accept:'application/json'} });
    const d = await r.json();
    if (!r.ok || d?.status === 'error' || d?.code) throw new Error(d?.message || `Twelve Data HTTP ${r.status}`);
    const candles = (d.values || []).map(x => ({time:Math.floor(x.timestamp ? Number(x.timestamp) : Date.parse(String(x.datetime||''))/1000),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number(x.volume||0)})).filter(x => [x.time,x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.time-b.time);
    if (!candles.length) throw new Error('No market candles returned');
    const a = analyze(candles);
    const trades = buildHistory(candles, a.swings, 'XAU/USD');
    const closed = trades.filter(x=>x.status==='CLOSED');
    const wins = closed.filter(x=>x.result==='WIN');
    const losses = closed.filter(x=>x.result==='LOSS');
    const totalR = closed.reduce((s,x)=>s+Number(x.realizedR||0),0);
    const data = {success:true,symbol:'XAU/USD',interval,summary:{totalTrades:trades.length,closedTrades:closed.length,wins:wins.length,losses:losses.length,open:trades.filter(x=>x.status==='OPEN').length,winRate:closed.length?Number((wins.length/closed.length*100).toFixed(1)):0,totalR:Number(totalR.toFixed(2)),averageR:closed.length?Number((totalR/closed.length).toFixed(2)):0},trades:trades.slice().reverse()};
    const response = new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Cache-Control':'public,max-age=30'}});
    context.waitUntil(cache.put(cacheRequest,response.clone()));
    return response;
  } catch(e) { return json({success:false,error:e?.message||'History error'},500); }
}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});}
