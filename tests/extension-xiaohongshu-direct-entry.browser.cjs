'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.MYSEARCHPAGE_PLAYWRIGHT_MODULE || 'playwright');
const output = process.env.MYSEARCHPAGE_BROWSER_OUTPUT;
if (!output) throw new Error('MYSEARCHPAGE_BROWSER_OUTPUT required');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
const origin = 'https://www.xiaohongshu.com';
const first = '/explore/6ab0c52a000000003a02d5e0';
const second = '/explore/6ab4b34a000000001802b79f';
const html = `<!doctype html><meta charset="utf-8"><title>普通资料</title><style>
header{height:50px}input{width:220px}.note-detail-mask{position:fixed;inset:60px 40px;background:white;border:1px solid black}main button{margin:12px}img{height:40px;width:40px}
</style><header><div class="input-box"><input placeholder="搜索资料"></div><a id="home" href="/explore">首页</a></header><main class="feeds-container"><button id="first">原帖 A</button><button id="second">别帖 B</button></main><script>
const first=${JSON.stringify(first)},second=${JSON.stringify(second)};
let logicalRoute=location.pathname+location.search;
window.opened=[];
window.seed={back:'/search_result?keyword=safe',current:logicalRoute,forward:null,replaced:true,position:17,scroll:{left:3,top:24},marker:{keep:'whole-state'}};
history.replaceState(window.seed,'',location.href);
function show(note,direct){
  document.querySelector('.note-detail-mask')?.remove();
  const detail=document.createElement('article');detail.className='note-detail-mask';detail.dataset.noteId=note.split('/').at(-1);
  detail.innerHTML='<h1>'+(note===first?'原帖 A':'别帖 B')+'</h1><img alt="详情图片" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Crect width=%2240%22 height=%2240%22 fill=%22blue%22/%3E%3C/svg%3E"><button id="close">关闭帖子</button>';
  document.body.append(detail);document.title=note===first?'原帖 A':'别帖 B';window.opened.push(note);
  detail.querySelector('#close').onclick=()=>{detail.remove();document.title='普通背景列表';if(direct){history.replaceState({...history.state,current:'/explore',replaced:true},'','/explore');logicalRoute='/explore';}else history.back();};
}
addEventListener('popstate',()=>{logicalRoute=location.pathname+location.search;if(/^\\/explore\\/.+/.test(location.pathname))show(location.pathname,true);else{document.querySelector('.note-detail-mask')?.remove();document.title='普通背景列表';}});
for(const [id,note]of[['first',first],['second',second]])document.getElementById(id).onclick=()=>{history.pushState({back:logicalRoute,current:note},'',note);show(note,false);};
if(location.pathname===first)show(first,true);
</script>`;
(async () => {
  let context;
  const results = [];
  try {
    const extension = path.resolve(__dirname, '../extension');
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--no-first-run', '--no-default-browser-check'] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ uaRules: { 'xiaohongshu.com': { enabled: false, allowHomepage: false } }, blockedKeywords: [], blockedUrlPatterns: [], blockedAuthors: [] }));
    await context.route(/^https?:\/\//, async route => {
      if (route.request().isNavigationRequest() && new URL(route.request().url()).origin === origin) await route.fulfill({ status: 200, contentType: 'text/html', body: html });
      else await route.abort();
    });
    for (const entry of ['direct', 'search']) for (const card of ['first', 'second']) for (let round = 0; round < 3; round++) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + (entry === 'direct' ? first : '/search_result?keyword=safe'));
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-mysearch-blocking-runtime'));
      await page.waitForTimeout(80);
      if (entry === 'direct') {
        // A real reload of the direct note, not a route marker or search-modal surrogate.
        await page.reload();
        await page.waitForFunction(() => document.documentElement.hasAttribute('data-mysearch-blocking-runtime'));
        await page.waitForTimeout(80);
        await page.locator('#close').click();
        await page.waitForURL(url => url.pathname === '/explore', { timeout: 2000 });
        const state = await page.evaluate(() => ({ history:history.state, expected:{...window.seed,current:'/explore'}, gate:document.documentElement.hasAttribute('data-mysearch-page-gate') }));
        assert.deepEqual(state.history,state.expected,'URL and complete state must be replaced together');
        assert.equal(state.gate,false,'dismissal must keep the already-mounted background available');
      }
      const basePath = entry === 'direct' ? '/explore' : '/search_result';
      await page.locator('#'+card).click();
      await page.waitForURL(url => url.pathname === (card === 'first' ? first : second));
      assert.equal(await page.locator('.note-detail-mask').count(),1);
      await page.locator('#close').click();
      await page.waitForURL(url => url.pathname === basePath, { timeout: 2000 });
      await page.waitForTimeout(80);
      const after = await page.evaluate(() => ({ notes:document.querySelectorAll('.note-detail-mask').length, opened:window.opened, gate:document.documentElement.hasAttribute('data-mysearch-page-gate'), history:history.state }));
      assert.equal(after.notes,0,'one close cannot reveal the original note again');
      assert.deepEqual(after.opened,entry === 'direct' ? [first,card === 'first' ? first : second] : [card === 'first' ? first : second]);
      assert.equal(after.gate,false);
      const homepageBlocked = await page.locator('#home').evaluate(node => !node.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));
      assert.equal(homepageBlocked,true,'homepage entry does not inherit the background return exception');
      assert.equal(await page.evaluate(()=>window.open('/explore')===null),true);
      assert.deepEqual(errors,[]);
      results.push({entry,card,round,opened:after.opened,remainingNotes:after.notes,homepageBlocked});
      await page.close();
    }
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify({passed:results.length,directReloads:6,searchControls:6,completeHistoryStatePreserved:true,homepageEntryStillBlocked:true}));
  } catch (error) {
    const page=context?.pages().find(page=>page.url().startsWith(origin));
    if(page){await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify(await page.evaluate(()=>({url:location.href,title:document.title,state:history.state,opened:window.opened,body:document.body.innerHTML})).catch(()=>({})),null,2));}
    throw error;
  } finally { await context?.close();fs.rmSync(profile,{recursive:true,force:true}); }
})().catch(error=>{console.error(error.stack);process.exitCode=1});
