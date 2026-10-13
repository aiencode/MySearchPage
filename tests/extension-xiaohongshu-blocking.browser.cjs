'use strict';
// Isolated extension and offline XHS-shaped documents; no online search or login interaction.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.MYSEARCHPAGE_PLAYWRIGHT_MODULE || 'playwright');
const extension = path.resolve(__dirname, '../extension');
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
    await context.route('**/*', async route => {
      const request = route.request();
      if (request.url().startsWith('https://www.xiaohongshu.com/') && request.resourceType() === 'document') {
        const keyword = new URL(request.url()).searchParams.get('keyword');
        await route.fulfill({ contentType: 'text/html; charset=utf-8', body:
          `<!doctype html><html><head><title>${keyword} - 小红书搜索</title></head><body>` +
          '<div id="app" data-v-app><div class="container" id="inner-shell"><a id="home" href="/explore"><svg></svg><span>发现</span></a><div class="search-layout" id="search-host"></div></div></div></body></html>' });
      } else if (/^https?:/.test(request.url())) await route.abort('blockedbyclient');
      else await route.continue();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ blockedKeywords: ['BLOCKME'], blockedUrlPatterns: [], blockedAuthors: [],
        blockingEnabled: true, uaRules: { 'xiaohongshu.com': { enabled: false, allowHomepage: false } } });
    });
    const checks = [];
    for (const keyword of ['picot', '资料检索', '冷压端子']) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&type=51`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-mysearch-blocking-runtime'));
      await page.waitForTimeout(150);
      assert.equal(await page.locator('#inner-shell > #search-host').count(), 1, `${keyword}: early search layout survives`);
      assert.equal(await page.locator('#app[data-mysearch-blocked-card]').count(), 0);
      await page.evaluate(() => {
        document.querySelector('#search-host').innerHTML = '<main><div class="feeds-container" id="results">' +
          '<section class="note-item" id="safe-note"><a href="/explore/note123"><h2>普通资料</h2><img alt="普通封面"></a></section>' +
          '<section class="note-item" id="blocked-note"><a href="/explore/note456"><h2>BLOCKME 资料</h2><img alt="封禁封面"></a></section></div></main>';
      });
      await page.waitForSelector('#blocked-note .mysearch-blocked-card-placeholder', { state: 'attached' });
      assert.equal(await page.locator('#safe-note h2').textContent(), '普通资料');
      assert.equal(await page.locator('#results[data-mysearch-blocked-card], #app[data-mysearch-blocked-card]').count(), 0);
      assert.equal(await page.locator('html[data-mysearch-page-gate]').count(), 0);
      assert.equal(await page.locator('#search-host').evaluate(node => getComputedStyle(node).visibility), 'visible');
      assert.deepEqual(errors, []);
      checks.push({ keyword, searchLayoutPreserved: true, safeNotePreserved: true, blockedNoteHidden: true });
      await page.close();
    }
    console.log(JSON.stringify({ success: true, offline: true, checks }, null, 2));
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
