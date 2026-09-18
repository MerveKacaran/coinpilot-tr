'use strict';
// Navigation starts at the top; price/analysis polling must not move the reader.
if ('scrollRestoration' in window.history) window.history.scrollRestoration='manual';
const byId = id => document.getElementById(id);
const catalog = [['daily','Günlük'],['four_hour','4 Saat'],['one_hour','1 Saat'],['fifteen_minute','15 Dakika'],['five_minute','5 Dakika']];
const keys = {positions:'coinpilot-pro-positions',history:'coinpilot-pro-history',frames:'coinpilot-pro-timeframes',favorites:'coinpilot-pro-favorites'};
const brokenStorage = new Set();
function load(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value === null ? fallback : value; }
  catch (_) { brokenStorage.add(key); return fallback; }
}
function arrayLoad(key) { const value=load(key,[]); if (Array.isArray(value)) return value; brokenStorage.add(key); return []; }
const validFrames = value => catalog.map(x=>x[0]).filter(k=>Array.isArray(value) && value.includes(k));
const state = {quotes:{},signals:[],positions:arrayLoad(keys.positions),history:arrayLoad(keys.history),favorites:arrayLoad(keys.favorites),
  frames:validFrames(load(keys.frames,['one_hour'])),selected:null,marketSymbol:null,marketAnalysis:null,scope:'25',alerts:[],alertStates:new Map(),scanStates:new Map(),closing:new Set(),page:'home'};
