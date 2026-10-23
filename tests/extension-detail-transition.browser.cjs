'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.MYSEARCHPAGE_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.MYSEARCHPAGE_BROWSER_OUTPUT;
if (!output) throw new Error('MYSEARCHPAGE_BROWSER_OUTPUT required');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
const sites = [
  { name: 'xiaohongshu', url: 'https://www.xiaohongshu.com/search_result?keyword=safe', route: '/explore/safe200', old: '/explore/old100', detail: 'class="note-detail-mask" data-note-id="safe200"', search: '<div class="input-box"><input placeholder="搜索资料"></div>' },
  { name: 'douyin', url: 'https://www.douyin.com/search/safe', route: '/video/200', old: '/video/100', detail: 'data-e2e="modal-video-container" data-aweme-id="200"', search: '<div data-e2e="searchbar-container"><input data-e2e="searchbar-input"><button data-e2e="searchbar-button">搜索</button></div>' },
];
function html(site) {
  return `<!doctype html><meta charset="utf-8"><title>普通资料</title><style>
  header{height:50px;margin-left:100px} input{width:220px}.content-detail{position:fixed;inset:70px 50px 20px;background:white;border:1px solid black}.detail-wrapper{position:fixed;inset:0;pointer-events:none}.content-detail{pointer-events:auto} img{width:40px;height:40px}
  </style><header>${site.search}</header><main class="search-result-list" data-e2e="search-result-list"><button id="open">打开普通图文资料</button><a id="blocked" href="${site.old}">指定阻断地址</a></main><script>
  window.observations=[]; window.expectedDetail=false; window.mode='route-first'; window.useSearchRoute=false;
  function sample(){if(window.expectedDetail){const d=document.querySelector('#detail');window.observations.push({gate:document.documentElement.hasAttribute('data-mysearch-page-gate'),present:!!d,visible:!!d&&getComputedStyle(d).display!=='none'&&d.getBoundingClientRect().height>0});} requestAnimationFrame(sample)}requestAnimationFrame(sample);
  document.querySelector('#open').onclick=()=>{
    if(window.mode==='title-first')document.title='普通新资料';
    document.querySelector('main').style.display='none';
    if(!window.useSearchRoute)history.pushState({},'',${JSON.stringify(site.route)});
    const shell=document.createElement('div');shell.className='detail-wrapper';
    shell.innerHTML='<article id="detail" class="content-detail" ${site.detail}><h1>小说热榜：普通资料</h1><p style="position:absolute;left:20px;top:60px">猜你想搜是本文讨论的界面文字，不是搜索浮层</p><img alt="图文详情" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Crect width=%2240%22 height=%2240%22 fill=%22blue%22/%3E%3C/svg%3E"><button id="action">继续阅读</button><button id="close">关闭详情</button></article>';
    // Put site detail identity on the actual root even when class is supplied above.
    const detail=shell.querySelector('#detail');
    ${site.name === 'xiaohongshu' ? "detail.classList.add('note-detail-mask');" : ''}
    if(window.blockedHeading)detail.querySelector('h1').textContent='BLOCKME 上一条内容的旧标题';
    document.body.append(shell);window.expectedDetail=true;
    detail.querySelector('#action').onclick=()=>detail.dataset.used='yes';
    detail.querySelector('#close').onclick=()=>{window.expectedDetail=false;shell.remove();document.querySelector('main').style.display='block';document.title='普通结果';};
    if(window.mode==='route-first')setTimeout(()=>{document.title='普通新资料'},80);
  };
  </script>`;
}
(async () => {
  let context;
  const results = [];
  try {
    const extension = path.resolve(__dirname, '../extension');
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--no-first-run', '--no-default-browser-check'] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ uaRules: {}, blockedKeywords: ['BLOCKME'], blockedUrlPatterns: ['/video/100', '/explore/old100'], blockedAuthors: [] }));
    await context.route(/^https?:\/\//, async route => {
      const site = sites.find(site => new URL(site.url).hostname === new URL(route.request().url()).hostname);
      if (site && route.request().isNavigationRequest()) await route.fulfill({ status: 200, contentType: 'text/html', body: html(site) });
      else await route.abort();
    });
    for (const site of sites) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(site.url);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-mysearch-blocking-runtime'));
      await page.waitForTimeout(100);
      for (let round = 0; round < 12; round++) {
        const mode = round % 2 ? 'title-first' : 'route-first';
        const useSearchRoute = round % 3 === 0;
        await page.evaluate(({ mode, useSearchRoute, url }) => {
          history.replaceState({}, '', url);
          window.mode=mode;window.useSearchRoute=useSearchRoute;window.observations=[];
          document.title='BLOCKME 上一条内容的旧标题';
        }, { mode, useSearchRoute, url: site.url });
        await page.waitForTimeout(30);
        await page.locator('#open').click();
        await page.waitForTimeout(180);
        await page.locator('#action').click({ timeout: 2000 });
        const state = await page.evaluate(() => ({ frames:window.observations, used:document.querySelector('#detail')?.dataset.used, gate:document.documentElement.hasAttribute('data-mysearch-page-gate'), imageVisible:document.querySelector('#detail img')?.getBoundingClientRect().height>0 }));
        assert.ok(state.frames.length >= 2, 'must inspect multiple rendered frames');
        assert.ok(state.frames.every(frame => !frame.gate && frame.present && frame.visible), `${site.name} round ${round}: detail disappeared or was gated`);
        assert.equal(state.used, 'yes');assert.equal(state.gate,false);assert.equal(state.imageVisible,true);
        await page.locator('#close').click();
        await page.waitForTimeout(30);
        await page.evaluate(({ url, modal }) => { history.replaceState({},'',url);window.mode='unchanged';window.blockedHeading=true;window.useSearchRoute=modal;document.title='BLOCKME 上一条内容的旧标题'; }, { url: site.url, modal: round % 2 === 0 });
      await page.waitForTimeout(30);
      await page.locator('#open').click();
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-mysearch-page-gate'));
      await page.waitForTimeout(80);
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-mysearch-page-gate')),true);
      await page.evaluate(() => { window.expectedDetail=false;window.blockedHeading=false;document.title='普通资料已更正'; });
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-mysearch-page-gate'));
      await page.locator('#close').click();
        assert.equal(await page.locator('#detail').count(),0);
        results.push({ site:site.name, round, mode, useSearchRoute, checkedFrames:state.frames.length });
      }
      // A real updated blocked title must remain blocked across repeated view checks,
      // without our own hiding style oscillating the detail's identity.
      await page.locator('#open').click();
      await page.waitForTimeout(120);
      await page.evaluate(() => { window.expectedDetail=false;document.title='BLOCKME 当前详情'; });
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-mysearch-page-gate'));
      await page.waitForTimeout(80);
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-mysearch-page-gate')),true);
      await page.evaluate(() => { document.title='普通资料已更正'; });
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-mysearch-page-gate'));
      await page.locator('#close').click();
      // Closed detail with a stale blocked URL must not gate the restored results.
      await page.goto(new URL(site.old,site.url).href);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-mysearch-blocking-runtime'));
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-mysearch-page-gate')),false);
      const blocked = await page.locator('#blocked').evaluate(node => !node.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));
      assert.equal(blocked,true,'explicit matching destination must remain blocked');
      assert.deepEqual(errors,[]);
      await page.close();
    }
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify({passed:results.length,sites:sites.length,frames:results.reduce((n,r)=>n+r.checkedFrames,0),updatedTitleBlocking:true,staleUrlRecovery:true}));
  } catch (error) {
    const page=context?.pages().find(page=>/^https/.test(page.url()));
    if(page) { await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(output,'failure-state.json'),JSON.stringify(await page.evaluate(()=>({url:location.href,title:document.title,gate:document.documentElement.hasAttribute('data-mysearch-page-gate'),frames:window.observations,body:document.body.innerHTML})).catch(()=>({})),null,2)); }
    throw error;
  } finally { await context?.close();fs.rmSync(profile,{recursive:true,force:true}); }
})().catch(error=>{console.error(error.stack);process.exitCode=1});
