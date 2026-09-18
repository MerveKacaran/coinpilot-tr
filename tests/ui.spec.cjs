// Developer test: controlled API fixtures; never submits real exchange orders.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const base=process.env.TEST_URL||'http://127.0.0.1:10001';
const names={one_hour:'1 Saat',four_hour:'4 Saat',five_minute:'5 Dakika',fifteen_minute:'15 Dakika',daily:'Günlük'};
let price=100,entryPrice=102,quotePrice=105,failedQuote=false,analyzeCalls=0,testBrowser,unsafeMode=0,exitCalls=0,buyScore=86,buyChecks=5,delayFrame=false;
const quote=(value=price)=>({symbol:'TEST/TRY',pair:'TESTTRY',price:value,change:3,bid:value-.02,ask:value+.02,price_updated_at:new Date().toISOString(),price_source:'Test fixture'});
function exitFixture(frames){return{status:'success',symbol:'TEST/TRY',frames:Object.fromEntries(frames.map(k=>[k,{name:names[k],count:3,stage:'SATIŞ UYARISI',closed_at:Math.floor(Date.now()/1000)-300,checks:['EMA8','MACD','Fisher(30)','RSI(10)'].map((label,i)=>({label,ok:i<3,value:1,reason:label==='MACD'?'MACD sıfır üstünde; aşağı kesişim.':'Fixture çıkış koşulu'}))}])),errors:[],analyzed_at:new Date().toISOString()};}
function signal(frames=['one_hour'],fresh=false){const chart=Array.from({length:120},(_,i)=>({time:Math.floor(Date.now()/1000)-(121-i)*300,open:99+i*.005,close:99.03+i*.005,high:99.12+i*.005,low:98.9+i*.005,volume:100+i,ema:98.5+i*.004,rsi:53+Math.sin(i/10)*2,macd:.02+Math.sin(i/20)*.01,macd_signal:.015+Math.sin(i/20)*.01,fisher:.3+Math.sin(i/20)*.1,fisher_signal:.28+Math.sin(i/20)*.1}));return{coin:quote(fresh?entryPrice:100),frame_keys:frames,frames:Object.fromEntries(frames.map(k=>[k,{name:names[k],core_pass:true,checks_passed:5,volume_ratio:1.6,checks:['EMA200','RSI10','MACD','Fisher30','Hacim'].map(label=>({label,ok:true,value:1,reason:'Fixture koşulu'})),chart,closed_at:chart.at(-1).time+300,trend_break:true,retest:true}])),score:86,action:'AL İZLE',can_open_trade:true,risk_ok:true,all_frames_passed:true,chart_frame:frames[0],levels_frame:frames[0],chart:chart.map(p=>p.close),radar:[...frames.map(()=>1),1,.3],fib:{'618':99,'786':98,support:98,resistance:110},target:frames[0]==='fifteen_minute'?114:frames[0]==='five_minute'?108:110,stop:98,target_pct:10,stop_pct:2,risk_reward:5,analyzed_at:new Date().toISOString(),summary:frames.map(k=>names[k]+' 5/5: tüm koşullar sağlandı.')};}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});testBrowser=browser;const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{const u=new URL(route.request().url()),frames=(u.searchParams.get('frames')||'one_hour').split(',');let data;
    if(u.pathname==='/api/dashboard')data={status:'success',quotes:{'TEST/TRY':quote()},live:true,gainers:[quote()],losers:[quote()]};
    else if(u.pathname==='/api/radar'){const item={...signal(frames),score:buyScore,can_open_trade:buyChecks===5};for(const f of Object.values(item.frames)){f.checks_passed=buyChecks;f.core_pass=buyChecks===5;}data={status:'success',items:[item],scanning:false,scanned:1,total:1,errors:[],updated_at:new Date().toISOString()};}
    else if(u.pathname==='/api/analyze'){analyzeCalls++;if(delayFrame&&frames[0]==='one_hour')await new Promise(resolve=>setTimeout(resolve,500));data={status:'success',item:signal(frames,u.searchParams.get('fresh')==='1')};if(unsafeMode)Object.assign(data.item,{can_open_trade:false,all_frames_passed:false,risk_ok:false,sell_setup:true,action:'SAT',stop:unsafeMode===1?75:null,target:unsafeMode===1?110:null});}
    else if(u.pathname==='/api/quote'){if(failedQuote){await route.fulfill({status:503,json:{status:'error',message:'Fixture bağlantı hatası'}});return;}data={status:'success',coin:quote(quotePrice)};}
    else if(u.pathname==='/api/exit'){exitCalls++;data=exitFixture(frames);}
    else if(u.pathname==='/api/backtest')data={status:'success',frame:'five_minute',result:{bars:400,from_time:1700000000,to_time:1701000000,trade_count:10,net_return_pct:2,win_rate:60,max_drawdown_pct:3,profit_factor:1.3,note:'Kontrollü test'}};
    else throw Error('Unexpected API: '+u.pathname);
    await route.fulfill({json:data});
  });
  await page.goto(base);await page.locator('[data-page=radar]').click();await page.locator('#radar-grid .signal').waitFor();
  for(const k of Object.keys(names)){for(const input of await page.locator('#timeframe-controls input').all())await input.uncheck();await page.locator('#timeframe-controls input[value='+k+']').check();await page.locator('#apply-timeframes').click();await page.waitForFunction(name=>document.querySelector('#radar-grid .frame')?.textContent.includes(name),names[k]);assert.match(await page.locator('#radar-grid').textContent(),/5\/5/);}
  await page.locator('[data-page=market]').click();await page.locator('#market-search-input').fill('test/try');await page.locator('#market-search-button').click();await page.locator('#market-analysis .signal').waitFor();
  assert.match(await page.locator('#market-analysis .price').textContent(),/100/);price=101;
  await page.waitForFunction(()=>document.querySelector('#market-analysis .price')?.textContent.includes('101'),null,{timeout:6000});
  await page.getByRole('button',{name:'GRAFİK & DETAY',exact:true}).last().click();await page.locator('#detail-dialog').waitFor({state:'visible'});assert.match(await page.locator('#detail-content .price').textContent(),/101/);
  await fs.mkdir(path.join(__dirname,'../test-output'),{recursive:true});await page.screenshot({path:path.join(__dirname,'../test-output/chart-desktop.png')});
  await page.locator('#detail-content').getByRole('button',{name:'GEÇMİŞİ TEST ET'}).click();await page.waitForFunction(()=>document.querySelector('.test-result')?.textContent.includes('Düşük örneklem'));
  const pixels=await page.locator('.chart-panel canvas').evaluate(c=>{const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<a.length;i+=4)if(a[i])n++;return n;});assert.ok(pixels>1000,'Candlestick chart rendered');
  await fs.mkdir(path.join(__dirname,'../test-output'),{recursive:true});await page.screenshot({path:path.join(__dirname,'../test-output/detail-desktop.png')});
  await page.locator('[data-close=detail-dialog]').click();await page.locator('#market-analysis').getByRole('button',{name:'SANAL İŞLEM AÇ',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#trade-submit').disabled);assert.match(await page.locator('#trade-entry').textContent(),/102/);entryPrice=103;
  await page.locator('#trade-frame').selectOption('five_minute');await page.waitForFunction(()=>!document.querySelector('#trade-submit').disabled&&state.selected?.frame_keys[0]==='five_minute');
  assert.match(await page.locator('#trade-target').textContent(),/108.*%/);assert.match(await page.locator('#trade-stop').textContent(),/98.*-.*%/);
  delayFrame=true;await page.locator('#trade-frame').selectOption('one_hour');await page.locator('#trade-frame').selectOption('fifteen_minute');
  await page.waitForFunction(()=>!document.querySelector('#trade-submit').disabled&&state.selected?.frame_keys[0]==='fifteen_minute');
  await page.waitForTimeout(650);assert.deepEqual(await page.evaluate(()=>state.selected.frame_keys),['fifteen_minute'],'Slow old response cannot replace selected plan');delayFrame=false;
  assert.match(await page.locator('#trade-target').textContent(),/114.*%/);
  await page.screenshot({path:path.join(__dirname,'../test-output/selected-plan.png')});
  await page.locator('#trade-submit').click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('coinpilot-pro-positions')||'[]').length===1);let position=await page.evaluate(()=>JSON.parse(localStorage.getItem('coinpilot-pro-positions'))[0]);assert.ok(position.entry>103&&position.entry<104);assert.equal(position.fee,.001);assert.deepEqual(position.frames,['fifteen_minute']);assert.equal(position.target,114);assert.ok(analyzeCalls>=3);
  await page.waitForFunction(()=>document.querySelector('#exit-grid')?.textContent.includes('SATIŞ UYARISI'));
  assert.ok(exitCalls>0,'Opening a position starts sell monitoring automatically');
  await page.locator('[data-page=exits]').click();await page.locator('#exit-grid summary').first().click();assert.match(await page.locator('#exit-grid').textContent(),/MACD sıfır üstünde/);
  await page.screenshot({path:path.join(__dirname,'../test-output/exit-desktop.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('coinpilot-pro-positions')).length),1,'Sell warning must not automatically close the position');
  await page.locator('[data-page=positions]').click();assert.match(await page.locator('#position-page-list').textContent(),/Tahmini net K\/Z/);assert.match(await page.locator('#position-page-list').textContent(),/Hedef.*114.*%.*Stop.*98.*%/);assert.match(await page.locator('#position-page-list').textContent(),/Plan periyodu: 15 Dakika/);
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-backup').click();const download=await downloadPromise;const backupPath=await download.path();const backup=JSON.parse(await fs.readFile(backupPath,'utf8'));assert.equal(backup.positions.length,1);
  // A malformed import cannot mutate the portfolio.
  await page.locator('#import-backup').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...backup,positions:[{...position,quantity:-1}]}))});await page.waitForFunction(()=>document.querySelector('#backup-message').textContent.includes('geçersiz'));assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('coinpilot-pro-positions')).length),1);
  failedQuote=true;await page.locator('#position-page-list').getByRole('button',{name:'SANAL SAT',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Pozisyon açık tutuldu'));assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('coinpilot-pro-positions')).length),1);
  failedQuote=false;await page.locator('#position-page-list').getByRole('button',{name:'SANAL SAT',exact:true}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('coinpilot-pro-positions')).length===0);const history=await page.evaluate(()=>JSON.parse(localStorage.getItem('coinpilot-pro-history'))[0]);assert.ok(history.exit>104&&history.exit<105);assert.ok(Number.isFinite(history.pnl));
  assert.equal(await page.locator('#exit-grid .position').count(),0,'Closed positions leave sell monitoring');
  // Old backup must not reopen a subsequently closed position.
  await page.locator('#import-backup').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.waitForFunction(()=>document.querySelector('#backup-message').textContent.includes('birleştirildi'));assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('coinpilot-pro-positions')).length),0);
  const mobile=await context.newPage();await mobile.setViewportSize({width:390,height:844});mobile.on('pageerror',e=>errors.push(e.message));await mobile.route('**/api/**',async route=>{const url=new URL(route.request().url()),frames=(url.searchParams.get('frames')||'five_minute').split(',');await route.fulfill({json:url.pathname==='/api/dashboard'?{status:'success',quotes:{'TEST/TRY':quote()},live:true,gainers:[quote()],losers:[quote()]}:url.pathname==='/api/exit'?exitFixture(frames):url.pathname==='/api/analyze'?{status:'success',item:signal(frames,true)}:{status:'success',items:[signal(frames)],scanning:false,scanned:1,total:1,errors:[]}});});
  await mobile.goto(base);await mobile.locator('#menu-toggle').click();await mobile.locator('[data-page=radar]').click();await mobile.locator('#radar-grid .signal').waitFor();await mobile.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().right<=1);assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile has no horizontal overflow');await mobile.screenshot({path:path.join(__dirname,'../test-output/radar-mobile.png'),fullPage:true});
  await mobile.locator('#radar-grid').getByRole('button',{name:'SANAL İŞLEM AÇ',exact:true}).click();await mobile.waitForFunction(()=>!document.querySelector('#trade-submit').disabled);await mobile.locator('#trade-submit').scrollIntoViewIfNeeded();const buttonBox=await mobile.locator('#trade-submit').boundingBox();assert.ok(buttonBox.y+buttonBox.height<844-20,'Trade button has bottom clearance');await mobile.screenshot({path:path.join(__dirname,'../test-output/trade-mobile.png')});
  for(unsafeMode=1;unsafeMode<=2;unsafeMode++){
    await page.locator('[data-page=market]').click();await page.locator('#market-search-button').click();await page.waitForFunction(()=>document.querySelector('#market-analysis .badge')?.textContent.includes('SAT'));
    await page.locator('#market-analysis').getByRole('button',{name:'SANAL İŞLEM AÇ',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#trade-submit').disabled);
    assert.match(await page.locator('#trade-message').textContent(),/SAT sinyali/);
    assert.match(await page.locator('#trade-message').textContent(),unsafeMode===1?/%8 üzerinde/:/stop belirlenemedi/);
    await page.locator('#trade-submit').click();await page.waitForFunction(n=>JSON.parse(localStorage.getItem('coinpilot-pro-positions')).length===n,unsafeMode);
  }
  await page.reload();await page.locator('[data-page=positions]').click();assert.equal(await page.locator('#position-page-list .position').count(),2);
  assert.match(await page.locator('#position-page-list').textContent(),/Hedef belirlenmedi/);
  assert.doesNotMatch(await page.locator('#alerts-list').textContent(),/Hedef seviyesine ulaştı/);
  // Each page and a reload must start at the top, on desktop and mobile.
  await mobile.locator('#trade-dialog').evaluate(dialog=>dialog.close());
  for(const surface of [page,mobile]){
    for(const destination of ['market','radar','positions','exits','home']){
      await surface.evaluate(()=>{window.scrollTo(0,document.documentElement.scrollHeight);document.querySelector('#sidebar').classList.add('open');});
      await surface.locator('[data-page='+destination+']').click();
      await surface.waitForFunction(()=>window.scrollY<=1);
      assert.equal(await surface.evaluate(()=>window.scrollY),0,'Page '+destination+' opens at top');
    }
    await surface.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await surface.reload();
    await surface.waitForFunction(()=>window.scrollY<=1);
  }
  await page.locator('[data-page=positions]').click();
  const scrollAfterRefresh=await page.evaluate(async()=>{window.scrollTo(0,180);const before=window.scrollY;await loadDashboard();return[before,window.scrollY];});
  assert.ok(scrollAfterRefresh[0]>0);assert.equal(scrollAfterRefresh[1],scrollAfterRefresh[0],'Live refresh must not reset scroll');
  await page.locator('[data-page=radar]').click();await page.locator('#radar-grid').getByRole('button',{name:'GRAFİK & DETAY',exact:true}).first().click();
  await page.locator('#detail-dialog').evaluate(dialog=>{dialog.scrollTop=dialog.scrollHeight;dialog.close();});
  await page.locator('#radar-grid').getByRole('button',{name:'GRAFİK & DETAY',exact:true}).first().click();
  await page.waitForFunction(()=>document.querySelector('#detail-dialog').scrollTop===0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'),'false','No sound enabled without a gesture');
  await page.locator('#sound-toggle').click();await page.waitForFunction(()=>document.querySelector('#sound-toggle').getAttribute('aria-pressed')==='true');
  await page.evaluate(()=>{window.__soundNodes=0;const original=audioContext.createOscillator.bind(audioContext);audioContext.createOscillator=()=>{window.__soundNodes++;return original();};lastSoundAt=-Infinity;});
  buyScore=65;buyChecks=3;await page.evaluate(()=>{state.alertStates.clear();notificationCooldowns.clear();byId('notification-toasts').replaceChildren();});await page.evaluate(()=>loadRadar(true));assert.equal(await page.locator('#notification-toasts .tone-buy').count(),0,'3/5 is not an AL alarm');buyChecks=4;await page.evaluate(()=>loadRadar(true));
  await page.waitForFunction(()=>document.querySelector('#notification-toasts').textContent.includes('4/5 koşul'));
  assert.equal(await page.evaluate(()=>window.__soundNodes),4,'A qualifying buy emits a stronger four-note sound');
  assert.equal(await page.locator('#notification-toasts .tone-buy').count(),1);
  assert.equal(await page.locator('#notification-toasts .tone-buy small').evaluate(n=>getComputedStyle(n).color),'rgb(73, 223, 174)');
  await page.locator('#notification-toasts .tone-buy .notification-link').click();
  await page.waitForFunction(()=>state.page==='market'&&state.marketSymbol==='TEST/TRY'&&!marketBusy);
  assert.equal(await page.locator('#market-search-input').inputValue(),'TEST/TRY');
  assert.equal(await page.locator('#market-analysis .signal-badge-sell').evaluate(n=>getComputedStyle(n).color),'rgb(255, 143, 160)');
  await page.locator('[data-page=radar]').click();
  await page.evaluate(()=>loadRadar(true));assert.equal(await page.evaluate(()=>window.__soundNodes),4,'Unchanged signals do not repeat the sound');
  await page.locator('#sound-toggle').click();await page.evaluate(()=>alertOnce('muted-test','warning','Sadece yazılı bildirim testi'));
  assert.match(await page.locator('#notification-toasts').textContent(),/Sadece yazılı/);assert.equal(await page.evaluate(()=>window.__soundNodes),4);
  await page.locator('#alerts-enabled').uncheck();const alertCount=await page.evaluate(()=>state.alerts.length);
  await page.evaluate(()=>alertOnce('disabled-test','warning','Görünmemeli'));assert.equal(await page.evaluate(()=>state.alerts.length),alertCount);
  await page.locator('#alerts-enabled').check();
  await page.evaluate(()=>{const p={id:'loss-test',coin:{symbol:'LOSS/TRY'}},q={price:100,price_updated_at:new Date().toISOString()};notifyPositionLoss(p,1,q);notifyPositionLoss(p,-.5,q);notifyPositionLoss(p,-.6,q);});
  assert.equal(await page.evaluate(()=>state.alerts.filter(a=>a.message.includes('LOSS/TRY')&&a.message.includes('net zarara geçti')).length),1);
  await page.screenshot({path:path.join(__dirname,'../test-output/notifications.png')});
  const sellThresholds=await page.evaluate(()=>{
    const p={coin:{symbol:'THRESH/TRY'},frames:['five_minute']},data={frames:{five_minute:{name:'5 Dakika',count:2}},errors:[]};
    const count=()=>state.alerts.filter(a=>a.message.includes('THRESH/TRY')).length;
    notifyExit(p,data);const below=count();data.frames.five_minute.count=3;notifyExit(p,data);const at=count();data.frames.five_minute.count=4;notifyExit(p,data);
    return{below,at,above:count(),message:state.alerts.find(a=>a.message.includes('THRESH/TRY'))?.message};
  });
  assert.deepEqual([sellThresholds.below,sellThresholds.at,sellThresholds.above],[0,1,1],'Only 3/4+ triggers SAT; continued qualification is deduplicated');
  assert.match(sellThresholds.message,/5 Dakika 3\/4/);
  assert.match(await page.evaluate(()=>levelText(110,100)),/\+10\.00%/);assert.match(await page.evaluate(()=>levelText(95,100)),/-5\.00%/);
  assert.equal(await page.evaluate(()=>levelText(null,100)),'Belirlenemedi');
  // Background indicators show both signal types and clear when returning.
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});alertOnce('tab-buy','new','TEST/TRY · AL sekme testi','buy');alertOnce('tab-sell','new','TEST/TRY · SAT sekme testi','sell');});
  assert.match(await page.title(),/🟢 AL 1.*🔴 SAT 1/);
  const favicon=decodeURIComponent(await page.locator('#app-favicon').getAttribute('href'));
  assert.ok(favicon.includes('#ff7185')&&favicon.includes('#49dfae'));
  assert.equal(await page.locator('#notification-toasts .tone-sell small').first().evaluate(n=>getComputedStyle(n).color),'rgb(255, 113, 133)');
  const hiddenPoll=page.waitForRequest(r=>r.url().includes('/api/dashboard'));
  await page.evaluate(()=>{lastBackgroundPoll=0;pollDashboard();});await hiddenPoll;
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await page.title(),'CoinPilot TR · Teknik Radar');
  await page.locator('#alerts-list .tone-sell .notification-link').first().click();
  await page.waitForFunction(()=>state.page==='market'&&state.marketSymbol==='TEST/TRY');
  await page.reload();assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'),'false','Explicit mute survives reload');
  await page.locator('[data-page=radar]').click();await page.locator('#sound-toggle').click();
  await page.locator('#sound-volume').fill('90');
  await page.reload();assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'),'true','Enabled preference survives reload');
  assert.equal(await page.locator('#sound-volume').inputValue(),'90','Volume survives reload');
  // Simulate browser autoplay denial: preference stays on, retry stays available.
  await page.addInitScript(()=>{window.AudioContext=class{state='suspended';addEventListener(){}resume(){return Promise.reject(Error('Tarayıcı sesi engelledi'));}};});
  await page.reload();await page.locator('[data-page=radar]').click();
  await page.waitForFunction(()=>document.querySelector('#sound-status').textContent.includes('tercihin korundu'));
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#sound-resume').isVisible(),true);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('coinpilot-pro-sound'))),true);
  await page.locator('#sound-toggle').click();await page.reload();
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'),'false');
  assert.deepEqual(errors,[]);await browser.close();console.log('PASS: all UI flows, desktop/mobile scroll reset, refresh scroll preservation, dialog reset, sound opt-in, 4/5 buy threshold, per-position timeframe plan, price/percent levels, deduplication, mute and net-loss alerts.');
}
main().catch(async e=>{console.error(e);await testBrowser?.close();process.exitCode=1;});