if (!state.frames.length) state.frames=['one_hour'];
const exitCache=new Map();
let exitBusy=false;
const notificationCooldowns=new Map(),positionPnlSamples=new Map();
const soundKey='coinpilot-pro-sound',volumeKey='coinpilot-pro-volume';
let audioContext=null,soundEnabled=load(soundKey,false)===true,lastSoundAt=-Infinity;
let soundVolume=Math.min(100,Math.max(10,Number(load(volumeKey,70))||70));
const baseTitle=document.title,unread={buy:0,sell:0,warning:0,info:0};
const notificationKinds={buy:{label:'AL SİNYALİ',color:'#ff7185'},sell:{label:'SAT SİNYALİ',color:'#49dfae'},warning:{label:'RİSK UYARISI',color:'#ffd166'},info:{label:'BİLDİRİM',color:'#83aaff'}};
const num = x => typeof x === 'number' && Number.isFinite(x);
const positive = x => num(x) && x>0;
const currency = new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:6});
const money = x => num(x) ? currency.format(x) : '—';
const pct = x => num(x) ? (x>=0?'+':'')+x.toFixed(2)+'%' : '—';
const timeText = x => x && Number.isFinite(new Date(x).getTime()) ? new Date(x).toLocaleString('tr-TR') : '—';
const frameName = key => catalog.find(x=>x[0]===key)?.[1] || key;
const symbolOf = p => typeof p.coin === 'string' ? p.coin : p.coin?.symbol;
function canonical(raw) { let s=String(raw || '').toUpperCase().replace(/[ /_-]/g,''); if (!s.endsWith('TRY')) s+='TRY'; return /^[A-Z0-9]{1,17}TRY$/.test(s) ? s.slice(0,-3)+'/TRY' : ''; }
function el(tag,cls,text) { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; }
function btn(text,cls,fn) {const n=el('button',cls,text);n.type='button';n.addEventListener('click',fn);return n;}
function notice(text) {byId('notice').textContent=text;byId('notice').classList.toggle('hidden',!text);}
function store(key,value) {if(brokenStorage.has(key))throw Error('Tarayıcıdaki kayıt okunamadı; üzerine yazılmadı. Önce ham yedeği indir.');localStorage.setItem(key,JSON.stringify(value));}
function savePortfolio(positions,history) {
  if (brokenStorage.has(keys.positions)||brokenStorage.has(keys.history))throw Error('Kayıt sorunu var; önce ham yedeği indir. Portföy değiştirilmedi.');
  const oldPositions=localStorage.getItem(keys.positions),oldHistory=localStorage.getItem(keys.history);
  try {store(keys.positions,positions);store(keys.history,history);} catch(err) {
    try {oldPositions===null?localStorage.removeItem(keys.positions):localStorage.setItem(keys.positions,oldPositions);oldHistory===null?localStorage.removeItem(keys.history):localStorage.setItem(keys.history,oldHistory);} catch (_) {notice('Tarayıcı depolaması dolu veya kullanılamıyor. Yedek indir.');}
    throw err;
  }
  state.positions=positions;state.history=history;
  for(const id of positionPnlSamples.keys())if(!positions.some(p=>p.id===id))positionPnlSamples.delete(id);
  window.dispatchEvent(new Event('portfolio-updated'));
}
function validatePosition(p) {return p && ['string','number'].includes(typeof p.id) && String(p.id).length<150 && canonical(symbolOf(p))===symbolOf(p) && ['amount','quantity','entry'].every(k=>positive(p[k])) && (p.stop===null || positive(p.stop)&&p.stop<p.entry) && (p.target===null || positive(p.target)&&p.target>p.entry) && [p.fee??0,p.slippage??0].every(x=>num(x)&&x>=0&&x<=.05);}
function validateHistory(p) {return p && typeof p.coin==='string' && canonical(p.coin)===p.coin && positive(p.entry)&&positive(p.exit)&&num(p.percent)&&typeof p.date==='string'&&p.date.length<100 && (p.pnl===undefined||num(p.pnl));}
if (!state.positions.every(validatePosition)) {brokenStorage.add(keys.positions);state.positions=state.positions.filter(validatePosition);}
if (!state.history.every(validateHistory)) {brokenStorage.add(keys.history);state.history=state.history.filter(validateHistory);}
state.favorites=state.favorites.filter(s=>typeof s==='string'&&canonical(s)===s);
async function api(path, params={}, timeout=45000) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try {const response=await fetch(path+'?'+new URLSearchParams(params),{signal:controller.signal,cache:'no-store'});const data=await response.json();if(!response.ok || data.status==='error')throw Error(data.message||'Veri alınamadı.');return data;}
  catch(err) {if(err.name==='AbortError')throw Error('Veri isteği zaman aşımına uğradı; yeniden dene.');throw err;} finally {clearTimeout(timer);}
}
function rememberQuote(coin) {const old=state.quotes[coin.symbol];if(!old || Date.parse(coin.price_updated_at)>=Date.parse(old.price_updated_at))state.quotes[coin.symbol]=coin;}
function quoteFor(symbol,fallback) {return state.quotes[symbol] || fallback;}
function isFresh(q) {const age=Date.now()-Date.parse(q?.price_updated_at);return positive(q?.price)&&Number.isFinite(age)&&age>=-5000&&age<=30000;}
function quoteBlock(symbol,fallback) {
  const wrap=el('div');wrap.dataset.quoteSymbol=symbol;
  wrap.append(el('div','price'),el('small','quote-stamp'));
  if(fallback)rememberQuote(fallback);paintQuote(wrap);return wrap;
}
function paintQuote(wrap) {
  const q=quoteFor(wrap.dataset.quoteSymbol);wrap.querySelector('.price').textContent=q ? money(q.price)+' · '+pct(q.change) : 'Fiyat bekleniyor…';
  const stamp=wrap.querySelector('.quote-stamp');stamp.textContent=q ? (isFresh(q)?'Güncel kotasyon':'Son bilinen fiyat · veri gecikmiş')+' · '+timeText(q.price_updated_at)+' · '+q.price_source : 'BtcTurk bağlantısı bekleniyor';stamp.classList.toggle('stale',!isFresh(q));
}
function paintQuotes() {document.querySelectorAll('[data-quote-symbol]').forEach(paintQuote);}
function renderSoundStatus(){
  const ready=audioContext?.state==='running';
  byId('sound-toggle').textContent=soundEnabled?'SESİ KAPAT':'SESLİ BİLDİRİMLERİ AÇ';
  byId('sound-toggle').setAttribute('aria-pressed',String(soundEnabled));
  byId('sound-resume').classList.toggle('hidden',!soundEnabled||ready);
  byId('sound-test').disabled=!soundEnabled;
  byId('sound-volume').value=soundVolume;byId('sound-volume-value').textContent='%'+soundVolume;
  byId('sound-status').textContent=!soundEnabled?'Ses kapalı; yazılı bildirimler devam eder.':ready?'Ses açık · tercihin bu tarayıcıda kayıtlı. Toplu uyarılarda ses en sık 8 saniyede bir çalar.':'Ses tercihin açık ve kayıtlı. Tarayıcı sesi başlatmak için bir dokunuş bekliyor; SESİ ETKİNLEŞTİR düğmesine basabilirsin.';
}
async function enableAudio(test=false){
  if(!soundEnabled)return;
  try{
    const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('Bu tarayıcı sesli bildirimi desteklemiyor.');
    if(!audioContext){audioContext=new Audio();audioContext.addEventListener('statechange',renderSoundStatus);}
    renderSoundStatus();await audioContext.resume();renderSoundStatus();
    if(test&&soundEnabled)playAlertSound(true);
  }catch(e){renderSoundStatus();byId('sound-status').textContent=e.message+' Ses tercihin korundu; yazılı bildirimler devam ediyor.';}
}
function playAlertSound(test=false){
  if(!soundEnabled||!audioContext||audioContext.state!=='running')return false;
  if(!test&&Date.now()-lastSoundAt<8000)return false;
  try{const start=audioContext.currentTime;[660,880,660,990].forEach((frequency,i)=>{const oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),at=start+i*.24;oscillator.type='triangle';oscillator.frequency.value=frequency;gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.3*soundVolume/100,at+.025);gain.gain.setValueAtTime(.3*soundVolume/100,at+.12);gain.gain.exponentialRampToValueAtTime(.001,at+.22);oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start(at);oscillator.stop(at+.23);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};});lastSoundAt=Date.now();return true;}catch(_){byId('sound-status').textContent='Ses çalınamadı; tarayıcının ses iznini kontrol et. Yazılı bildirimler devam ediyor.';return false;}
}
async function toggleSound(){
  soundEnabled=!soundEnabled;try{store(soundKey,soundEnabled);}catch(e){notice('Ses tercihi kaydedilemedi: '+e.message);}
  renderSoundStatus();if(soundEnabled)await enableAudio(true);
}
function updateTabIndicator(clear=false){
  if(clear)Object.keys(unread).forEach(k=>unread[k]=0);
  const active=Object.keys(unread).filter(k=>unread[k]>0),total=Object.values(unread).reduce((a,b)=>a+b,0);
  document.title=total?active.map(k=>({buy:'🔴 AL',sell:'🟢 SAT',warning:'🟡 RİSK',info:'🔵'}[k])+' '+unread[k]).join(' · ')+' | '+baseTitle:baseTitle;
  const dots=active.length?active.map((k,i)=>'<circle cx="'+(active.length===1?16:8+(i%2)*16)+'" cy="'+(active.length===1?16:8+Math.floor(i/2)*16)+'" r="7" fill="'+notificationKinds[k].color+'"/>').join(''):'<path d="M8 22V10h16M8 22l8-8 8 4" fill="none" stroke="#83aaff" stroke-width="3"/>';
  byId('app-favicon').href='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0b182a"/>'+dots+'</svg>');
}
function openNotification(symbol){updateTabIndicator(true);analyzeMarket(symbol);}
function notificationBody(message,symbol){
  if(!symbol)return el('span','',message);
  const action=btn(message+' →','notification-link',()=>openNotification(symbol));
  action.setAttribute('aria-label',message+' · '+symbol+' analizine git');return action;
}
function showNotification(message,kind='info',symbol=null){
  if(!notificationKinds[kind])kind='info';
  const host=byId('notification-toasts'),toast=el('article','notification-toast tone-'+kind);
  toast.setAttribute('role','status');toast.append(el('small','',notificationKinds[kind].label+' · '+new Date().toLocaleTimeString('tr-TR')),notificationBody(message,symbol));
  const close=btn('×','dismiss-toast',()=>toast.remove());close.setAttribute('aria-label','Bildirimi kapat');toast.append(close);host.prepend(toast);while(host.children.length>3)host.lastElementChild.remove();setTimeout(()=>toast.remove(),10000);
  if(document.hidden){unread[kind]++;updateTabIndicator();}playAlertSound();
}
function alertOnce(key,status,message,kind='info') {const prev=state.alertStates.get(key);state.alertStates.set(key,status);if(!status||status===prev||!byId('alerts-enabled').checked)return;const cooldownKey=key+'|'+status,now=Date.now();if(now-(notificationCooldowns.get(cooldownKey)??-Infinity)<90000)return;notificationCooldowns.set(cooldownKey,now);for(const[k,at]of notificationCooldowns)if(now-at>600000)notificationCooldowns.delete(k);const symbol=message.match(/^([A-Z0-9]{1,17}\/TRY)(?=\s|$)/)?.[1]||null;state.alerts.unshift({at:new Date().toISOString(),message,kind,symbol});state.alerts=state.alerts.slice(0,30);renderAlerts();showNotification(message,kind,symbol);}
function notifyHighBuy(s){const eligible=s.score>=90&&(s.action==='GÜÇLÜ AL'||s.action==='AL İZLE')&&s.can_open_trade&&isFresh(quoteFor(s.coin.symbol,s.coin));alertOnce('high-buy:'+s.coin.symbol+'|'+s.frame_keys.join(','),eligible?'high-buy':'',s.coin.symbol+' · '+s.action+' · '+s.score+'/100 teknik puan. Bu puan kazanç olasılığı değildir.','buy');}
function notifyPositionLoss(p,result,q){if(!isFresh(q)||!num(result))return;const previous=positionPnlSamples.get(p.id);positionPnlSamples.set(p.id,result);if(previous!==undefined)alertOnce('net-loss:'+p.id,result<0?'negative':'',symbolOf(p)+' · Sanal pozisyon net zarara geçti: '+pct(result),'warning');else state.alertStates.set('net-loss:'+p.id,result<0?'negative':'');for(const threshold of [2,5])alertOnce('loss-level:'+p.id+':'+threshold,result<=-threshold?'below':'',symbolOf(p)+' · Sanal pozisyon net zararı %'+threshold+' eşiğine ulaştı: '+pct(result),'warning');}
function renderAlerts(){byId('alerts-list').replaceChildren(...(state.alerts.length?state.alerts.map(a=>{const n=el('div','alert-item tone-'+(a.kind||'info'));n.append(el('time','',timeText(a.at)),notificationBody(a.message,a.symbol));return n;}):[el('p','muted','Yeni uyarı yok.')]));}
function scrollPageTop(){window.scrollTo({top:0,left:0,behavior:'instant'});}
function openDialogAtTop(dialog){if(!dialog.open)dialog.showModal();dialog.scrollTop=0;requestAnimationFrame(()=>{if(dialog.open)dialog.scrollTop=0;});}
function switchPage(page) {state.page=page;document.querySelectorAll('.page').forEach(n=>n.classList.toggle('active',n.id==='page-'+page));document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.page===page));byId('title').textContent={home:'Bugün ne yapmalıyım?',radar:'Teknik radar',market:'Piyasa hareketi',positions:'Sanal portföyüm',exits:'Satış takibi'}[page];byId('page-label').textContent='COINPILOT TR';byId('sidebar').classList.remove('open');if(page==='exits'){renderExitTracking();loadExitChecks();}scrollPageTop();requestAnimationFrame(()=>{redrawAll();scrollPageTop();});}
function syncFrames(){byId('timeframe-controls').replaceChildren(...catalog.map(([key,name])=>{const label=el('label');const input=el('input');input.type='checkbox';input.value=key;input.checked=state.frames.includes(key);label.append(input,document.createTextNode(name));return label;}));const label='Etkin: '+state.frames.map(frameName).join(' · ');byId('timeframe-summary').textContent=label;byId('market-frames').textContent=label;}
function favoriteButton(symbol){const b=btn('', 'favorite',()=>{state.favorites=state.favorites.includes(symbol)?state.favorites.filter(s=>s!==symbol):[...state.favorites,symbol];try{store(keys.favorites,state.favorites);}catch(e){notice(e.message);}renderFavorites();document.querySelectorAll('[data-favorite]').forEach(n=>{n.textContent=(state.favorites.includes(n.dataset.favorite)?'★ Takipte':'☆ Takip et');});});b.dataset.favorite=symbol;b.textContent=state.favorites.includes(symbol)?'★ Takipte':'☆ Takip et';return b;}
function renderFavorites(){byId('favorites').replaceChildren(...state.favorites.map(s=>btn('★ '+s,'favorite',()=>analyzeMarket(s))));}
function detailFrame(frame){const box=el('section','detail-frame');box.append(el('b',frame.core_pass?'positive':'',frame.name+' · '+frame.checks_passed+'/5'));const list=el('ul','check-list');frame.checks.forEach(c=>{const row=el('li');row.append(el('b',c.ok?'positive':'negative',(c.ok?'✓ ':'✕ ')+c.label+' · '+Number(c.value).toLocaleString('tr-TR',{maximumFractionDigits:5})),el('span','',c.reason));list.append(row);});box.append(list,el('p','muted','Son kapanış: '+timeText(frame.closed_at*1000)+'\nDüşen trend kırılımı: '+(frame.trend_break?'var':'yok')+' · Retest: '+(frame.retest?'var':'yok')));return box;}
function signalCard(s){
  const kind=s.sell_setup?'sell':s.can_open_trade?'buy':'wait';
  const card=el('article','signal signal-'+kind),head=el('div','signal-header'),title=el('div');title.append(el('h3','',s.coin.symbol),quoteBlock(s.coin.symbol,s.coin));
  head.append(title,el('span','badge signal-badge-'+kind,s.action+' · '+s.score+'/100'));card.append(head);
  card.append(el('small','analysis-stamp','Analiz: '+timeText(s.analyzed_at)+' · kapanmış mum · analiz fiyatı '+money(s.coin.price)));
  const content=el('div','signal-content'),radar=el('canvas','radar-canvas'),frames=el('div','frame-list');
  radar.setAttribute('aria-label','Teknik koşul uyum radarı');radar.setAttribute('role','img');content.append(radar,frames);
  Object.entries(s.frames).forEach(([key,f])=>{const row=btn('', 'frame '+(f.core_pass?'ok':f.checks_passed>=3?'candidate':''),()=>showDetail(s,key));row.append(el('b','',f.name),el('span','tag',f.checks_passed+'/5 · DETAY'));frames.append(row);});
  frames.append(el('div','fib-note','Fib 0,618–0,786: '+money(s.fib['786'])+' – '+money(s.fib['618'])));card.append(content);
  const line=el('canvas','line-canvas');line.setAttribute('aria-label',frameName(s.chart_frame)+' kapanış fiyatları');card.append(line);
  const metrics=el('div','signal-metrics');[['Hedef (analiz anı)',pct(s.target_pct)],['Stop mesafesi',num(s.stop_pct)?pct(-s.stop_pct):'Belirlenemedi'],['Getiri / risk',num(s.risk_reward)?s.risk_reward.toFixed(2):'—'],[frameName(s.chart_frame)+' hacim','×'+s.frames[s.chart_frame].volume_ratio.toFixed(2)]].forEach(([name,value])=>{const n=el('div');n.append(el('span','',name),el('b','',value));metrics.append(n);});card.append(metrics);
  card.append(el('p','summary-text',s.summary.join(' ')),el('p','muted',s.risk_ok?'Stop / hedef mesafesi filtresi uygun.':'Hedef/stop planı yok veya stop %8 sınırını aşıyor.'));
  const actions=el('div','signal-actions'),trade=btn('SANAL İŞLEM AÇ','',()=>openTrade(s));actions.append(btn('GRAFİK & DETAY','detail',()=>showDetail(s)),trade,favoriteButton(s.coin.symbol));card.append(actions);
  bindCanvas(radar,()=>drawRadar(radar,s));bindCanvas(line,()=>drawLine(line,s.chart));return card;
}
const canvases=new Map();
const resizeObserver=new ResizeObserver(entries=>entries.forEach(({target})=>canvases.get(target)?.()));
function bindCanvas(canvas,draw){canvases.set(canvas,draw);resizeObserver.observe(canvas);requestAnimationFrame(draw);}
function redrawAll(){for(const [canvas,draw] of canvases){if(!canvas.isConnected){resizeObserver.unobserve(canvas);canvases.delete(canvas);}else draw();}}
function fitCanvas(canvas){const r=canvas.getBoundingClientRect();if(r.width<4||r.height<4)return null;const ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(r.width*ratio);canvas.height=Math.round(r.height*ratio);const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);return{ctx,w:r.width,h:r.height};}
function path(ctx,points,color,fill){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.strokeStyle=color;ctx.lineWidth=1.5;if(fill){ctx.closePath();ctx.fillStyle=fill;ctx.fill();}ctx.stroke();}
function drawRadar(canvas,s){const v=fitCanvas(canvas);if(!v)return;const{ctx,w,h}=v,labels=[...s.frame_keys.map(frameName),'Trend','Fib'],values=s.radar,n=values.length,cx=w/2,cy=h/2,r=Math.min(w,h)*.31;const point=(i,a)=>[cx+Math.cos(-Math.PI/2+i*2*Math.PI/n)*r*a,cy+Math.sin(-Math.PI/2+i*2*Math.PI/n)*r*a];[.33,.66,1].forEach(a=>path(ctx,values.map((_,i)=>point(i,a)).concat([point(0,a)]),'#2f4968'));path(ctx,values.map((a,i)=>point(i,a)),'#70a1ff','#70a1ff33');ctx.fillStyle='#92a4bf';ctx.font='8px system-ui';ctx.textAlign='center';labels.forEach((t,i)=>{const[x,y]=point(i,1.3);ctx.fillText(t,x,Math.max(9,Math.min(h-2,y)));});}
function drawLine(canvas,data){const v=fitCanvas(canvas);if(!v||data.length<2)return;const{ctx,w,h}=v,low=Math.min(...data),span=Math.max(...data)-low||low*.001;path(ctx,data.map((p,i)=>[5+i*(w-10)/(data.length-1),h-8-(p-low)/span*(h-16)]),'#70a1ff');}
function chartPanel(s,initial){
  const box=el('section','chart-panel'),controls=el('div','controls-row'),label=el('label','','Grafik periyodu'),select=el('select');Object.keys(s.frames).forEach(k=>{const o=el('option','',frameName(k));o.value=k;select.append(o);});select.value=initial||s.chart_frame;label.append(select);
  const rangeLabel=el('label','','Görünen mum sayısı'),range=el('input');range.type='range';range.min=30;range.max=120;range.value=70;rangeLabel.append(range);const scaleLabel=el('label','','Fiyat ölçeği'),scale=el('select');[['price','Mumlar ve EMA'],['levels','Hedef / stop dahil']].forEach(([key,text])=>{const o=el('option','',text);o.value=key;scale.append(o);});scaleLabel.append(scale);controls.append(label,rangeLabel,scaleLabel);
  const readout=el('div','chart-readout','Mum üzerinde gezerek fiyatları incele.'),canvas=el('canvas');canvas.setAttribute('aria-label','Mum grafiği, EMA200, RSI10, MACD ve Fisher30');canvas.setAttribute('role','img');
  box.append(controls,el('p','chart-legend','Mumlar: kapanmış veriler · Mavi EMA200 · Mor EMA8 · Sarı Fib 0,618/0,786 · Yeşil hedef · Kırmızı stop. Hedef/stop ve Fib planı: '+frameName(s.levels_frame)+'. Ölçek dışındaki seviyeler için “Hedef / stop dahil” seç. Alt paneller: RSI10, MACD ve Fisher30.'),canvas,readout);
  let visible=[];
  function draw(){const v=fitCanvas(canvas);if(!v)return;const{ctx,w,h}=v;visible=s.frames[select.value].chart.slice(-Number(range.value));if(!visible.length)return;const left=14,right=w<450?64:85,width=w-left-right,x=i=>left+(i+.5)*width/visible.length;const plot=(keys,top,height,forced,levels=[])=>{const vals=visible.flatMap(p=>keys.map(k=>p[k])).filter(num).concat(levels.map(l=>l[1]).filter(num));let low=forced?forced[0]:Math.min(...vals),high=forced?forced[1]:Math.max(...vals);const pad=(high-low||Math.abs(high)*.01||1)*.07;if(!forced){low-=pad;high+=pad;}const y=p=>top+height-(p-low)/(high-low)*height;ctx.font='10px system-ui';ctx.textAlign='left';for(let j=0;j<4;j++){const value=low+(high-low)*j/3,yy=y(value);path(ctx,[[left,yy],[w-right,yy]],'#1b304a');ctx.fillStyle='#92a4bf';ctx.fillText(value.toLocaleString('tr-TR',{maximumSignificantDigits:5}),w-right+5,yy+3);}return y;};
    const mainHeight=h*.48,levels=[['Fib .618',s.fib['618'],'#ffc857'],['Fib .786',s.fib['786'],'#ffc857'],['Hedef',s.target,'#1fd49a'],['Stop',s.stop,'#ff6478']];const y=plot(['high','low','ema','ema8'],15,mainHeight,null,scale.value==='levels'?levels:[]);
    visible.forEach((p,i)=>{const color=p.close>=p.open?'#1fd49a':'#ff6478';path(ctx,[[x(i),y(p.high)],[x(i),y(p.low)]],color);ctx.fillStyle=color;ctx.fillRect(x(i)-Math.max(1,width/visible.length*.32),Math.min(y(p.open),y(p.close)),Math.max(2,width/visible.length*.64),Math.max(1,Math.abs(y(p.open)-y(p.close))));});
    path(ctx,visible.map((p,i)=>[x(i),y(p.ema)]),'#70a1ff');if(visible.every(p=>num(p.ema8)))path(ctx,visible.map((p,i)=>[x(i),y(p.ema8)]),'#c99aff');levels.forEach(([label,value,color])=>{if(!num(value)||y(value)<15||y(value)>15+mainHeight)return;ctx.setLineDash([4,4]);path(ctx,[[left,y(value)],[w-right,y(value)]],color);ctx.setLineDash([]);ctx.fillStyle=color;ctx.fillText(label,left+2,y(value)-3);});
    const panelHeight=h*.115;[['RSI10',['rsi'],[0,100]],['MACD',['macd','macd_signal'],null],['Fisher30',['fisher','fisher_signal'],null]].forEach(([name,fields,forced],index)=>{const top=h*.56+index*h*.14,py=plot(fields,top,panelHeight,forced,forced?[]:[['Sıfır',0]]);ctx.fillStyle='#bed2f1';ctx.fillText(name,left,top-4);if(name==='RSI10'){ctx.setLineDash([3,3]);path(ctx,[[left,py(50)],[w-right,py(50)]],'#ffc857');ctx.setLineDash([]);}else{path(ctx,[[left,py(0)],[w-right,py(0)]],'#5a6e88');}fields.forEach((field,k)=>path(ctx,visible.map((p,i)=>[x(i),py(p[field])]),k?'#ff6478':'#70a1ff'));});
    ctx.fillStyle='#92a4bf';ctx.fillText(new Date(visible[0].time*1000).toLocaleString('tr-TR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}),left,h-3);ctx.textAlign='right';ctx.fillText(new Date(visible.at(-1).time*1000).toLocaleString('tr-TR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}),w-right,h-3);
  }
  canvas.addEventListener('pointermove',e=>{const rect=canvas.getBoundingClientRect(),i=Math.max(0,Math.min(visible.length-1,Math.floor((e.clientX-rect.left-14)/(rect.width-14-(rect.width<450?64:85))*visible.length))),p=visible[i];if(p)readout.textContent=timeText(p.time*1000)+' · A '+money(p.open)+' · Y '+money(p.high)+' · D '+money(p.low)+' · K '+money(p.close)+' · Hacim '+p.volume.toLocaleString('tr-TR');});
  select.addEventListener('change',draw);range.addEventListener('input',draw);scale.addEventListener('change',draw);bindCanvas(canvas,draw);return box;
}
function backtestPanel(s){const box=el('section','test-panel');box.append(el('h3','','Geçmiş performans kontrolü'),el('p','muted','Tek periyot, sınırlı geçmiş; optimizasyon veya başarı garantisi değildir. Radarın çoklu-periyot filtresinin tamamını test etmez.'));const controls=el('div','controls-row');const select=el('select');catalog.forEach(([key,name])=>{const o=el('option','',name);o.value=key;select.append(o);});select.value=s.chart_frame;const frameLabel=el('label','','Test periyodu');frameLabel.append(select);controls.append(frameLabel);const inputs={};[['fee','Komisyon / yön (%)'],['slippage','Kayma / yön (%)']].forEach(([key,text])=>{const l=el('label','',text),input=el('input');input.type='number';input.value='0.10';input.min='0';input.max='5';input.step='.01';l.append(input);inputs[key]=input;controls.append(l);});const result=el('div','test-result');const run=btn('GEÇMİŞİ TEST ET','',async()=>{run.disabled=true;result.textContent='Kapanmış mumlar üzerinde hesaplanıyor…';try{if(!Object.values(inputs).every(i=>i.value!==''&&i.checkValidity()))throw Error('Maliyetler %0–5 arasında olmalı.');const d=await api('/api/backtest',{symbol:s.coin.symbol,frame:select.value,fee:inputs.fee.value,slippage:inputs.slippage.value},90000),r=d.result;result.textContent=frameName(d.frame)+' · '+r.bars+' test mumu · '+timeText(r.from_time*1000)+' – '+timeText(r.to_time*1000)+'\nİşlem: '+r.trade_count+' · Net getiri: '+pct(r.net_return_pct)+' · Kazanma: '+(num(r.win_rate)?r.win_rate.toFixed(1)+'%':'İşlem yok')+'\nMaksimum düşüş: '+r.max_drawdown_pct.toFixed(2)+'% · Kâr faktörü: '+(num(r.profit_factor)?r.profit_factor.toFixed(2):'Hesaplanamadı (zarar/işlem yok)')+'\n'+(r.trade_count<30?'Düşük örneklem: sonuç istatistiksel olarak güvenilir kabul edilmemeli.\n':'')+r.note;}catch(e){result.textContent=e.message;}finally{run.disabled=false;}});box.append(controls,run,result);return box;}
function showDetail(s,frame){const box=byId('detail-content');box.replaceChildren(el('small','','TEKNİK ANALİZ · KOŞUL PUANI OLASILIK DEĞİLDİR'),el('h2','',s.coin.symbol+' · '+s.action),quoteBlock(s.coin.symbol,s.coin),el('p','muted','Analiz zamanı: '+timeText(s.analyzed_at)),chartPanel(s,frame));const grid=el('div','detail-grid');(frame?[s.frames[frame]]:Object.values(s.frames)).forEach(f=>grid.append(detailFrame(f)));box.append(grid,el('p','summary-text',s.summary.join(' ')),el('p','muted','Hedef '+money(s.target)+' · Stop '+money(s.stop)+' · Destek '+money(s.fib.support)+' · Direnç '+money(s.fib.resistance)),backtestPanel(s));openDialogAtTop(byId('detail-dialog'));requestAnimationFrame(redrawAll);}
function renderRadar(scanning=false){byId('radar-grid').replaceChildren(...(state.signals.length?state.signals.map(signalCard):[el('div','panel empty',scanning?'Tarama sürüyor; sonuçlar geldikçe burada görünecek.':'Seçilen kapsamda en az 3/5 koşulu sağlayan aday yok.')]));byId('home-radar').replaceChildren(...(state.signals.length?state.signals.slice(0,3).map(s=>{const c=el('article','panel compact-signal');c.append(btn(s.coin.symbol,'link',()=>showDetail(s)),quoteBlock(s.coin.symbol,s.coin),el('p','summary-text',s.summary.join(' ')));return c;}):[el('p','muted',scanning?'Radar taranıyor…':'Bu taramada aday yok.')]));byId('setup-count').textContent=state.signals.length;state.signals.forEach(notifyHighBuy);redrawAll();}
let radarTimer, radarGeneration=0;
async function loadRadar(force=false,generation=radarGeneration){clearTimeout(radarTimer);if(state.scope==='favorites'&&!state.favorites.length){state.signals=[];renderRadar();byId('radar-time').textContent='Takip listene önce bir coin ekle.';return;}const params={frames:state.frames.join(','),limit:state.scope==='favorites'?'250':state.scope};if(state.scope==='favorites')params.symbols=state.favorites.join(',');if(force)params.force='1';byId('scan-button').disabled=true;
  let delay=60000;try{const d=await api('/api/radar',params);if(generation!==radarGeneration)return;state.signals=d.items||[];for(const s of state.signals){const key=s.coin.symbol+':'+state.frames.join(','),value=Object.values(s.frames).map(f=>f.checks_passed).join('/'),previous=state.scanStates.get(key);if(previous!==undefined&&previous!==value)alertOnce('scan:'+key,value,s.coin.symbol+' teyit değişimi: '+previous+' → '+value);state.scanStates.set(key,value);}renderRadar(d.scanning);byId('radar-time').textContent=(d.scanning?'Taranıyor: ':'Tamamlandı: ')+d.scanned+'/'+d.total+' parite · '+state.signals.length+' aday'+(d.updated_at?' · '+timeText(d.updated_at):'');byId('scan-errors').textContent=d.error||((d.errors||[]).length?'Verisi alınamayan '+d.errors.length+' parite: '+d.errors.map(x=>x.symbol+' ('+x.message+')').join(' · '):'');delay=d.scanning?2000:60000;}catch(e){if(generation===radarGeneration){byId('radar-time').textContent=e.message+' Sonraki deneme otomatik.';delay=10000;}}finally{if(generation===radarGeneration){byId('scan-button').disabled=false;radarTimer=setTimeout(()=>loadRadar(false,generation),delay);}}}
