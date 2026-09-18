// Read-only smoke of a deployed instance. No portfolio writes or trades.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs/promises');
let browser;
async function run(){
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://coinpilot-tr.onrender.com/',{waitUntil:'domcontentloaded',timeout:60000});
  assert.match(await page.locator('footer').textContent(),/4\.2\.1/);
  assert.equal(await page.locator('#sound-toggle').getAttribute('aria-pressed'),'false');
  for(const name of ['radar','positions','exits','market','home']){
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
    await page.locator('[data-page='+name+']').click();
    await page.waitForFunction(()=>window.scrollY===0);
  }
  await page.locator('[data-page=market]').click();await page.locator('#market-search-input').fill('BTC/TRY');await page.locator('#market-search-button').click();
  await page.locator('#market-analysis .signal').waitFor({timeout:60000});
  const before=await page.locator('#market-analysis .quote-stamp').textContent();
  await page.waitForFunction(old=>document.querySelector('#market-analysis .quote-stamp')?.textContent!==old,before,{timeout:20000});
  console.log('LIVE quote:',await page.locator('#market-analysis .price').textContent());
  console.log('LIVE stamp:',await page.locator('#market-analysis .quote-stamp').textContent());
  await fs.mkdir(path.join(__dirname,'../test-output'),{recursive:true});
  await page.screenshot({path:path.join(__dirname,'../test-output/live-market.png'),fullPage:true});
  await page.locator('#market-analysis').getByRole('button',{name:'GRAFİK & DETAY',exact:true}).click();
  await page.locator('#detail-dialog').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('.chart-panel canvas')?.width>100);
  await page.screenshot({path:path.join(__dirname,'../test-output/live-detail.png')});
  await page.locator('[data-close=detail-dialog]').click();
  await page.locator('[data-page=radar]').click();
  for(const input of await page.locator('#timeframe-controls input').all())await input.uncheck();
  await page.locator('#timeframe-controls input[value=five_minute]').check();await page.locator('#scan-limit').selectOption('8');await page.locator('#apply-timeframes').click();
  await page.waitForFunction(()=>document.querySelector('#radar-time').textContent.includes('Tamamlandı: 8/8'),null,{timeout:60000});
  console.log('LIVE radar:',await page.locator('#radar-time').textContent());
  console.log('LIVE data issues:',await page.locator('#scan-errors').textContent());
  assert.deepEqual(errors,[]);console.log('PASS deployed browser, real quotes changing timestamps, selected BTC detail, 5-minute scan, zero JS errors.');
  await browser.close();
}
run().catch(async e=>{console.error(e);await browser?.close();process.exitCode=1;});
