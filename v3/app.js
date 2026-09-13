const $ = (id) => document.getElementById(id);
let interval = '15min';
let chart;
let candleSeries;

function money(v){ return Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—'; }
function set(id,v){ $(id).textContent = v ?? '—'; }

function initChart(){
  chart = LightweightCharts.createChart($('chart'), { layout:{background:{color:'#0d121b'},textColor:'#7f8ba0'}, grid:{vertLines:{color:'#17202d'},horzLines:{color:'#17202d'}}, rightPriceScale:{borderColor:'#202a39'}, timeScale:{borderColor:'#202a39',timeVisible:true,secondsVisible:false} });
  candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries,{upColor:'#61d9a1',downColor:'#ff7785',borderVisible:false,wickUpColor:'#61d9a1',wickDownColor:'#ff7785'});
  new ResizeObserver(()=>chart.applyOptions({width:$('chart').clientWidth})).observe($('chart'));
}

async function getJson(url){ const r=await fetch(url,{cache:'no-store'}); const d=await r.json(); if(!r.ok||d.success===false) throw new Error(d.error||`HTTP ${r.status}`); return d; }

function renderSignal(d){
  const s=d.signal||{}; const v=s.direction||s.value||'WAIT';
  $('signalValue').textContent=v;
  $('signalValue').className=`signal ${String(v).toLowerCase()}`;
  set('price',money(d.market?.price)); set('score',s.score ?? '—'); set('probability',s.probability!=null?`${s.probability}%`:'—');
  set('signalMeta',s.time?new Date(Number(s.time)*1000).toLocaleString(): 'No active confirmed signal');
  const p=d.tradePlan||{}; set('entry',money(p.entry)); set('stop',money(p.stopLoss)); set('tp1',money(p.tp1)); set('tp2',money(p.tp2)); set('tp3',money(p.tp3)); set('risk',money(p.risk));
  const x=d.diagnostics||{}; set('swingHigh',money(x.latestSwingHigh)); set('swingLow',money(x.latestSwingLow)); set('sweep',x.latestSweep||'NONE'); set('confirmation',x.confirmation||'NONE'); set('atr',money(x.atr)); set('riskFilter',x.riskFilter?.rejected?'REJECTED':(x.riskFilter?.passed?'PASSED':'—'));
  $('statusDot').style.background='#61d9a1'; $('statusText').textContent='LIVE';
}

function renderHistory(d){
  const s=d.summary||{}; set('trades',s.closedTrades ?? s.totalTrades ?? 0); set('winRate',`${s.winRate??0}%`); set('winsLosses',`${s.wins??0} / ${s.losses??0}`); set('totalR',s.totalR!=null?`${s.totalR}R`:'—');
  $('historyBody').innerHTML=(d.trades||[]).slice(0,12).map(t=>`<tr><td>${t.entryTime?new Date(Number(t.entryTime)*1000).toLocaleString():'—'}</td><td>${t.direction||'—'}</td><td>${money(t.entry)}</td><td>${t.result||t.status||'—'}</td><td>${t.realizedR!=null?`${t.realizedR}R`:'—'}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">No history available.</td></tr>';
}

async function load(){
  $('statusText').textContent='LOADING';
  try { const [live,history]=await Promise.all([getJson(`/api/liquidity?symbol=XAU/USD&interval=${interval}&outputsize=300`),getJson(`/api/history?symbol=XAU/USD&interval=${interval}`)]); renderSignal(live); renderHistory(history); candleSeries.setData((live.candles||[]).map(c=>({time:Number(c.time),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)}))); chart.timeScale().fitContent(); } catch(e){ $('statusDot').style.background='#ff7785'; $('statusText').textContent='ERROR'; $('signalMeta').textContent=e.message; }
}

document.querySelectorAll('[data-interval]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-interval]').forEach(x=>x.classList.remove('active'));b.classList.add('active');interval=b.dataset.interval;$('intervalLabel').textContent=interval==='5min'?'5M':'15M';load();}));
initChart(); load();
setInterval(load,30000);