let marketGeneration=0, marketBusy=false, marketAt=0;
async function analyzeMarket(raw,background=false){const symbol=canonical(raw);if(!symbol){byId('market-search-message').textContent='Örnek: WIF/TRY';return;}const generation=++marketGeneration;state.marketSymbol=symbol;marketBusy=true;marketAt=Date.now();byId('market-search-input').value=symbol;if(!background){switchPage('market');byId('market-analysis').replaceChildren(quoteBlock(symbol));}byId('market-search-message').textContent=symbol+' analizi hazırlanıyor…';
  try{const d=await api('/api/analyze',{symbol,frames:state.frames.join(',')});if(generation!==marketGeneration)return;state.marketAnalysis=d.item;byId('market-analysis').replaceChildren(signalCard(d.item));notifyHighBuy(d.item);byId('market-search-message').textContent='Fiyat otomatik yenilenir; göstergeler son kapanmış mumdan hesaplanır.';marketAt=Date.now();redrawAll();}catch(e){if(generation===marketGeneration)byId('market-search-message').textContent=e.message;}finally{if(generation===marketGeneration)marketBusy=false;}}
function renderMarket(data){for(const group of ['gainers','losers']){byId(group).replaceChildren(...data[group].map(c=>{const row=btn('','market-row',()=>analyzeMarket(c.symbol));row.append(el('b','',c.symbol),el('span','',money(c.price)),el('strong',c.change>=0?'positive':'negative',pct(c.change)));return row;}));}const symbols=Object.keys(state.quotes).sort(),existing=byId('market-symbols');if(existing.childElementCount!==symbols.length)existing.replaceChildren(...symbols.map(s=>{const o=el('option');o.value=s;return o;}));}
function positionValue(p){const q=quoteFor(symbolOf(p));return q&&positive(q.price)?p.quantity*q.price*(1-(p.slippage||0))*(1-(p.fee||0)):null;}
function renderPortfolio(){let cost=0,value=0,complete=true;for(const p of state.positions){cost+=p.amount;const v=positionValue(p);if(v===null)complete=false;else value+=v;}
  byId('portfolio-value').textContent=complete?money(value):'Fiyat bekleniyor';byId('portfolio-profit').textContent=complete?money(value-cost):'—';byId('portfolio-profit').className=value>=cost?'positive':'negative';byId('portfolio-percent').textContent=complete?pct(cost?(value-cost)/cost*100:0):'—';byId('position-count').textContent=state.positions.length;
  for(const id of ['home-positions','radar-positions','position-page-list']){byId(id).replaceChildren(...(state.positions.length?state.positions.map(positionCard):[el('div','panel empty','Henüz açık sanal işlem yok.')]));}
  byId('history').replaceChildren(...state.history.map(p=>{const row=el('tr');[p.date,p.coin,money(p.entry),money(p.exit),(num(p.pnl)?money(p.pnl)+' · ':'')+pct(p.percent)].forEach((x,i)=>row.append(el('td',i===4?(p.percent>=0?'positive':'negative'):'',x)));return row;}));const known=state.history.filter(p=>num(p.pnl));byId('realized-profit').textContent='Kayıtlı net K/Z: '+money(known.reduce((sum,p)=>sum+p.pnl,0))+(known.length<state.history.length?' · Eski kayıtlarda TL tutarı yok':'');
  renderExitTracking();
}
function positionCard(p){const symbol=symbolOf(p),q=quoteFor(symbol),value=positionValue(p),gain=value===null?null:value-p.amount,result=gain===null?null:gain/p.amount*100,card=el('article','position');card.dataset.positionId=String(p.id);card.append(el('h3','',symbol),quoteBlock(symbol),el('div','levels','Giriş '+money(p.entry)+' · Tutar '+money(p.amount)+' · Adet '+p.quantity.toLocaleString('tr-TR',{maximumFractionDigits:10})),el('b','value '+(gain>=0?'positive':'negative'),money(value)),el('b',gain>=0?'positive':'negative','Tahmini net K/Z: '+money(gain)+' · '+pct(result)),el('div','levels','Hedef '+money(p.target)+' · Stop '+money(p.stop)));
  notifyPositionLoss(p,result,q);
  const progress=q&&positive(p.target)?Math.max(0,Math.min(100,(q.price-p.entry)/(p.target-p.entry)*100)):0,bar=el('div','bar'),fill=el('i');fill.style.width=progress+'%';bar.append(fill);card.append(bar,el('small','',positive(p.target)?'Hedefe ilerleme %'+progress.toFixed(0):'Hedef belirlenmedi; fiyat ve kâr/zarar izleniyor.'));
  let status='İzleniyor',key='';if(isFresh(q)){if(positive(p.stop)&&q.price<=p.stop){status='Stop seviyesi aşıldı';key='stop';}else if(positive(p.target)&&q.price>=p.target){status='Hedef seviyesine ulaştı';key='target';}else if(positive(p.stop)&&q.price<=p.stop*1.01){status='Stop seviyesine %1 mesafede';key='near-stop';}else if(positive(p.target)&&q.price>=p.target*.99){status='Hedefe %1 mesafede';key='near-target';}alertOnce('position:'+p.id,key,symbol+' · '+status);}else status='Fiyat gecikmiş / bekleniyor; değer son kotasyondur.';
  if(p.riskWarning)card.append(el('p','position-status stale','Giriş uyarısı: '+p.riskWarning));
  card.append(el('p','position-status',status));const exitInfo=exitStatus(p);card.append(el('p','position-status '+exitInfo.tone,'Satış takibi: '+exitInfo.label));if(state.page!=='exits')card.append(btn('SATIŞ TAKİBİ','link',()=>switchPage('exits')));const close=btn(state.closing.has(p.id)?'DOĞRULANIYOR…':'SANAL SAT','sell',()=>closePosition(p.id));close.disabled=state.closing.has(p.id);card.append(close);return card;}
