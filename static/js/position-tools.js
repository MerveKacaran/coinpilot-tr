'use strict';
// Separate from the research observer: these are this browser's own paper positions.
let pathBusy=false,orderPositionId=null,orderDisplayedQuantity=null,partialPositionId=null,partialDisplayedQuantity=null,targetsBusy=false;
const pathDue=new Map(),pathErrors=new Map();
const targetCache=new Map(),targetFrames=[['fifteen_minute','15 dakika'],['one_hour','Saatlik'],['daily','Günlük']];
function targetPanel(p){
  const box=el('section','period-targets'),cached=targetCache.get(symbolOf(p));
  box.append(el('b','','PERİYOT HEDEFLERİ · GÜNCEL ANALİZ'));
  for(const [key,label] of targetFrames){const row=el('div','period-target-row'),f=cached?.data?.frames?.[key];row.append(el('span','',label),el('strong','',f?levelText(f.target,p.entry):(cached?.error?'Alınamadı':'Bekleniyor…')));box.append(row);}
  box.append(el('small','muted','Yüzdeler senin giriş fiyatına göredir. Bunlar ayrı analizlerdir; kayıtlı hedefi veya satış emrini değiştirmez.'));
  if(cached?.data)box.append(el('small','muted','Analiz: '+timeText(cached.data.analyzed_at)));
  if(cached?.error)box.append(el('p','stale',cached.error+' Gösterilen eski hedefler güncel kabul edilmemeli.'));
  if(cached?.data?.errors?.length)box.append(el('p','stale',cached.data.errors.map(e=>(targetFrames.find(x=>x[0]===e.frame)?.[1]||e.frame)+': veri eksik').join(' · ')));
  box.append(btn('HEDEFLERİ YENİLE','link',()=>{if(targetCache.has(symbolOf(p)))targetCache.get(symbolOf(p)).at=0;loadPositionTargets();}));return box;
}
async function loadPositionTargets(){
  if(targetsBusy)return;targetsBusy=true;
  const pending=[...new Set(state.positions.map(symbolOf))].filter(s=>Date.now()-(targetCache.get(s)?.at||0)>180000);
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
  if(o?.status==='pending'){
    box.append(el('p','pending-order','BEKLEYEN SANAL SATIŞ · '+levelText(o.price,p.entry)+' · '+(o.quantity??p.quantity).toLocaleString('tr-TR',{maximumFractionDigits:10})+' adet'),el('small','muted','Oluşturuldu: '+timeText(o.createdAt)+' · '+(o.replay?'Açılışta geçmiş mum simülasyonu açık.':'Yalnızca sayfa çalışırken canlı gözlem.')));
    box.append(btn('EMRİ DEĞİŞTİR','link',()=>openSellOrder(p.id)),btn('EMRİ İPTAL ET','link',()=>cancelSellOrder(p.id)));
  }else box.append(btn('FİYATLA SANAL SATIŞ EMRİ','sell',()=>openSellOrder(p.id)));
  return box;
}
function executionLabel(source){return {'history-minute':'Geçmiş mumdan sanal limit satışı','live-bid':'Canlı alış kotasyonuyla sanal limit satışı','live-last':'Son işlem fiyatıyla sanal limit varsayımı'}[source]||'Manuel sanal satış';}
function executionHistory(p,f){
  return {id:f.orderId?'limit:'+f.orderId:crypto.randomUUID(),positionId:String(p.id),revision:f.revision,closesPosition:f.closesPosition,remainingQuantity:f.remaining?.quantity||0,remainingAmount:f.remaining?.amount||0,date:new Date(f.at*1000).toLocaleString('tr-TR'),closedAt:new Date(f.at*1000).toISOString(),recordedAt:new Date().toISOString(),coin:symbolOf(p),entry:p.entry,exit:f.exit,percent:f.percent,pnl:f.pnl,amount:f.amount,quantity:f.quantity,fee:p.fee||0,slippage:f.source==='manual'?(p.slippage||0):0,method:f.source,sellOrder:p.sellOrder,tracking:f.tracking||p.tracking,
    executionNote:(f.closesPosition?'Tam satış · ':'Parçalı satış · ')+f.quantity.toLocaleString('tr-TR',{maximumFractionDigits:10})+' adet · '+executionLabel(f.source)+(f.source==='manual'?'; komisyon ve kayma dahil.':'; seçilen adedin limit fiyatından dolduğu varsayılır. Komisyon düşüldü; emir sırası ve likidite modellenmez.')};
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
  try{await portfolioLock(()=>{syncStoredPortfolio();for(const p of [...state.positions]){if(state.closing.has(p.id))continue;commitPaperResult(Paper.observe(p,quoteFor(symbolOf(p))));}});}catch(e){notice(e.message);}
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
          commitPaperResult(Paper.reconcile(current,data));pathErrors.delete(current.id);
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
