const {chromium}=require('playwright');
const assert=require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context=await browser.newContext({viewport:{width:1100,height:850}});
  let price=100,exitCount=0;
  const now=()=>Math.floor(Date.now()/1000),iso=t=>new Date(t*1000).toISOString();
  const q=()=>({symbol:'TEST/TRY',pair:'TESTTRY',price,bid:price,change:0,volume_try:100000,price_updated_at:iso(now()),price_source:'TEST'});
  await context.addInitScript(()=>{
    window.__audioEvents=[];
    class FakeAudioContext{
      constructor(){this.state='running';this.currentTime=100;this.destination={};}
      addEventListener(){} async resume(){this.state='running';}
      createOscillator(){const item={type:'',frequency:{value:0},connect(){},disconnect(){},onended:null,start(at){window.__audioEvents.push({event:'start',at,type:this.type,frequency:this.frequency.value});},stop(at){window.__audioEvents.push({event:'stop',at,type:this.type,frequency:this.frequency.value});}};return item;}
      createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
    }
    window.AudioContext=FakeAudioContext;
    const now=Math.floor(Date.now()/1000),iso=t=>new Date(t*1000).toISOString(),base={coin:{symbol:'TEST/TRY'},entry:100,amount:1000,quantity:10,fee:.001,slippage:.001,openedAt:iso(now-3600),frames:['one_hour']};
    localStorage.setItem('coinpilot-pro-positions',JSON.stringify([{...base,id:'target',target:110,stop:70},{...base,id:'stop',target:150,stop:90},{...base,id:'signal',target:200,stop:50,autoSell:{enabled:true,enabledAt:iso(now-300),updatedAt:iso(now-300)}}]));
    localStorage.setItem('coinpilot-pro-history','[]');localStorage.setItem('coinpilot-pro-sound','true');localStorage.setItem('coinpilot-pro-alerts','true');
  });
  await context.route('**/api/**',async route=>{
    const u=new URL(route.request().url());let d={status:'success'};
    if(u.pathname==='/api/dashboard')d={...d,live:false,quotes:{'TEST/TRY':q()},gainers:[q()],losers:[q()]};
    else if(u.pathname==='/api/radar')d={...d,items:[],scanning:false,scanned:0,total:0,errors:[]};
    else if(u.pathname==='/api/targets')d={...d,symbol:'TEST/TRY',frames:{fifteen_minute:{target:99},one_hour:{target:105},daily:{target:120}},errors:[],analyzed_at:iso(now())};
    else if(u.pathname==='/api/exit')d={...d,symbol:'TEST/TRY',frames:{one_hour:{count:exitCount,checks:[],name:'1 Saat',stage:'İzle'}},errors:[],analyzed_at:iso(now())};
    else if(u.pathname==='/api/price-path')d={...d,symbol:'TEST/TRY',candles:[],through:Math.floor(now()/60)*60,missing_minutes:0,clipped:false,has_more:false};
    else return route.fulfill({status:503,json:{status:'error',message:'Testte kapalı'}});
    await route.fulfill({json:d});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:10001/');
  await page.waitForFunction(()=>targetCache.get('TEST/TRY')?.data);
  await page.evaluate(()=>switchPage('positions'));
  const targetStatuses=await page.locator('#page-positions [data-position-id="target"] .target-status').allTextContents();
  assert.deepEqual(targetStatuses,['✓','✕','✕']);

  price=111;await page.evaluate(()=>loadDashboard());
  await page.waitForFunction(()=>state.positions.find(p=>p.id==='target')?.tracking?.targetHit);
  let starts=await page.evaluate(()=>window.__audioEvents.filter(x=>x.event==='start'));
  assert.equal(starts.length,20);assert.equal(starts[0].type,'sine');assert.ok(starts.at(-1).at-starts[0].at>=9.5);
  await page.locator('#page-positions [data-position-id="target"] .auto-sell-toggle input').check();
  await page.waitForFunction(()=>state.history.some(h=>h.positionId==='target'));
  assert.equal(await page.evaluate(()=>state.history.find(h=>h.positionId==='target').method),'auto-target');

  price=85;await page.evaluate(()=>loadDashboard());
  await page.waitForFunction(()=>state.positions.find(p=>p.id==='stop')?.tracking?.stopHit);
  starts=await page.evaluate(()=>window.__audioEvents.filter(x=>x.event==='start'));
  assert.equal(starts.length,40);assert.equal(starts[20].type,'square');assert.ok(starts.at(-1).at-starts[20].at>=9.5);
  await page.locator('#page-positions [data-position-id="stop"] .auto-sell-toggle input').check();
  await page.waitForFunction(()=>state.history.some(h=>h.positionId==='stop'));
  assert.equal(await page.evaluate(()=>state.history.find(h=>h.positionId==='stop').method),'auto-stop');
  exitCount=3;await page.evaluate(()=>loadExitChecks(true));
  await page.waitForFunction(()=>state.history.some(h=>h.positionId==='signal'));
  assert.equal(await page.evaluate(()=>state.history.find(h=>h.positionId==='signal').method),'auto-signal');
  assert.deepEqual(errors,[]);
  console.log('PASS: period target status, 10-second target/stop alarms, opt-in automatic paper target/stop/technical sales');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
