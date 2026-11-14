'use strict';
const {chromium}=require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createService}=require('./server.cjs'),{config}=require('./lib/config.cjs');
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reservation-ui-'));
  const c=config({SERVICE_ORIGIN:'http://localhost:5687',SERVICE_DATA:dir}),svc=createService(c);
  await new Promise(resolve=>svc.server.listen(5687,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--host-resolver-rules=MAP *.localhost 127.0.0.1']});
  const context=await browser.newContext({viewport:{width:1360,height:950}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
  page.on('response',r=>{if(r.status()>=400)console.log('HTTP',r.status(),new URL(r.url()).pathname);});
  page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,600));});
  page.on('requestfailed',r=>console.log('REQUEST FAILED',new URL(r.url()).pathname,r.failure()?.errorText));
  fs.mkdirSync(path.join(__dirname,'test-results'),{recursive:true});
  try{
    await page.goto(c.origin);await page.getByRole('heading',{name:'お店の予約と管理を、 ひとつに。'}).waitFor();
    await page.screenshot({path:path.join(__dirname,'test-results/service.png'),fullPage:true});
    await page.goto(c.origin+'/register');await page.locator('[name=storeName]').fill('テスト店舗');await page.locator('[name=slug]').fill('test-shop');await page.locator('[name=email]').fill('ui@example.test');await page.locator('[name=password]').fill('test-password-123');await page.locator('[name=acceptTerms]').check();await page.getByRole('button',{name:'無料の店舗を作成する'}).click();await page.waitForURL('**/dashboard');
    await page.getByRole('heading',{name:'テスト店舗',exact:true}).waitFor();await page.screenshot({path:path.join(__dirname,'test-results/dashboard.png'),fullPage:true});
    await page.goto('http://test-shop.localhost:5687/book');await page.locator('.site-header').waitFor();
    await page.screenshot({path:path.join(__dirname,'test-results/booking.png'),fullPage:true});
    const text=await page.locator('body').innerText();assert.ok(!text.includes('CN Ueno'));assert.ok(!text.includes('03-6806'));assert.ok(!text.includes('杉田'));
    const translations=require('./tenant/translations.cjs')['メニューはまだ登録されていません。'];
    for(const [i,language]of ['ja','en','zh','ko','fr','es','it','de'].entries()){
      await page.evaluate(l=>window.CNI18N.set(l),language);
      await page.waitForFunction(expected=>document.querySelector('.tenant-empty')?.textContent===expected,i===0?'メニューはまだ登録されていません。':translations[i-1]);
    }
    await page.evaluate(()=>window.CNI18N.set('ja'));
    for(const route of ['/','/menus','/staff','/map','/mypage']){
      await page.goto('http://test-shop.localhost:5687'+route);await page.locator('.site-header').waitFor();
      const body=await page.locator('body').innerText();assert.ok(!/CN Ueno|03-6806|プラザＵビル|上野駅徒歩|TENANT_NAME/.test(body),route+' に元店舗の案内を含めない');
      if(route==='/map'){
        await page.getByText('住所を登録すると地図を表示します。').waitFor();
        assert.equal(await page.locator('.map-panel iframe').getAttribute('src'),'about:blank');
        await page.screenshot({path:path.join(__dirname,'test-results/map.png'),fullPage:true});
      }
    }
    await page.goto('http://test-shop.localhost:5687/cnsalon-board');await page.locator('#pm-user').fill('owner');await page.locator('#pm-pass').fill('test-password-123');await page.locator('button[type=submit]').click();await page.waitForURL('**/admin');await page.locator('.pm-header, .admin-header, .schedule-root, .pm-ledger').first().waitFor({timeout:10000}).catch(()=>{});
    await page.screenshot({path:path.join(__dirname,'test-results/admin.png'),fullPage:true});
    const data=await page.evaluate(async()=>({status:(await fetch('/api/demo/schedule?date=2026-11-14')).status,body:document.body.innerText.slice(0,1200)}));assert.equal(data.status,200);
    assert.deepEqual(errors,[],'画面のエラー');
    await page.setViewportSize({width:390,height:844});await page.goto(c.origin);await page.getByRole('heading').first().waitFor();await page.screenshot({path:path.join(__dirname,'test-results/mobile.png'),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'スマホで横にはみ出さない');
    console.log('PASS: 店舗開設・契約管理・空の予約画面・8言語・主要ページ・元の台帳へのログイン・スマホ表示。');
  }catch(e){console.log('画面の状態:',(await page.locator('body').innerText()).slice(0,1600));console.log(await page.evaluate(()=>({tenant:window.__TENANT__,scripts:document.scripts.length,rsc:!!window.__VINEXT_RSC_ROOT__})));fs.writeFileSync(path.join(__dirname,'test-results/failure.html'),await page.content());await page.screenshot({path:path.join(__dirname,'test-results/failure.png'),fullPage:true});throw e;}finally{await browser.close();await svc.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
