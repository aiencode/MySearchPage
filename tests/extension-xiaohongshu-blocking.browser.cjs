'use strict';
// Real extension + offline XHS-shaped documents; never reads a user's Chrome profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.MYSEARCHPAGE_PLAYWRIGHT_MODULE || 'playwright');
const extension = path.resolve(__dirname, '../extension');

async function assertSearchShell(page) {
  for (const selector of ['#app', '#inner-shell', '#search-host']) {
    assert.equal(await page.locator(selector).count(), 1, `${selector} must survive`);
    assert.equal(await page.locator(`${selector}[data-mysearch-blocked-card]`).count(), 0);
  }
  assert.equal(await page.locator('html[data-mysearch-page-gate]').count(), 0);
  assert.equal(await page.locator('#search-host').evaluate(node => {
    const style = getComputedStyle(node);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }), true);
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mysearch-xhs-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.MYSEARCHPAGE_CHROMIUM_BINARY || chromium.executablePath(),
      headless: true, timeout: 20000, viewport: { width: 1200, height: 900 },
      ignoreDefaultArgs: ['--disable-extensions', '--headless'],
      args: ['--headless=new', `--load-extension=${extension}`, `--disable-extensions-except=${extension}`,
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--no-first-run', '--no-default-browser-check'],
    });
    context.setDefaultTimeout(10000);
    await context.route('**/*', async route => {
      const request = route.request();
      if (request.url().startsWith('https://www.xiaohongshu.com/') && request.resourceType() === 'document') {
        const url = new URL(request.url());
        const body = /^\/explore\/[^/]+$/.test(url.pathname)
          ? '<button id="rule-probe">BLOCKME 规则就绪探针</button><main class="note-detail-container" id="detail"><h1>普通笔记</h1><p>BLOCKME 详情正文</p><a href="/user/profile/author">作者</a></main>'
          : '<div id="app" data-v-app><div class="container" id="inner-shell"><a id="home" href="/explore"><svg></svg><span>发现</span></a><div class="search-layout" id="search-host"></div></div></div>';
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body:
          `<!doctype html><html><head><title>${url.searchParams.get('keyword') || '普通笔记'} - 小红书</title></head><body>${body}</body></html>` });
      } else if (/^https?:/.test(request.url())) await route.abort('blockedbyclient');
      else await route.continue();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ blockedKeywords: ['BLOCKME'], blockedUrlPatterns: [], blockedAuthors: [],
        blockingEnabled: true, uaRules: { 'xiaohongshu.com': { enabled: false, allowHomepage: false } } });
    });
    const checks = [];
    for (const width of [1200, 768, 390]) {
      for (const keyword of ['picot', '资料检索', '冷压端子']) {
        const page = await context.newPage();
        await page.setViewportSize({ width, height: 900 });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const url = `https://www.xiaohongshu.com/search_result/?keyword=${encodeURIComponent(keyword)}&type=51`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        for (let load = 0; load < 2; load++) {
          if (load) await page.reload({ waitUntil: 'domcontentloaded' });
          // Positive evidence that the content rules ran; not merely a runtime marker before async rule loading.
          await page.waitForSelector('#home .mysearch-blocked-card-placeholder', { state: 'attached' });
          assert.equal(await page.locator('#home').getAttribute('href'), null);
          assert.equal(page.url(), url);
          await assertSearchShell(page);
          await page.evaluate(() => {
            document.querySelector('#search-host').innerHTML = '<main><div class="feeds-container" id="results"></div></main>';
          });
          for (let batch = 1; batch <= 2; batch++) {
            await page.evaluate(batch => {
              document.querySelector('#results').insertAdjacentHTML('beforeend',
                `<section class="note-item" id="safe-${batch}"><a href="/explore/safe-${batch}"><h2>普通资料 ${batch}</h2><img alt="普通封面"></a></section>` +
                `<section class="note-item" id="blocked-${batch}"><a href="/explore/blocked-${batch}"><h2>BLOCKME 资料</h2><img alt="封禁封面"></a></section>`);
            }, batch);
            await page.waitForSelector(`#blocked-${batch} .mysearch-blocked-card-placeholder`, { state: 'attached' });
            assert.equal(await page.locator('#results .mysearch-blocked-card-placeholder').count(), batch);
            for (let previous = 1; previous <= batch; previous++) {
              assert.equal(await page.locator(`#safe-${previous} h2`).textContent(), `普通资料 ${previous}`);
              assert.equal(await page.locator(`#safe-${previous} a[href="/explore/safe-${previous}"]`).count(), 1);
              assert.equal(await page.locator(`#safe-${previous}`).isVisible(), true);
              assert.equal(await page.locator(`#blocked-${previous} a[href], #blocked-${previous} img, #blocked-${previous} h2`).count(), 0);
            }
            assert.equal(await page.locator('#results[data-mysearch-blocked-card]').count(), 0);
            await assertSearchShell(page);
          }
        }
        assert.deepEqual(errors, []);
        checks.push({ tc: ['TC-REG-XHS-001', 'TC-REG-XHS-002', 'TC-REG-XHS-003', 'TC-REG-XHS-004'],
          keyword, width, loads: 2, batchesPerLoad: 2, safeLinksPreserved: true, blockedNotesNotActionable: true });
        await page.close();
      }
    }
    const detail = await context.newPage();
    await detail.goto('https://www.xiaohongshu.com/explore/safe-1', { waitUntil: 'domcontentloaded' });
    await detail.waitForSelector('#rule-probe .mysearch-blocked-card-placeholder', { state: 'attached' });
    assert.equal(await detail.locator('#detail p').textContent(), 'BLOCKME 详情正文');
    assert.equal(await detail.locator('#detail a[href]').count(), 1);
    assert.equal(await detail.locator('#detail .mysearch-blocked-card-placeholder, #detail[data-mysearch-blocked-card], html[data-mysearch-page-gate]').count(), 0);
    checks.push({ tc: 'TC-REG-XHS-005', scenario: 'note detail is not a homepage or result-card replacement target', passed: true });
    await detail.close();
    const home = await context.newPage();
    let error;
    try { await home.goto('https://www.xiaohongshu.com/explore', { waitUntil: 'domcontentloaded', timeout: 10000 }); }
    catch (caught) { error = caught; }
    assert.ok(error && error.message.includes('ERR_BLOCKED_BY_CLIENT'));
    checks.push({ tc: 'TC-REG-HOME-004', scenario: 'XHS homepage remains blocked independently of search results', passed: true });
    console.log(JSON.stringify({ success: true, offline: true, checks }, null, 2));
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
