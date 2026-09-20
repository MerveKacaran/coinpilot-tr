'use strict';
// Separate from the research observer: these are this browser's own paper positions.
let pathBusy=false,orderPositionId=null,orderDisplayedQuantity=null,partialPositionId=null,partialDisplayedQuantity=null,targetsBusy=false,autoSellBusy=false;
const pathDue=new Map(),pathErrors=new Map();
const targetCache=new Map(),targetFrames=[['fifteen_minute','15 dakika'],['one_hour','Saatlik'],['daily','Günlük']];
const positionChartCache=new Map(),positionChartRequests=new Map(),positionChartFrames=new Map();
function positionChartFrame(p){const selected=positionChartFrames.get(String(p.id));return catalog.some(([key])=>key===selected)?selected:exitFrames(p)[0];}
function positionChartKey(p,frame=positionChartFrame(p)){return symbolOf(p)+'|'+frame;}
function positionChartMaxAge(frame){return frame==='five_minute'?60000:frame==='fifteen_minute'?120000:frame==='one_hour'?300000:frame==='four_hour'?600000:900000;}
async function ensurePositionChart(p,force=false,frame=positionChartFrame(p)){
  const symbol=symbolOf(p),key=positionChartKey(p,frame),cached=positionChartCache.get(key),age=Date.now()-(cached?.at||0),maxAge=cached?.error?30000:positionChartMaxAge(frame);
  if((!force&&cached&&age<maxAge)||positionChartRequests.has(key))return positionChartRequests.get(key);
  const request=api('/api/analyze',{symbol,frames:frame},60000).then(data=>{
    const item=data?.item,series=item?.frames?.[frame]?.chart;
    if(item?.coin?.symbol!==symbol||!Array.isArray(series)||series.length<2)throw Error('Grafik mumları doğrulanamadı.');
    positionChartCache.set(key,{at:Date.now(),data:{frame,series,analyzedAt:item.analyzed_at,closedAt:item.frames[frame].closed_at}});
  }).catch(error=>positionChartCache.set(key,{...cached,at:Date.now(),error:error.message||'Grafik alınamadı.'})).finally(()=>{positionChartRequests.delete(key);renderPortfolio();});
  positionChartRequests.set(key,request);return request;
}
function drawPositionChart(canvas,p,data){
  const v=fitCanvas(canvas);if(!v)return;const{ctx,w,h}=v,series=data.series.slice(-60);ctx.clearRect(0,0,w,h);if(series.length<2)return;
  const left=8,right=w<480?58:72,top=14,bottom=24,width=w-left-right,height=h-top-bottom,x=i=>left+(i+.5)*width/series.length;
  let low=Math.min(...series.map(c=>c.low)),high=Math.max(...series.map(c=>c.high)),span=high-low||Math.abs(high)*.001||1;
  const q=quoteFor(symbolOf(p)),levels=[['Giriş',p.entry,'#83aaff'],['Hedef',p.target,'#1fd49a'],['Stop',p.stop,'#ff6478'],['Canlı',q?.price,'#ffc857']];
  const nearby=levels.filter(([,value])=>num(value)&&value>=low-span*.2&&value<=high+span*.2);if(nearby.length){low=Math.min(low,...nearby.map(x=>x[1]));high=Math.max(high,...nearby.map(x=>x[1]));span=high-low||span;}
  const pad=span*.08;low-=pad;high+=pad;const y=value=>top+height-(value-low)/(high-low)*height;
  ctx.font='10px system-ui';ctx.textAlign='left';for(let i=0;i<4;i++){const value=low+(high-low)*i/3,yy=y(value);path(ctx,[[left,yy],[w-right,yy]],'#203752');ctx.fillStyle='#92a4bf';ctx.fillText(value.toLocaleString('tr-TR',{maximumSignificantDigits:6}),w-right+5,yy+3);}
  series.forEach((c,i)=>{const color=c.close>=c.open?'#1fd49a':'#ff6478',xx=x(i),body=Math.max(2,width/series.length*.62);path(ctx,[[xx,y(c.high)],[xx,y(c.low)]],color);ctx.fillStyle=color;ctx.fillRect(xx-body/2,Math.min(y(c.open),y(c.close)),body,Math.max(1,Math.abs(y(c.open)-y(c.close))));});
  for(const[label,value,color]of levels){if(!num(value)||value<low||value>high)continue;ctx.setLineDash(label==='Canlı'?[2,3]:[5,4]);path(ctx,[[left,y(value)],[w-right,y(value)]],color);ctx.setLineDash([]);ctx.fillStyle=color;ctx.fillText(label,left+3,Math.max(top+9,y(value)-3));}
  ctx.fillStyle='#92a4bf';ctx.fillText(new Date(series[0].time*1000).toLocaleString('tr-TR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}),left,h-5);ctx.textAlign='right';ctx.fillText(new Date(series.at(-1).time*1000).toLocaleString('tr-TR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}),w-right,h-5);
}
function positionChartPanel(p){
  const frame=positionChartFrame(p),key=positionChartKey(p,frame),cached=positionChartCache.get(key),box=el('section','position-mini-chart'),head=el('div','position-chart-head'),actions=el('div','position-chart-actions'),select=el('select');
  select.setAttribute('aria-label',symbolOf(p)+' grafik periyodu');for(const[value,label]of catalog){const option=el('option','',label);option.value=value;select.append(option);}select.value=frame;select.addEventListener('change',()=>{positionChartFrames.set(String(p.id),select.value);ensurePositionChart(p,false,select.value);renderPortfolio();});
  actions.append(select,btn('YENİLE','link',()=>ensurePositionChart(p,true,frame)));head.append(el('b','',frameName(frame)+' FİYAT GRAFİĞİ'),actions);box.append(head);
  if(cached?.data){const canvas=el('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',symbolOf(p)+' '+frameName(frame)+' mum grafiği; giriş, hedef, stop ve canlı fiyat seviyeleri');box.append(canvas,el('p','position-chart-legend','● Mumlar · '+frameName(frame)+' kapanışları  |  Mavi giriş · Yeşil hedef · Kırmızı stop · Sarı canlı fiyat'),el('small','muted','Son kapanış: '+timeText(cached.data.closedAt*1000)+' · Grafik analizi: '+timeText(cached.data.analyzedAt)));bindCanvas(canvas,()=>drawPositionChart(canvas,p,cached.data));}
  else box.append(el('div','position-chart-placeholder',positionChartRequests.has(key)?'Grafik yükleniyor…':cached?.error||'Grafik hazırlanıyor…'));
  if(cached?.error)box.append(el('p','stale',cached.error+' Son doğrulanmış grafik varsa yukarıda gösteriliyor.'));
  ensurePositionChart(p);return box;
}
function targetPanel(p){
  const box=el('section','period-targets'),cached=targetCache.get(symbolOf(p));
  box.append(el('b','','PERİYOT HEDEF / STOP DURUMU · GÜNCEL ANALİZ'));
  for(const [key,label] of targetFrames){
    const row=el('div','period-target-row'),f=cached?.data?.frames?.[key];row.append(el('span','period-label',label));
    for(const type of ['target','stop']){
      const value=f?.[type],known=positive(value),reached=known&&(type==='target'?Paper.targetReached(p,value):Paper.stopReached(p,value));
      const pair=el('div','period-level'),status=el('span',!known?'target-status target-unknown':type==='target'?(reached?'target-status target-reached':'target-status target-missed'):(reached?'target-status stop-reached':'target-status stop-safe'),known?(reached?'✓':'✕'):'—');
      status.title=!known?(type==='target'?'Hedef':'Stop')+' henüz hesaplanmadı.':reached?(type==='target'?'Gözlenen en yüksek fiyat hedefe ulaştı.':'Gözlenen en düşük fiyat stopa ulaştı.'):p.tracking?.incomplete?'Doğrulanan kayıtlarda ulaşmadı; eksik aralık nedeniyle kesin değildir.':'Doğrulanan kayıtlarda henüz ulaşmadı.';
      pair.append(el('small','',type==='target'?'Hedef':'Stop'),el('strong','',f?levelText(value,p.entry):(cached?.error?'Alınamadı':'Bekleniyor…')),status);row.append(pair);
    }
    box.append(row);
  }
  box.append(el('small','muted','Hedefte yeşil ✓ ulaşıldı; kırmızı ✕ ulaşılmadı. Stopta kırmızı ✓ stop görüldü; yeşil ✕ stop görülmedi. Durum, işlemden sonra doğrulanan en yüksek/en düşük fiyatla karşılaştırılır. Yüzdeler giriş fiyatına göredir.'));
  if(cached?.data)box.append(el('small','muted','Analiz: '+timeText(cached.data.analyzed_at)));
  if(cached?.error)box.append(el('p','stale',cached.error+' Gösterilen eski hedefler güncel kabul edilmemeli.'));
  if(cached?.data?.errors?.length)box.append(el('p','stale',cached.data.errors.map(e=>(targetFrames.find(x=>x[0]===e.frame)?.[1]||e.frame)+': veri eksik').join(' · ')));
  box.append(btn('HEDEFLERİ YENİLE','link',()=>{if(targetCache.has(symbolOf(p)))targetCache.get(symbolOf(p)).at=0;loadPositionTargets();}));return box;
}
async function loadPositionTargets(){
  if(targetsBusy||!Object.values(state.quotes).some(isFresh))return;targetsBusy=true;
  const pending=[...new Set(state.positions.map(symbolOf))].filter(s=>Date.now()-(targetCache.get(s)?.at||0)>(targetCache.get(s)?.error?15000:180000));
  async function worker(){while(pending.length){const symbol=pending.shift();try{const data=await api('/api/targets',{symbol},60000);if(data.symbol!==symbol)throw Error('Hedef paritesi doğrulanamadı.');targetCache.set(symbol,{data,at:Date.now()});}catch(e){targetCache.set(symbol,{...targetCache.get(symbol),error:e.message,at:Date.now()});}renderPortfolio();}}
  try{await Promise.all([worker(),worker()]);}finally{targetsBusy=false;}
}
function saleQuantity(prefix,p){
  const mode=byId(prefix+'-size-mode').value,value=Number(byId(prefix+'-size').value);
  if(!positive(value)||(mode==='percent'&&value>100))throw Error('Satış yüzdesi 0–100 arasında (0 hariç) olmalı; adet kalan miktarı aşamaz.');
  const quantity=mode==='percent'?p.quantity*value/100:value;
  if(quantity>p.quantity*(1+1e-12))throw Error('Satılacak adet kalan miktardan fazla.');
  return Math.min(quantity,p.quantity);
}
function sizeModeChanged(prefix,id){const p=state.positions.find(x=>x.id===id);if(!p)return;byId(prefix+'-size').value=byId(prefix+'-size-mode').value==='percent'?100:p.quantity;}
function portfolioLock(fn){
  if(!navigator.locks)return Promise.reject(Error('Bu tarayıcı güvenli işlem kilidini desteklemiyor. Güncel Chrome, Edge veya Safari kullan.'));
  return navigator.locks.request('coinpilot-paper-portfolio',fn);
}
function syncStoredPortfolio(){
  if(brokenStorage.size)return;
  const positions=JSON.parse(localStorage.getItem(keys.positions)||'[]'),history=JSON.parse(localStorage.getItem(keys.history)||'[]');
  if(!Array.isArray(positions)||!positions.every(validatePosition)||!Array.isArray(history)||!history.every(validateHistory))throw Error('Diğer sekmedeki portföy kaydı doğrulanamadı.');
  state.positions=positions;state.history=history;
}
function hitLabel(hit){return timeText(new Date(hit.at*1000).toISOString())+(hit.source==='minute'?' · 1 dakikalık mumda; saniyesi bilinmiyor':' · canlı fiyat gözlemi');}
function autoSellControl(p){
  const wrap=el('section','auto-sell-control'),label=el('label','auto-sell-toggle'),input=el('input');input.type='checkbox';input.checked=!!p.autoSell?.enabled;
  label.append(input,el('span','',input.checked?'OTOMATİK SANAL SATIŞ AÇIK':'OTOMATİK SANAL SATIŞ KAPALI'));wrap.append(label,el('small','muted','Yalnızca bu sayfa açıkken ve fiyat tazeyken çalışır. Kayıtlı hedef, kayıtlı stop veya seçili periyotlarda ≥3/4 SAT teyidi oluşursa kalan miktarın tamamını sanal olarak satar. Gerçek borsa emri göndermez.'));
  input.addEventListener('change',()=>toggleAutoSell(p.id,input.checked));return wrap;
}
async function toggleAutoSell(id,enabled){
  try{
    await portfolioLock(()=>{syncStoredPortfolio();const p=state.positions.find(x=>x.id===id);if(!p)throw Error('Pozisyon artık açık değil.');const now=new Date().toISOString(),autoSell={enabled,enabledAt:enabled?(p.autoSell?.enabledAt||now):p.autoSell?.enabledAt||null,updatedAt:now};savePortfolio(state.positions.map(x=>x.id===id?{...x,autoSell}:x),state.history);});
    renderPortfolio();notice('Otomatik sanal satış '+(enabled?'açıldı. Sayfa açıkken hedef, stop ve ≥3/4 SAT teyidi izlenecek.':'kapatıldı. Pozisyon açık kalacak.'));if(enabled)await checkAutoSales();
  }catch(e){notice(e.message);renderPortfolio();}
}
function positionTools(p){
  const box=el('section','position-evidence'),t=p.tracking||{},o=p.sellOrder;
  box.append(targetPanel(p));
  box.append(el('b','','HEDEF GEÇMİŞİ'));
  box.append(el('p',t.targetHit?'positive':'muted',!positive(p.target)?'Hedef belirlenmedi.':t.targetHit?'✓ Hedef görüldü · '+hitLabel(t.targetHit):'Doğrulanan fiyatlarda henüz hedef görülmedi.'));
  if(t.stopHit)box.append(el('p','negative','Stop görüldü · '+hitLabel(t.stopHit)));
  box.append(el('p','muted','Gözlenen en yüksek '+money(t.high)+' · En düşük '+money(t.low)));
  box.append(el('small','muted',t.through?'Geçmiş kontrolü: '+timeText(new Date(t.through*1000).toISOString())+' zamanına kadar.':'Geçmiş kontrolü bekleniyor…'));
  if(t.incomplete||t.openingMinuteUnknown)box.append(el('p','stale',(t.incomplete?'Eksik/verisiz aralık var. ':'')+(t.openingMinuteUnknown?'İşlemin açıldığı ilk eksik dakika dışarıda tutulur. ':'')+'Hedefin hiç görülmediği kesin söylenemez.'));
  if(pathErrors.has(p.id))box.append(el('p','stale',pathErrors.get(p.id)));
  box.append(btn('GEÇMİŞİ KONTROL ET','link',()=>refreshPositionPath(p.id)));
  box.append(autoSellControl(p));
  if(o?.status==='pending'){
    box.append(el('p','pending-order','BEKLEYEN SANAL SATIŞ · '+levelText(o.price,p.entry)+' · '+(o.quantity??p.quantity).toLocaleString('tr-TR',{maximumFractionDigits:10})+' adet'),el('small','muted','Oluşturuldu: '+timeText(o.createdAt)+' · '+(o.replay?'Açılışta geçmiş mum simülasyonu açık.':'Yalnızca sayfa çalışırken canlı gözlem.')));
    box.append(btn('EMRİ DEĞİŞTİR','link',()=>openSellOrder(p.id)),btn('EMRİ İPTAL ET','link',()=>cancelSellOrder(p.id)));
  }else box.append(btn('FİYATLA SANAL SATIŞ EMRİ','sell',()=>openSellOrder(p.id)));
  return box;
}
function executionLabel(source){return {'history-minute':'Geçmiş mumdan sanal limit satışı','live-bid':'Canlı alış kotasyonuyla sanal limit satışı','live-last':'Son işlem fiyatıyla sanal limit varsayımı','auto-target':'Otomatik sanal satış · kayıtlı hedef','auto-stop':'Otomatik sanal satış · kayıtlı stop','auto-signal':'Otomatik sanal satış · ≥3/4 teknik SAT teyidi'}[source]||'Manuel sanal satış';}
function executionHistory(p,f){
  const marketLike=f.source==='manual'||f.source?.startsWith('auto-');
  return {id:f.orderId?'limit:'+f.orderId:crypto.randomUUID(),positionId:String(p.id),revision:f.revision,closesPosition:f.closesPosition,remainingQuantity:f.remaining?.quantity||0,remainingAmount:f.remaining?.amount||0,date:new Date(f.at*1000).toLocaleString('tr-TR'),closedAt:new Date(f.at*1000).toISOString(),recordedAt:new Date().toISOString(),coin:symbolOf(p),entry:p.entry,exit:f.exit,percent:f.percent,pnl:f.pnl,amount:f.amount,quantity:f.quantity,fee:p.fee||0,slippage:marketLike?(p.slippage||0):0,method:f.source,sellOrder:p.sellOrder,tracking:f.tracking||p.tracking,
    executionNote:(f.closesPosition?'Tam satış · ':'Parçalı satış · ')+f.quantity.toLocaleString('tr-TR',{maximumFractionDigits:10})+' adet · '+executionLabel(f.source)+(marketLike?'; taze alış kotasyonu, komisyon ve kayma varsayımı kullanıldı. Gerçek emir değildir.':'; seçilen adedin limit fiyatından dolduğu varsayılır. Komisyon düşüldü; emir sırası ve likidite modellenmez.')};
}
function announceLevelHits(before,after){
  const hits=Paper.levelHits(before,after);if(!hits.length)return;
  const both=hits.length>1,symbol=symbolOf(after);
  if(hits.includes('target'))alertOnce('level-target:'+after.id,'hit',symbol+' · Kayıtlı hedefe ulaştı: '+money(after.target),'buy',both?'none':'target');
  if(hits.includes('stop'))alertOnce('level-stop:'+after.id,'hit',symbol+' · Kayıtlı stop seviyesine ulaştı: '+money(after.stop),'sell','stop');
}
function commitPaperResult(result){
  const p=result.position;
  if(result.fill){
    const remaining=result.fill.remaining?{...result.fill.remaining,tracking:p.tracking,sellOrder:p.sellOrder}:null;
    savePortfolio(remaining?state.positions.map(x=>x.id===p.id?remaining:x):state.positions.filter(x=>x.id!==p.id),[executionHistory(p,result.fill),...state.history]);
    alertOnce('sale:'+(result.fill.orderId||p.id+':'+result.fill.revision),'filled',symbolOf(p)+' · '+executionLabel(result.fill.source)+' · '+money(result.fill.exit)+' · Net '+money(result.fill.pnl),'sell');
    notice(symbolOf(p)+' sanal satış kaydedildi. '+(result.fill.source==='history-minute'?'Bu sonuç geçmişten hesaplandı; gece çalışan gerçek bir emir değildir.':'Gerçek borsa emri gönderilmedi.'));
  }else if(JSON.stringify(state.positions.find(x=>x.id===p.id))!==JSON.stringify(p))savePortfolio(state.positions.map(x=>x.id===p.id?p:x),state.history);
}
async function observePositions(){
  try{await portfolioLock(()=>{syncStoredPortfolio();for(const p of [...state.positions]){if(state.closing.has(p.id))continue;const result=Paper.observe(p,quoteFor(symbolOf(p)));announceLevelHits(p,result.position);commitPaperResult(result);}});}catch(e){notice(e.message);}
}
async function checkAutoSales(){
  if(autoSellBusy||brokenStorage.size)return;autoSellBusy=true;
  try{
    for(const snapshot of [...state.positions]){
      if(!snapshot.autoSell?.enabled||state.closing.has(snapshot.id))continue;
      await portfolioLock(()=>{
        syncStoredPortfolio();let p=state.positions.find(x=>x.id===snapshot.id);if(!p||state.closing.has(p.id))return;
        const q=quoteFor(symbolOf(p)),reason=Paper.autoSaleReason(p,q,exitCache.get(exitKey(p)));if(!reason)return;
        if(p.sellOrder?.status==='pending')p={...p,sellOrder:{...p.sellOrder,status:'cancelled',cancelledAt:new Date().toISOString()}};
        const exit=(positive(q.bid)?q.bid:q.price)*(1-(p.slippage||0)),sale=Paper.settle(p,p.quantity,exit),at=Date.parse(q.price_updated_at)/1000;
        commitPaperResult({position:p,fill:{...sale,at,source:'auto-'+reason,tracking:p.tracking}});
      });
    }
  }catch(e){notice('Otomatik sanal satış çalıştırılamadı: '+e.message);}finally{autoSellBusy=false;}
}
async function loadPositionPaths(){
  if(pathBusy||brokenStorage.size||!state.positions.length)return;
  pathBusy=true;
  try{
    for(const snapshot of [...state.positions]){
      if((pathDue.get(snapshot.id)||0)>Date.now())continue;
      pathDue.set(snapshot.id,Date.now()+60000);
      try{
        const opened=Date.parse(snapshot.openedAt)/1000;
        if(!Number.isFinite(opened))throw Error('Eski işlemde açılış zamanı yok; geçmiş kontrolü yapılamıyor.');
        const since=snapshot.tracking?.through||opened;
        const data=await api('/api/price-path',{symbol:symbolOf(snapshot),from:since},20000);
        if(data.symbol!==symbolOf(snapshot))throw Error('Geçmiş paritesi doğrulanamadı.');
        await portfolioLock(()=>{
          syncStoredPortfolio();const current=state.positions.find(p=>p.id===snapshot.id);
          if(!current||state.closing.has(current.id)||(current.tracking?.through||opened)!==since)return;
          const result=Paper.reconcile(current,data);announceLevelHits(current,result.position);commitPaperResult(result);pathErrors.delete(current.id);
          if(data.has_more)pathDue.set(current.id,Date.now()+1000);
        });
      }catch(e){pathErrors.set(snapshot.id,e.message);}
    }
  }finally{pathBusy=false;renderPortfolio();}
}
function openSellOrder(id){
  const p=state.positions.find(x=>x.id===id);if(!p)return;orderPositionId=id;
  orderDisplayedQuantity=p.quantity;
  byId('order-title').textContent=symbolOf(p)+' · Sanal limit satış';
  byId('order-price').value=p.sellOrder?.status==='pending'?p.sellOrder.price:(p.target||'');
  byId('order-replay').checked=p.sellOrder?.status==='pending'?p.sellOrder.replay:false;
  byId('order-size-mode').value='quantity';byId('order-size').value=p.sellOrder?.status==='pending'?(p.sellOrder.quantity??p.quantity):p.quantity;
  byId('order-message').textContent='';previewSellOrder();openDialogAtTop(byId('order-dialog'));
}
async function refreshPositionPath(id){
  try{await portfolioLock(()=>{syncStoredPortfolio();const p=state.positions.find(x=>x.id===id);if(!p)return;const tracking={version:1,high:null,low:null,targetHit:null,stopHit:null,...p.tracking,through:null,incomplete:false};savePortfolio(state.positions.map(x=>x.id===id?{...x,tracking}:x),state.history);pathDue.delete(id);});loadPositionPaths();}catch(e){notice(e.message);}
}
function previewSellOrder(){
  const p=state.positions.find(x=>x.id===orderPositionId);if(!p)return;
  try{const price=Number(byId('order-price').value),q=quoteFor(symbolOf(p)),quantity=saleQuantity('order',p),sale=Paper.settle(p,quantity,price);
  byId('order-preview').textContent='Güncel fiyat '+money(q?.price)+' · Limit '+levelText(price,p.entry)+' · Satılacak '+quantity.toLocaleString('tr-TR',{maximumFractionDigits:10})+' adet · Kalan '+(sale.remaining?.quantity||0).toLocaleString('tr-TR',{maximumFractionDigits:10})+' adet · Varsayımsal net sonuç '+money(sale.pnl)+(isFresh(q)&&price<=(positive(q.bid)?q.bid:q.price)?' · Bu fiyat şu anda karşılanıyor; kaydettikten sonra hemen sanal satış olabilir.':'');}catch(e){byId('order-preview').textContent=e.message;}
}
async function saveSellOrder(event){
  event.preventDefault();byId('order-submit').disabled=true;
  try{
    const price=Number(byId('order-price').value),replay=byId('order-replay').checked;
    if(!positive(price))throw Error('Sıfırdan büyük geçerli bir TL fiyatı gir.');
    await portfolioLock(()=>{
      syncStoredPortfolio();const p=state.positions.find(x=>x.id===orderPositionId);
      if(!p)throw Error('Pozisyon artık açık değil.');
      if(p.quantity!==orderDisplayedQuantity)throw Error('Pozisyon miktarı değişti. Pencereyi yeniden açıp miktarı kontrol et.');
      if(!Number.isFinite(Date.parse(p.openedAt)))throw Error('Eski pozisyonda açılış zamanı yok; fiyatlı emir için doğrulanabilir işlem zamanı gerekli. Manuel sanal satış kullanabilirsin.');
      if(state.closing.has(p.id))throw Error('Bu pozisyon için satış doğrulaması sürüyor.');
      const quantity=saleQuantity('order',p);
      const next={...p,sellOrder:{id:crypto.randomUUID(),price,quantity,createdAt:new Date().toISOString(),status:'pending',replay}};
      savePortfolio(state.positions.map(x=>x.id===p.id?next:x),state.history);pathDue.delete(p.id);
    });
    byId('order-dialog').close();renderPortfolio();loadPositionPaths();await observePositions();renderPortfolio();
    notice('Sanal satış emri kaydedildi. '+(replay?'Sayfa kapalıyken oluşan mumlar yeniden açılışta simüle edilir.':'Sayfa kapalı veya uykudayken çalışmaz.'));
  }catch(e){byId('order-message').textContent=e.message;}finally{byId('order-submit').disabled=false;}
}
async function cancelSellOrder(id){
  try{await portfolioLock(()=>{syncStoredPortfolio();const p=state.positions.find(x=>x.id===id);if(!p||p.sellOrder?.status!=='pending')return;savePortfolio(state.positions.map(x=>x.id===id?{...x,sellOrder:{...x.sellOrder,status:'cancelled',cancelledAt:new Date().toISOString()}}:x),state.history);});renderPortfolio();notice('Bekleyen sanal satış iptal edildi. Pozisyon açık kaldı.');}catch(e){notice(e.message);}
}
function openPartialSale(id){
  const p=state.positions.find(x=>x.id===id);if(!p)return;partialPositionId=id;partialDisplayedQuantity=p.quantity;
  byId('partial-title').textContent=symbolOf(p)+' · Parçalı / tam sanal satış';
  byId('partial-size-mode').value='percent';byId('partial-size').value=100;
  byId('partial-message').textContent=p.sellOrder?.status==='pending'?'Bu satış gerçekleşirse mevcut bekleyen limit emri iptal edilir; kalan için yeni emir oluşturabilirsin.':'';
  previewPartialSale();openDialogAtTop(byId('partial-dialog'));
}
function previewPartialSale(){
  const p=state.positions.find(x=>x.id===partialPositionId);if(!p)return;
  byId('partial-message').textContent=p.sellOrder?.status==='pending'?'Bu satış gerçekleşirse bekleyen limit emri iptal edilir; kalan için yeni emir oluşturabilirsin.':'';
  try{const q=quoteFor(symbolOf(p));if(!isFresh(q))throw Error('Güncel fiyat bekleniyor; satış onayında yeniden alınacak.');const quantity=saleQuantity('partial',p),exit=(positive(q.bid)?q.bid:q.price)*(1-(p.slippage||0)),sale=Paper.settle(p,quantity,exit);
    byId('partial-preview').textContent='Satılacak '+quantity.toLocaleString('tr-TR',{maximumFractionDigits:10})+' adet · Tahmini net satış tutarı '+money(quantity*exit*(1-(p.fee||0)))+' · Bu parçanın maliyeti '+money(sale.amount)+' · Net K/Z '+money(sale.pnl)+' · Kalan '+(sale.remaining?.quantity||0).toLocaleString('tr-TR',{maximumFractionDigits:10})+' adet';
  }catch(e){byId('partial-preview').textContent=e.message;}
}
async function submitPartialSale(event){
  event.preventDefault();const id=partialPositionId;if(state.closing.has(id))return;
  state.closing.add(id);byId('partial-submit').disabled=true;
  try{await portfolioLock(async()=>{
    syncStoredPortfolio();let p=state.positions.find(x=>x.id===id);if(!p)throw Error('Pozisyon artık açık değil.');
    if(p.quantity!==partialDisplayedQuantity)throw Error('Kalan miktar değişti. Satış penceresini yeniden aç.');
    const quantity=saleQuantity('partial',p),d=await api('/api/quote',{symbol:symbolOf(p)}),q=d.coin;
    if(!isFresh(q)||q.symbol!==symbolOf(p))throw Error('Güncel satış fiyatı doğrulanamadı.');rememberQuote(q);
    if(p.sellOrder?.status==='pending')p={...p,sellOrder:{...p.sellOrder,status:'cancelled',cancelledAt:new Date().toISOString()}};
    const exit=(positive(q.bid)?q.bid:q.price)*(1-(p.slippage||0)),sale=Paper.settle(p,quantity,exit);
    commitPaperResult({position:p,fill:{...sale,at:Date.now()/1000,source:'manual'}});
  });byId('partial-dialog').close();}catch(e){byId('partial-message').textContent=e.message;}finally{state.closing.delete(id);byId('partial-submit').disabled=false;renderPortfolio();}
}
document.addEventListener('DOMContentLoaded',()=>{
  byId('order-form').addEventListener('submit',saveSellOrder);byId('order-price').addEventListener('input',previewSellOrder);
  byId('order-size').addEventListener('input',previewSellOrder);byId('order-size-mode').addEventListener('change',()=>{sizeModeChanged('order',orderPositionId);previewSellOrder();});
  byId('partial-form').addEventListener('submit',submitPartialSale);byId('partial-size').addEventListener('input',previewPartialSale);
  byId('partial-size-mode').addEventListener('change',()=>{sizeModeChanged('partial',partialPositionId);previewPartialSale();});
  document.querySelectorAll('[data-sale-percent]').forEach(b=>b.addEventListener('click',()=>{byId('partial-size-mode').value='percent';byId('partial-size').value=b.dataset.salePercent;previewPartialSale();}));
  window.addEventListener('storage',event=>{if([keys.positions,keys.history].includes(event.key)){try{syncStoredPortfolio();renderPortfolio();}catch(e){notice(e.message);}}});
  loadPositionPaths();setInterval(loadPositionPaths,10000);
  loadPositionTargets();setInterval(loadPositionTargets,15000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadPositionPaths();});
});