let dashboardBusy=false;
async function loadDashboard(){if(dashboardBusy)return;dashboardBusy=true;try{const d=await api('/api/dashboard',{},20000);Object.values(d.quotes).forEach(rememberQuote);byId('live-status').textContent=d.live?'WebSocket · 3 sn ekran yenileme':'REST · fiyat zamanı kontrol edilir';byId('live-dot').classList.toggle('online',d.live);paintQuotes();renderPortfolio();renderMarket(d);if(state.marketSymbol&&!marketBusy&&Date.now()-marketAt>60000)analyzeMarket(state.marketSymbol,true);}catch(e){byId('live-status').textContent='Bağlantı bekleniyor';byId('live-dot').classList.remove('online');paintQuotes();}finally{dashboardBusy=false;}}
function tradeInputs(){const amount=Number(byId('trade-amount').value),fee=Number(byId('trade-fee').value)/100,slip=Number(byId('trade-slip').value)/100;if(!positive(amount)||amount<1||!num(fee)||fee<0||fee>.05||!num(slip)||slip<0||slip>.05)throw Error('Tutar en az 1 TL; maliyetler %0–5 olmalı.');return{amount,fee,slip};}
function tradePlan(s,inputs){const{amount,fee,slip}=inputs,q=s.coin;if(!isFresh(q))throw Error('Güncel fiyat doğrulanamadı; yeniden dene.');const base=positive(q.ask)?q.ask:q.price,entry=base*(1+slip),target=positive(s.target)&&s.target>entry?s.target:null,stop=positive(s.stop)&&s.stop<entry?s.stop:null,risk=stop===null?null:(entry-stop)/entry*100;const quantity=amount/(entry*(1+fee)),atTarget=target===null?null:quantity*target*(1-slip)*(1-fee)-amount,atStop=stop===null?null:quantity*stop*(1-slip)*(1-fee)-amount;const warnings=[];if(!s.all_frames_passed)warnings.push('Seçili periyotlarda 5/5 teyit yok.');if(s.sell_setup)warnings.push('SAT sinyali var.');if(risk!==null&&risk>8)warnings.push('Stop mesafesi %'+risk.toFixed(2)+'; %8 üzerinde.');if(target===null)warnings.push('Geçerli hedef belirlenemedi; hedef takibi olmayacak.');if(stop===null)warnings.push('Geçerli stop belirlenemedi; stop uyarısı olmayacak.');if(atTarget!==null&&atTarget<=0)warnings.push('Hedef getirisi tahmini maliyetleri karşılamıyor.');return{entry,quantity,target,stop,risk,atTarget,atStop,warnings};}
function previewTrade(){if(!state.selected)return;try{const inputs=tradeInputs(),plan=tradePlan(state.selected,inputs);byId('trade-target').textContent=money(plan.target);byId('trade-stop').textContent=money(plan.stop);byId('trade-risk').textContent='Tahmini giriş '+money(plan.entry)+' · Hedefte net '+money(plan.atTarget)+' · Stopta net '+money(plan.atStop)+' · Net getiri/risk '+(num(plan.atTarget)&&num(plan.atStop)?(plan.atTarget/Math.abs(plan.atStop)).toFixed(2):'—');byId('trade-message').textContent=(plan.warnings.length?'⚠ '+plan.warnings.join(' ')+' ':'')+'Sanal işlem açabilirsin; risk uyarıları engel değildir. Son onayda güncel fiyat alınır.';}catch(e){byId('trade-risk').textContent='';byId('trade-message').textContent=e.message;}}
let tradeGeneration=0;
async function openTrade(s){const generation=++tradeGeneration;byId('trade-title').textContent=s.coin.symbol;byId('trade-amount').value='1000';byId('trade-message').textContent='Güncel fiyat ve risk bilgisi alınıyor…';byId('trade-submit').disabled=true;state.selected=null;byId('trade-entry').textContent='';byId('trade-target').textContent='—';byId('trade-stop').textContent='—';byId('trade-risk').textContent='';openDialogAtTop(byId('trade-dialog'));try{const d=await api('/api/analyze',{symbol:s.coin.symbol,frames:s.frame_keys.join(','),fresh:'1'});if(generation!==tradeGeneration||!byId('trade-dialog').open)return;state.selected=d.item;rememberQuote(d.item.coin);byId('trade-entry').textContent='Borsa son fiyatı: '+money(d.item.coin.price)+' · '+timeText(d.item.coin.price_updated_at);byId('trade-target').textContent=money(d.item.target);byId('trade-stop').textContent=money(d.item.stop);byId('trade-submit').disabled=false;previewTrade();}catch(e){if(generation===tradeGeneration)byId('trade-message').textContent=e.message;}}
let submitting=false;
async function submitTrade(event){event.preventDefault();if(submitting||!state.selected)return;submitting=true;byId('trade-submit').disabled=true;try{const inputs=tradeInputs(),selected=state.selected;byId('trade-message').textContent='Giriş fiyatı son kez doğrulanıyor…';const d=await api('/api/analyze',{symbol:selected.coin.symbol,frames:selected.frame_keys.join(','),fresh:'1'}),s=d.item,plan=tradePlan(s,inputs);rememberQuote(s.coin);const p={id:crypto.randomUUID(),coin:{symbol:s.coin.symbol},amount:inputs.amount,quantity:plan.quantity,entry:plan.entry,target:plan.target,stop:plan.stop,riskWarning:plan.warnings.join(' '),extendedTarget:s.extended_target,fee:inputs.fee,slippage:inputs.slip,openedAt:new Date().toISOString(),frames:s.frame_keys};savePortfolio([p,...state.positions],state.history);byId('trade-dialog').close();renderPortfolio();switchPage('home');notice('Sanal pozisyon açıldı. Gerçek borsa emri gönderilmedi.'+(plan.warnings.length?' ⚠ '+plan.warnings.join(' '):''));}catch(e){byId('trade-message').textContent=e.message;}finally{submitting=false;byId('trade-submit').disabled=false;}}
async function closePosition(id){if(state.closing.has(id))return;const p=state.positions.find(x=>x.id===id);if(!p)return;state.closing.add(id);renderPortfolio();try{const d=await api('/api/quote',{symbol:symbolOf(p)}),q=d.coin;if(!isFresh(q))throw Error('Satış için güncel fiyat doğrulanamadı.');rememberQuote(q);const exit=(positive(q.bid)?q.bid:q.price)*(1-(p.slippage||0)),value=p.quantity*exit*(1-(p.fee||0)),pnl=value-p.amount;const history={id:p.id,date:new Date().toLocaleString('tr-TR'),closedAt:new Date().toISOString(),coin:symbolOf(p),entry:p.entry,exit,percent:pnl/p.amount*100,pnl,amount:p.amount,quantity:p.quantity,fee:p.fee||0,slippage:p.slippage||0};savePortfolio(state.positions.filter(x=>x.id!==id),[history,...state.history]);notice('Sanal satış kaydedildi · Net '+money(pnl));}catch(e){notice(e.message+' Pozisyon açık tutuldu.');}finally{state.closing.delete(id);renderPortfolio();}}
function downloadBackup(){const data=brokenStorage.size?{app:'CoinPilot TR recovery',exportedAt:new Date().toISOString(),raw:Object.fromEntries(Object.values(keys).map(k=>[k,localStorage.getItem(k)]))}:{app:'CoinPilot TR',version:1,exportedAt:new Date().toISOString(),positions:state.positions,history:state.history,favorites:state.favorites,frames:state.frames};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='coinpilot-yedek-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);byId('backup-message').textContent=brokenStorage.size?'Ham kurtarma yedeği indirildi. Bozuk kayıtları silmeden incelemek gerekir.':'Yedek indirildi. Dosya portföy bilgilerini içerir; güvenli sakla.';}
function historyId(p){return p.id!==undefined?'id:'+String(p.id):'legacy:'+JSON.stringify([p.date,p.coin,p.entry,p.exit,p.percent]);}
function parseBackup(text){const data=JSON.parse(text);if(data.app!=='CoinPilot TR'||data.version!==1||!Array.isArray(data.positions)||!Array.isArray(data.history)||!Array.isArray(data.favorites)||!Array.isArray(data.frames))throw Error('Uyumlu CoinPilot TR yedeği değil.');if(data.positions.length+data.history.length>10000||!data.positions.every(validatePosition)||!data.history.every(validateHistory)||!data.favorites.every(s=>typeof s==='string'&&canonical(s)===s)||validFrames(data.frames).length!==data.frames.length||!data.frames.length)throw Error('Yedekte geçersiz değer var; hiçbir kayıt değiştirilmedi.');return data;}
async function importBackup(file){if(!file)return;try{if(file.size>2*1024*1024)throw Error('Yedek en fazla 2 MB olabilir.');if(brokenStorage.size)throw Error('Önce mevcut bozuk kayıtların ham yedeğini indir; içe aktarma güvenlik için durduruldu.');const d=parseBackup(await file.text());const histories=new Map(state.history.map(p=>[historyId(p),p]));d.history.forEach(p=>{if(!histories.has(historyId(p)))histories.set(historyId(p),p);});const closedIds=new Set([...histories.values()].filter(p=>p.id!==undefined).map(p=>String(p.id))),positions=new Map(state.positions.map(p=>[String(p.id),p]));d.positions.forEach(p=>{if(!positions.has(String(p.id)))positions.set(String(p.id),p);});const merged=[...positions.values()].filter(p=>!closedIds.has(String(p.id)));savePortfolio(merged,[...histories.values()]);state.favorites=[...new Set([...state.favorites,...d.favorites])];store(keys.favorites,state.favorites);renderPortfolio();renderFavorites();byId('backup-message').textContent='Yedek birleştirildi. Aynı kimlikte mevcut kayıt korundu; kapanmış işlemler yeniden açılmadı. Periyot seçimin değiştirilmedi.';}catch(e){byId('backup-message').textContent=e.message;}finally{byId('import-backup').value='';}}
function exitFrames(p){const frames=validFrames(p.frames);return frames.length?frames:['one_hour'];}
function exitKey(p){return symbolOf(p)+'|'+exitFrames(p).join(',');}
function exitStatus(p){
  const q=quoteFor(symbolOf(p)),record=exitCache.get(exitKey(p));
  if(isFresh(q)&&positive(p.stop)&&q.price<=p.stop)return{label:'STOP SEVİYESİ AŞILDI · manuel satış kararını gözden geçir',tone:'negative'};
  if(isFresh(q)&&positive(p.target)&&q.price>=p.target)return{label:'HEDEF GÖRÜLDÜ · manuel kâr almayı değerlendir',tone:'positive'};
  if(record?.error)return{label:'Analiz alınamadı; sonuca güvenerek işlem yapma',tone:'stale'};
  if(!record?.data)return{label:'Analiz bekleniyor…',tone:'muted'};
  if(Date.now()-record.receivedAt>90000)return{label:'Analiz eskidi; güncelleme bekleniyor',tone:'stale'};
  const frames=Object.values(record.data.frames),worst=frames.reduce((a,b)=>a.count>=b.count?a:b);
  const prefix=record.data.errors.length?'Eksik veri · ':'';
  return{label:prefix+worst.stage+' · '+worst.name+' '+worst.count+'/4',tone:worst.count>=3?'signal-sell-text':worst.count?'stale':'muted'};
}
function renderExitTracking(){
  const grid=byId('exit-grid');if(!grid)return;
  const opened=new Set([...grid.querySelectorAll('details[open]')].map(n=>n.dataset.exitFrame));
  grid.replaceChildren();
  byId('exit-monitor-status').textContent=state.positions.length+' açık pozisyon · '+(exitBusy?'Satış kontrolleri yenileniyor…':'Yalnızca uyarı; otomatik satış yapılmaz.');
  if(!state.positions.length){grid.append(el('div','panel empty','Açık sanal işlemin yok. İşlem açtığında satış takibi burada otomatik başlayacak.'));return;}
  state.positions.forEach(p=>{
    const card=positionCard(p),record=exitCache.get(exitKey(p));card.classList.add('exit-card');
    card.append(el('p','muted','İzlenen periyotlar: '+exitFrames(p).map(frameName).join(' · ')));
    if(record?.error)card.append(el('p','stale',record.error));
    if(record?.data){
      card.append(el('small','analysis-stamp',(record.error?'Son başarılı analiz: ':'Analiz: ')+timeText(record.data.analyzed_at)));
      exitFrames(p).forEach(key=>{
        const frame=record.data.frames[key];if(!frame)return;
        const details=el('details','exit-details');details.dataset.exitFrame=p.id+'|'+key;details.open=opened.has(details.dataset.exitFrame);
        details.append(el('summary',frame.count>=3?'signal-sell-text':frame.count?'stale':'muted',frame.name+' · '+frame.count+'/4 · '+frame.stage));
        const list=el('ul','check-list');frame.checks.forEach(check=>{const row=el('li');row.append(el('b',check.ok?'negative':'muted',(check.ok?'● ':'○ ')+check.label+' · '+Number(check.value).toLocaleString('tr-TR',{maximumFractionDigits:6})),el('span','',check.reason));list.append(row);});
        details.append(list,el('small','analysis-stamp','Kapanmış mum: '+timeText(frame.closed_at*1000)));card.append(details);
      });
      if(record.data.errors.length)card.append(el('p','stale','Eksik periyot: '+record.data.errors.map(e=>frameName(e.frame)+' ('+e.message+')').join(' · ')));
    }
    grid.append(card);
  });
}
async function loadExitChecks(force=false){
  if(exitBusy)return;
  const positions=[...new Map(state.positions.map(p=>[exitKey(p),p])).values()],active=new Set(positions.map(exitKey));
  for(const key of exitCache.keys())if(!active.has(key))exitCache.delete(key);
  const pending=positions.filter(p=>{const r=exitCache.get(exitKey(p));return force||!r||Date.now()-r.checkedAt>=(r.error?30000:60000);});
  if(!pending.length){renderExitTracking();return;}
  exitBusy=true;renderExitTracking();
  async function worker(){while(pending.length){const p=pending.shift(),key=exitKey(p);if(!state.positions.some(pos=>exitKey(pos)===key))continue;
    try{
      const data=await api('/api/exit',{symbol:symbolOf(p),frames:exitFrames(p).join(',')});
      if(!data.frames||!Object.keys(data.frames).length||!Array.isArray(data.errors)||!Object.values(data.frames).every(f=>num(f.count)&&Array.isArray(f.checks)))throw Error('Satış analizi yanıtı eksik; yeniden denenecek.');
      if(!state.positions.some(pos=>exitKey(pos)===key))continue;
      exitCache.set(key,{data,error:null,receivedAt:Date.now(),checkedAt:Date.now()});
      const worst=Object.values(data.frames).reduce((a,b)=>a.count>=b.count?a:b);
      alertOnce('exit:'+key,worst.count?worst.stage+'|'+worst.name:'',symbolOf(p)+' · '+worst.stage+' · '+worst.name+' '+worst.count+'/4'+(data.errors.length?' · Bazı periyotlar alınamadı.':''),worst.count>=3?'sell':'warning');
    }catch(e){if(state.positions.some(pos=>exitKey(pos)===key))exitCache.set(key,{...exitCache.get(key),error:e.message,checkedAt:Date.now()});}
    renderExitTracking();
  }}
  try{await Promise.all([worker(),worker()]);}finally{exitBusy=false;renderPortfolio();}
}
document.querySelectorAll('.nav').forEach(n=>n.addEventListener('click',()=>switchPage(n.dataset.page)));
document.querySelectorAll('[data-goto]').forEach(n=>n.addEventListener('click',()=>switchPage(n.dataset.goto)));
document.querySelectorAll('[data-close]').forEach(n=>n.addEventListener('click',()=>byId(n.dataset.close).close()));
byId('menu-toggle').addEventListener('click',()=>byId('sidebar').classList.toggle('open'));
byId('apply-timeframes').addEventListener('click',()=>{const frames=[...document.querySelectorAll('#timeframe-controls input:checked')].map(n=>n.value);if(!frames.length){byId('timeframe-summary').textContent='En az bir periyot seçmelisin.';return;}state.frames=frames;state.scope=byId('scan-limit').value;try{store(keys.frames,frames);}catch(e){notice(e.message);}syncFrames();state.signals=[];renderRadar(true);radarGeneration++;loadRadar(false);if(state.marketSymbol)analyzeMarket(state.marketSymbol,true);});
byId('scan-button').addEventListener('click',()=>{radarGeneration++;loadRadar(true);});
byId('market-search-button').addEventListener('click',()=>analyzeMarket(byId('market-search-input').value));
byId('market-search-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();analyzeMarket(e.currentTarget.value);}});
byId('trade-form').addEventListener('submit',submitTrade);
['trade-amount','trade-fee','trade-slip'].forEach(id=>byId(id).addEventListener('input',previewTrade));
byId('export-backup').addEventListener('click',downloadBackup);
byId('import-backup').addEventListener('change',e=>importBackup(e.target.files[0]));
byId('refresh-exits').addEventListener('click',()=>loadExitChecks(true));
window.addEventListener('portfolio-updated',()=>{renderExitTracking();loadExitChecks();});
byId('alerts-enabled').checked=load('coinpilot-pro-alerts',true)!==false;
byId('sound-toggle').addEventListener('click',toggleSound);
byId('sound-resume').addEventListener('click',()=>enableAudio(true));
byId('sound-test').addEventListener('click',()=>enableAudio(true));
byId('sound-volume').addEventListener('input',e=>{soundVolume=Number(e.target.value);renderSoundStatus();try{store(volumeKey,soundVolume);}catch(err){notice(err.message);}});
function unlockSound(e){if(e.target.closest?.('#sound-toggle,#sound-resume,#sound-test'))return;if(soundEnabled&&audioContext?.state!=='running')enableAudio();}
document.addEventListener('pointerdown',unlockSound);document.addEventListener('keydown',unlockSound);
renderSoundStatus();updateTabIndicator();if(soundEnabled)enableAudio();
byId('alerts-enabled').addEventListener('change',e=>{try{store('coinpilot-pro-alerts',e.target.checked);}catch(err){notice(err.message);}});
window.addEventListener('resize',()=>requestAnimationFrame(redrawAll));
window.addEventListener('pageshow',scrollPageTop);
scrollPageTop();
syncFrames();renderFavorites();renderAlerts();renderPortfolio();loadDashboard();loadRadar();
loadExitChecks();
if(brokenStorage.size)notice('Bazı yerel kayıtlar okunamadı. Üzerlerine yazılmayacak. Pozisyonlarım → Yedeği indir ile ham kurtarma dosyasını al.');
let lastBackgroundPoll=0;
function pollDashboard(){paintQuotes();if(!document.hidden||Date.now()-lastBackgroundPoll>=15000){lastBackgroundPoll=Date.now();loadDashboard();}}
setInterval(pollDashboard,3000);
setInterval(()=>loadExitChecks(),15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){updateTabIndicator(true);if(soundEnabled)enableAudio();loadDashboard();loadRadar();loadExitChecks();redrawAll();}});
