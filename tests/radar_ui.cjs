const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 let radar={status:'success',items:[],scanning:false,scanned:1,successful:0,total:1,coverage:'unavailable',phase:'done',errors:[{symbol:'BTC/TRY',message:'Mum bağlantısı zaman aşımı'}]};
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({json:path==='/api/radar'?radar:{status:'success',quotes:{},gainers:[],losers:[],live:false}});});
 await page.goto('http://127.0.0.1:10001/crypto');
 await page.waitForFunction(()=>document.getElementById('radar-time').textContent.includes('Analiz yapılamadı'));
 assert.match(await page.locator('#radar-grid').innerText(),/analiz tamamlanamadı/);
 radar={...radar,scanning:true,phase:'retrying'};await page.evaluate(()=>loadRadar());
 assert.match(await page.locator('#radar-time').innerText(),/yeniden deneniyor/);
 radar={...radar,scanning:false,successful:1,errors:[],phase:'done',coverage:'complete'};await page.evaluate(()=>loadRadar());
 assert.match(await page.locator('#radar-time').innerText(),/1\/1 başarılı analiz/);
 assert.match(await page.locator('#radar-grid').innerText(),/Başarıyla analiz edilen/);
 assert.deepEqual(errors,[]);await browser.close();console.log('PASS: outage, retry, and genuine no-candidate states are distinct');
})().catch(e=>{console.error(e);process.exit(1);});
