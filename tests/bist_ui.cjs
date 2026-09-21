const {chromium}=require('playwright');
const assert=require('node:assert/strict');

function csv(){
  const rows=['date,open,high,low,close,volume'];
  const end=new Date('2026-09-18T12:00:00Z');
  for(let i=0;i<230;i++){
    const day=new Date(end.getTime()-(229-i)*86400000).toISOString().slice(0,10);
    const p=100+i*.08+Math.sin(i/9)*.4;
    rows.push(`${day},${p.toFixed(4)},${(p+.5).toFixed(4)},${(p-.5).toFixed(4)},${p.toFixed(4)},${1000+i}`);
  }
  return Buffer.from(rows.join('\n'));
}

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:10001/');
    assert.equal(await page.locator('.choice').count(),2);
    await page.getByRole('link',{name:/Borsa İstanbul/}).click();
    assert.match(page.url(),/\/bist$/);
    await page.locator('#symbol').fill('THYAO');
    await page.locator('#file').setInputFiles({name:'THYAO.csv',mimeType:'text/csv',buffer:csv()});
    await page.locator('#analyze-button').click();
    await page.locator('#result').waitFor({state:'visible'});
    assert.match(await page.locator('#result').textContent(),/THYAO.*5.*EMA200.*RSI\(10\).*MACD.*Fisher\(30\)/s);
    assert.match(await page.locator('#result-source').textContent(),/canlı fiyat değil/);
    assert.ok((await page.locator('#price-chart').evaluate(c=>c.width))>100);
    await page.screenshot({path:'test-output/bist-desktop.png',fullPage:true});
    const mobile=await browser.newPage({viewport:{width:390,height:844}});
    mobile.on('pageerror',e=>errors.push(e.message));
    await mobile.goto('http://127.0.0.1:10001/bist');
    assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'BIST mobile overflow');
    await mobile.screenshot({path:'test-output/bist-mobile.png',fullPage:true});
    await page.goto('http://127.0.0.1:10001/crypto');
    assert.ok(await page.locator('#page-home').count());
    assert.deepEqual(errors,[]);
    console.log('PASS: market chooser, BIST analysis, mobile layout, crypto route');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1)});
