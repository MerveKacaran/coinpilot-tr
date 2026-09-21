const form=document.getElementById('analyze-form');
const $=id=>document.getElementById(id);
const money=value=>Number.isFinite(value)?'₺'+new Intl.NumberFormat('tr-TR',{maximumFractionDigits:4}).format(value):'Belirlenemedi';
const precise=value=>Number.isFinite(value)?new Intl.NumberFormat('tr-TR',{maximumFractionDigits:3}).format(value):'—';
let current=null;

function line(ctx,points,color,width=2,dash=[]){
  ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);
  points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();ctx.setLineDash([]);
}

function drawChart(){
  if(!current)return;
  const canvas=$('price-chart'),ratio=Math.min(window.devicePixelRatio||1,2),width=canvas.clientWidth,height=250;
  canvas.width=Math.max(1,Math.round(width*ratio));canvas.height=Math.round(height*ratio);
  const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);
  const chart=current.frames[current.frame].chart;
  if(!chart.length)return;
  const levels=[current.target,current.stop].filter(Number.isFinite);
  const values=chart.flatMap(p=>[p.close,p.ema]).concat(levels);
  const low=Math.min(...values),high=Math.max(...values),pad=(high-low||1)*.12;
  const bottom=low-pad,top=high+pad,left=45,right=width-12,base=height-22,ceiling=16;
  const X=i=>left+i*(right-left)/Math.max(1,chart.length-1);
  const Y=v=>base-(v-bottom)/(top-bottom)*(base-ceiling);
  ctx.font='10px system-ui';ctx.fillStyle='#7890ab';ctx.strokeStyle='#203650';ctx.lineWidth=1;
  for(let i=0;i<4;i++){const v=bottom+(top-bottom)*i/3,y=Y(v);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillText(precise(v),2,y+3);}
  line(ctx,chart.map((p,i)=>[X(i),Y(p.ema)]),'#ffd071',1.6);
  line(ctx,chart.map((p,i)=>[X(i),Y(p.close)]),'#7fb0ff',2.4);
  if(Number.isFinite(current.target))line(ctx,[[left,Y(current.target)],[right,Y(current.target)]],'#35d5a1',1,[5,4]);
  if(Number.isFinite(current.stop))line(ctx,[[left,Y(current.stop)],[right,Y(current.stop)]],'#fa6d82',1,[5,4]);
  ctx.fillStyle='#7fb0ff';ctx.beginPath();ctx.arc(X(chart.length-1),Y(chart.at(-1).close),3.5,0,Math.PI*2);ctx.fill();
}

function addCheck(check){
  const card=document.createElement('div');card.className='check '+(check.ok?'ok':'no');
  const heading=document.createElement('div');heading.className='check-top';
  const label=document.createElement('span');label.textContent=check.label;
  const result=document.createElement('span');result.textContent=check.ok?'✓ UYGUN':'× EKSİK';
  heading.append(label,result);
  const reason=document.createElement('p');reason.textContent=check.reason;
  card.append(heading,reason);return card;
}

function indicator(label,value,note){
  const card=document.createElement('div'),name=document.createElement('small'),number=document.createElement('b'),caption=document.createElement('span');
  name.textContent=label;number.textContent=precise(value);caption.textContent=note;card.append(name,number,caption);return card;
}

function render(signal){
  current=signal;const frame=signal.frames[signal.frame];
  $('result').hidden=false;
  $('result-symbol').textContent=signal.coin.symbol+' · '+frame.name;
  const barTime=new Date(signal.source_time).toLocaleString('tr-TR',signal.frame==='daily'?{dateStyle:'long'}:{dateStyle:'long',timeStyle:'short'});
  $('result-source').textContent='Kaynak: '+signal.data_source+' · Son '+(signal.frame==='daily'?'günlük mum':'mum başlangıcı')+': '+barTime;
  $('result-price').textContent=money(signal.coin.price);
  $('result-count').textContent=frame.checks_passed+'/5';
  $('result-target').textContent=money(signal.target);
  $('result-stop').textContent=money(signal.stop);
  const badge=$('result-badge');badge.textContent='DOSYA ANALİZİ · '+signal.action+' · '+Math.round(signal.score)+'/100';
  badge.className='badge'+(signal.sell_setup?' danger':frame.checks_passed<5?' warn':'');
  const stale=signal.data_age_hours>(signal.frame==='daily'?120:Math.max(4,signal.frame==='four_hour'?12:signal.frame==='one_hour'?4:2));
  $('result-warning').textContent=(stale?'⚠ Veri eski olabilir ('+precise(signal.data_age_hours)+' saat). ':'')+signal.caveat+' Puan kazanma ihtimali değildir; dosyadaki son kapanış gerçek zamanlı alım/satım fiyatı olarak kullanılmamalı.';
  $('checks').replaceChildren(...frame.checks.map(addCheck));
  $('indicator-details').replaceChildren(
    indicator('EMA200',frame.ema200,frame.above_ema200?'Kapanış üstünde':'Kapanış altında'),
    indicator('RSI(10)',frame.rsi,frame.rsi_cross_up?'50 yukarı kesildi':frame.rsi_rising?'Yukarı ivmeleniyor':'Yukarı teyit yok'),
    indicator('MACD',frame.chart.at(-1).macd,frame.macd_cross_up?'Yukarı kesişim':frame.macd_bullish?'Mavi çizgi üstün ve yükseliyor':'Yukarı teyit yok'),
    indicator('Fisher(30)',frame.fisher,frame.fisher_cross_up?'Yukarı kesişim':frame.fisher_bullish?'Mavi çizgi üstün ve yükseliyor':'Yukarı teyit yok'),
    indicator('Hacim / ortalama',frame.volume_ratio,frame.above_average_volume?'Ortalamanın üzerinde':'Ortalamanın altında'),
    indicator('Trend kırılımı',frame.trend_break?1:0,frame.trend_break?frame.retest?'Kırılım ve retest':'Kırılım; retest yok':'Teyitli kırılım yok')
  );
  requestAnimationFrame(drawChart);
  $('result').scrollIntoView({behavior:'smooth',block:'start'});
}

form.addEventListener('submit',async event=>{
  event.preventDefault();const file=$('file').files[0],button=$('analyze-button');
  if(!file)return;
  if(file.size>2_000_000){$('message').textContent='Dosya en fazla 2 MB olabilir.';return;}
  $('message').textContent='Kapanmış mumlar ve teknik koşullar hesaplanıyor…';button.disabled=true;
  try{
    const response=await fetch('/api/bist/analyze',{method:'POST',body:new FormData(form)});
    const data=await response.json();
    if(!response.ok||data.status!=='success')throw Error(data.message||'Analiz başarısız.');
    render(data.result);$('message').textContent='Analiz tamamlandı; dosya sunucuda kalıcı olarak saklanmadı.';
  }catch(error){$('message').textContent=error.message;}
  finally{button.disabled=false;}
});
window.addEventListener('resize',()=>requestAnimationFrame(drawChart));
