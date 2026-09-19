/* Pure paper-position accounting; no network, browser storage or real orders. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.Paper=api;})(globalThis,function(){
  'use strict';
  const positive=x=>Number.isFinite(x)&&x>0,stamp=x=>Date.parse(x)/1000;
  const epoch=x=>positive(x)&&x<=8640000000000;
  const copy=x=>JSON.parse(JSON.stringify(x));
  function validExtras(p){
    const o=p.sellOrder,t=p.tracking;
    if(o!=null&&!(typeof o.id==='string'&&positive(o.price)&&typeof o.createdAt==='string'&&Number.isFinite(stamp(o.createdAt))&&['pending','cancelled','filled'].includes(o.status)&&typeof o.replay==='boolean'))return false;
    if(t!=null&&!(t.version===1&&[t.high,t.low].every(x=>x==null||positive(x))&&(t.through==null||epoch(t.through))&&['targetHit','stopHit'].every(k=>t[k]==null||epoch(t[k].at)&&['quote','minute'].includes(t[k].source))))return false;
    if(o?.quantity!=null&&!positive(o.quantity))return false;
    if(p.positionId==null&&o?.status==='pending'&&o.quantity!=null&&o.quantity>p.quantity*(1+1e-12))return false;
    if(p.revision!=null&&(!Number.isSafeInteger(p.revision)||p.revision<0))return false;
    if(p.positionId!=null&&!(typeof p.positionId==='string'&&typeof p.closesPosition==='boolean'&&Number.isSafeInteger(p.revision)&&p.revision>0&&Number.isFinite(p.remainingQuantity)&&p.remainingQuantity>=0&&Number.isFinite(p.remainingAmount)&&p.remainingAmount>=0))return false;
    return true;
  }
  function settle(p,quantity,exit){
    if(!positive(quantity)||!positive(exit)||!positive(p.quantity)||!positive(p.amount)||quantity>p.quantity*(1+1e-12))throw Error('Satış adedi sıfırdan büyük ve kalan adetten fazla olmamalı.');
    const closesPosition=quantity>=p.quantity*(1-1e-12);
    quantity=closesPosition?p.quantity:quantity;
    const amount=closesPosition?p.amount:p.amount*(quantity/p.quantity),pnl=quantity*exit*(1-(p.fee||0))-amount;
    if(!Number.isFinite(pnl)||!positive(amount))throw Error('Satış tutarı hesaplanamadı.');
    const revision=(p.revision||0)+1;
    if(!Number.isSafeInteger(revision))throw Error('Pozisyon sürümü geçersiz.');
    const remaining=closesPosition?null:{...copy(p),quantity:p.quantity-quantity,amount:p.amount-amount,revision};
    return {quantity,amount,exit,pnl,percent:pnl/amount*100,closesPosition,revision,remaining};
  }
  function tracking(p){
    return p.tracking||(p.tracking={version:1,high:null,low:null,through:null,targetHit:null,stopHit:null,incomplete:false});
  }
  function record(p,high,low,at,source){
    const t=tracking(p);
    if(t.high===null||high>t.high){t.high=high;t.highAt=at;}
    if(t.low===null||low<t.low){t.low=low;t.lowAt=at;}
    for(const [key,condition] of [['targetHit',positive(p.target)&&high>=p.target],['stopHit',positive(p.stop)&&low<=p.stop]]){
      if(condition&&(!t[key]||at<t[key].at))t[key]={at,source};
    }
  }
  function fill(p,at,source){
    const o=p.sellOrder;
    const sale=settle(p,o.quantity??p.quantity,o.price);
    o.status='filled';o.filledAt=at;o.source=source;
    if(sale.remaining)sale.remaining.sellOrder=copy(o);
    return {...sale,at,source,orderId:o.id,tracking:copy(p.tracking)};
  }
  function observe(position,q,now=Date.now()/1000){
    const p=copy(position),at=stamp(q?.price_updated_at),opened=stamp(p.openedAt);
    if(!positive(q?.price)||!Number.isFinite(at)||now-at>30||at>now+5||!Number.isFinite(opened)||at<opened)return {position:p,fill:null};
    const o=p.sellOrder,t=tracking(p);
    // Reconcile earlier minutes before deciding a replay-enabled order's fill.
    if(o?.status==='pending'&&o.replay&&(!t.through||t.through<Math.floor(now/60)*60))return {position:p,fill:null};
    record(p,q.price,q.price,at,'quote');
    const executable=positive(q.bid)?q.bid:q.price;
    if(o?.status==='pending'&&at>=stamp(o.createdAt)&&executable>=o.price)return {position:p,fill:fill(p,at,positive(q.bid)?'live-bid':'live-last')};
    return {position:p,fill:null};
  }
  function reconcile(position,data,now=Date.now()/1000){
    const p=copy(position),opened=stamp(p.openedAt),t=tracking(p);
    if(!Number.isFinite(opened))throw Error('İşlem açılış zamanı yok; geçmiş doğrulanamaz.');
    if(!Array.isArray(data.candles)||!Number.isFinite(data.through)||data.through>Math.ceil(now/60)*60)throw Error('Geçmiş zaman aralığı doğrulanamadı.');
    t.incomplete=!!t.incomplete||!!data.clipped||data.missing_minutes>0;
    t.openingMinuteUnknown=opened%60!==0;
    let execution=null;
    for(const c of [...data.candles].sort((a,b)=>a.time-b.time)){
      if(!positive(c.high)||!positive(c.low)||c.low>c.high||!Number.isFinite(c.time)||c.time%60!==0)throw Error('Geçersiz geçmiş mum.');
      if(c.time<Math.ceil(opened/60)*60||c.time+60>now||c.time>=data.through||c.volume<=0)continue;
      record(p,c.high,c.low,c.time,'minute');
      const o=p.sellOrder;
      if(o?.status==='pending'&&o.replay&&c.time>=Math.ceil(stamp(o.createdAt)/60)*60&&c.high>=o.price){execution=fill(p,c.time,'history-minute');if(execution.closesPosition)break;}
    }
    t.through=Math.max(t.through||0,data.through);t.checkedAt=now;
    return {position:p,fill:execution};
  }
  function mergePortfolio(current,incoming){
    const historyKey=h=>h.id!==undefined?'id:'+String(h.id):'legacy:'+JSON.stringify([h.date,h.coin,h.entry,h.exit,h.percent]);
    const events=new Map(current.history.map(h=>[historyKey(h),h]));
    for(const h of incoming.history){const key=historyKey(h),old=events.get(key);if(old&&JSON.stringify(old)!==JSON.stringify(h))throw Error('Aynı satış kimliğinde çelişen yedek kaydı var; içe aktarma durduruldu.');events.set(key,h);}
    const history=[...events.values()],latest=new Map(),branches=new Map(),closed=new Set();
    for(const h of history){
      if(h.positionId!=null){
        const branch=h.positionId+':'+h.revision,key=historyKey(h);
        if(branches.has(branch)&&branches.get(branch)!==key)throw Error('Aynı pozisyonda farklı cihaz satışları çakışıyor; otomatik birleştirme yapılmadı.');
        branches.set(branch,key);
        if(!latest.has(h.positionId)||latest.get(h.positionId).revision<h.revision)latest.set(h.positionId,h);
        if(h.closesPosition)closed.add(h.positionId);
      }else if(h.id!==undefined)closed.add(String(h.id));
    }
    const positions=new Map(current.positions.map(p=>[String(p.id),copy(p)]));
    for(const p of incoming.positions){const key=String(p.id),old=positions.get(key);if(!old||(p.revision||0)>(old.revision||0))positions.set(key,copy(p));}
    for(const [key,p] of positions){
      if(closed.has(key)){positions.delete(key);continue;}
      const sale=latest.get(key);
      if(sale&&sale.revision>(p.revision||0)){
        if(!positive(sale.remainingQuantity)||!positive(sale.remainingAmount))throw Error('Parçalı satış kalanı doğrulanamadı.');
        p.quantity=sale.remainingQuantity;p.amount=sale.remainingAmount;p.revision=sale.revision;
        if(p.sellOrder?.status==='pending')p.sellOrder.status='cancelled';
      }
      if(sale&&sale.revision===p.revision&&(Math.abs(p.quantity-sale.remainingQuantity)>p.quantity*1e-10||Math.abs(p.amount-sale.remainingAmount)>p.amount*1e-10))throw Error('Pozisyon kalanı ile satış geçmişi uyuşmuyor.');
    }
    return {positions:[...positions.values()],history};
  }
  return {observe,reconcile,validExtras,settle,mergePortfolio};
});
