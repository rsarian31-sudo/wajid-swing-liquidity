export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
  if (request.method === "OPTIONS") return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  if (request.method !== "GET") return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), { status: 405, headers });

  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return new Response(JSON.stringify({ success:false, configured:false, error:"Telegram is not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID as Cloudflare secrets." }), { status:503, headers });

  const interval = String(url.searchParams.get("interval") || "15min").toLowerCase() === "5min" ? "5min" : "15min";
  const symbol = "XAU/USD";
  const clientKey = String(url.searchParams.get("key") || "");
  const test = String(url.searchParams.get("test") || "") === "1";
  try {
    const api = new URL("/api/liquidity", url.origin);
    api.searchParams.set("symbol", symbol); api.searchParams.set("interval", interval); api.searchParams.set("outputsize", "100");
    const r = await fetch(api.toString()); const data = await r.json();
    if (!r.ok || !data?.success) throw new Error(data?.error || "Signal API error");
    const signal=data.signal||{}, plan=data.tradePlan||{}, direction=String(signal.direction||"WAIT").toUpperCase();
    if (direction!=="BUY"&&direction!=="SELL") return new Response(JSON.stringify({success:true,configured:true,notified:false,reason:"WAIT"}),{headers});
    const key=[symbol,interval,direction,plan.entry,plan.stopLoss,plan.tp2].join("|");
    if(!test&&clientKey&&clientKey===key)return new Response(JSON.stringify({success:true,configured:true,notified:false,duplicate:true,key}),{headers});
    const c=data.candles?.at(-1), emoji=direction==="BUY"?"🟢":"🔴";
    const message=[`${emoji} Wajid Swing Liquidity`,`New ${direction} signal — ${symbol}`,`⏱ ${interval}`,`📌 Entry: ${fmt(plan.entry)}`,`🛑 SL: ${fmt(plan.stopLoss)}`,`🎯 TP1: ${fmt(plan.tp1)}`,`🏆 TP2: ${fmt(plan.tp2)} (WIN)`,`🎯 TP3: ${fmt(plan.tp3)}`,`📊 Confidence: ${fmt(signal.probability,true)}%`,c?.time?`${new Date(Number(c.time)*1000).toISOString().replace("T"," ").replace(".000Z"," UTC")}`:"","","TP2 = official WIN (+2R). TP1 is milestone only."].filter(Boolean).join("\n");
    const tg=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chatId,text:message,disable_web_page_preview:true})});
    const td=await tg.json(); if(!tg.ok||!td?.ok)throw new Error(td?.description||"Telegram sendMessage failed");
    return new Response(JSON.stringify({success:true,configured:true,notified:true,key}),{headers});
  } catch(e){return new Response(JSON.stringify({success:false,configured:true,error:e?.message||"Telegram notification error"}),{status:500,headers});}
}
function fmt(v,p=false){const n=Number(v);return Number.isFinite(n)?(p?n.toFixed(1):n.toFixed(2)):"—";}
