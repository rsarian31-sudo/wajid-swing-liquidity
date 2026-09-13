const state={interval:'15min',liquidity:null,history:null};
const $=id=>document.getElementById(id);
const fmt=v=>Number.isFinite(Number(v))?Number(v).toFixed(2):'—';
const time=v=>v?new Date(Number(v)*1000).toLocaleString([],{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';

let chart,candles,highs,lows;
function initChart(){
  const host=$('chart');
  chart=LightweightCharts.createChart(host,{layout:{background:{color:'transparent'},textColor:'#8ea3b8'},grid:{vertLines:{color:'#142638'},horzLines:{color:'#142638'}},rightPriceScale:{borderColor:'#20364c'},timeScale:{borderColor:'#20364c',timeVisible:true,secondsVisible:false},crosshair:{mode:LightweightCharts.CrosshairMode.Normal}});
  candles=chart.addCandlestickSeries({upColor:'#36d69a',downColor:'#ff687b',borderUpColor:'#36d69a',borderDownColor:'#ff687b',wickUpColor:'#36d69a',wickDownColor:'#ff687b'});
  highs=chart.addLineSeries({color:'#d9a441',lineStyle:2,lineWidth:1,lastValueVisible:false,priceLineVisible:false});
  lows=chart.addLineSeries({color:'#4e9cf5',lineStyle:2,lineWidth:1,lastValueVisible:false,priceLineVisible:false});
  window.addEventListener('resize',()=>chart.applyOptions({width:host.clientWidth}));
}
function flat(series,data,value){series.setData(data.length&&Number.isFinite(Number(value))?[{time:data[0].time,value:Number(value)},{time:data.at(-1).time,value:Number(value)}]:[])}
function renderLiquidity(d){
  state.liquidity=d;
  const data=d.candles.map(x=>({time:+x.time,open:+x.open,high:+x.high,low:+x.low,close:+x.close}));
  candles.setData(data); highs.setData((d.swings?.highs||[]).map(x=>({time:+x.time,value:+x.price}))); lows.setData((d.swings?.lows||[]).map(x=>({time:+x.time,value:+x.price})));
  const sig=d.signal||{},p=d.tradePlan;
  $('signalValue').textContent=sig.direction||'WAIT'; $('signalValue').className='signal-value '+(sig.direction==='BUY'?'buy':sig.direction==='SELL'?'sell':'wait');
  $('signalMeta').textContent=sig.time?`${time(sig.time)} · ${sig.rejection||'Server confirmed'}`:'No active confirmed setup';
  $('probability').textContent=`${sig.probability||0}%`; $('score').textContent=sig.score??'—'; $('price').textContent=fmt(d.market?.price); $('atr').textContent=fmt(d.diagnostics?.atr);
  $('planState').textContent=p?`${sig.direction} · risk ${fmt(p.risk)}`:(sig.rejection?'Rejected: '+sig.rejection:'No active trade');
  $('entry').textContent=p?fmt(p.entry):'—'; $('sl').textContent=p?fmt(p.stopLoss):'—'; $('tp1').textContent=p?fmt(p.tp1):'—'; $('tp2').textContent=p?fmt(p.tp2):'—'; $('tp3').textContent=p?fmt(p.tp3):'—'; $('risk').textContent=p?fmt(p.risk):'—';
  const diag=d.diagnostics||{};
  $('diagnostics').innerHTML=[['Latest price',fmt(diag.latestPrice)],['Swing high',fmt(diag.latestSwingHigh)],['Swing low',fmt(diag.latestSwingLow)],['Latest sweep',diag.latestSweep||'NONE'],['Confirmation',diag.confirmation||'NONE'],['Volume',diag.volumeAvailable?(diag.volumeConfirmed?'Confirmed':'Available / not strong'):'Unavailable'],['Risk filter',diag.riskFilter?.passed?'PASSED':(diag.riskFilter?.rejected?'REJECTED':'WAIT')]].map(([k,v])=>`<div><span>${k}</span><strong>${v}</strong></div>`).join('');
  ['entry','sl','tp1','tp2','tp3'].forEach(k=>window[k+'Line']&&window[k+'Line'].setData([]));
  chart.timeScale().fitContent(); $('lastUpdate').textContent=time(d.market?.lastCandleTime);
}
function renderHistory(h){
  state.history=h; const s=h.summary||{}; const total=Number(s.totalTrades||0),wins=Number(s.wins||0),losses=Number(s.losses||0),r=Number(s.totalR||0);
  $('historySummary').textContent=`${total} trades · ${wins} WIN · ${losses} LOSS · ${s.winRate||0}% win rate · ${r>=0?'+':''}${r.toFixed(2)}R`;
  $('historyTable').innerHTML=(h.trades||[]).slice(0,50).map(t=>`<div class="history-row"><span>${time(t.signalTime)}</span><strong class="${t.direction==='BUY'?'buy':'sell'}">${t.direction}</strong><strong class="${t.result==='WIN'?'win':t.result==='LOSS'?'loss':'open'}">${t.result}</strong><span>${fmt(t.entry)} → ${fmt(t.exit)}</span></div>`).join('')||'<div class="summary">No confirmed trades.</div>';
}
async function load(){
  const f=state.interval; $('statusText').textContent=`Loading XAU/USD ${f}…`; $('statusDot').style.background='#d9a441';
  try{
    const [lr,hr]=await Promise.all([fetch(`/api/liquidity?interval=${f}&outputsize=300`,{cache:'no-store'}),fetch(`/api/history?interval=${f}`,{cache:'no-store'})]);
    const [d,h]=await Promise.all([lr.json(),hr.json()]); if(!d.success)throw Error(d.error||'Liquidity API error'); if(!h.success)throw Error(h.error||'History API error');
    renderLiquidity(d); renderHistory(h); $('statusText').textContent=`Live · ${f} · ${new Date().toLocaleTimeString()}`; $('statusDot').style.background='#36d69a';
  }catch(e){$('statusText').textContent='Error: '+e.message;$('statusDot').style.background='#ff687b';}
}
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.interval=b.dataset.interval;load()}));
$('refreshBtn').addEventListener('click',load);
initChart(); load(); setInterval(load,60000);
