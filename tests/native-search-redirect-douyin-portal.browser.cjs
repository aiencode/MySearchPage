'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.MYSEARCHPAGE_PLAYWRIGHT_MODULE || 'playwright-core');
const executablePath = process.env.MYSEARCHPAGE_CHROMIUM_BINARY;
if (!executablePath) throw new Error('需要设置 MYSEARCHPAGE_CHROMIUM_BINARY');

// Live failure: an unmarked header wrapper is detached while empty, then React
// mounts the next modal and its media into that same, now-detached portal host.
const fixture = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<header><div id="shared-host"><div class="dynamic-search-unit">
<input data-e2e="searchbar-input" placeholder="搜索">
<button data-e2e="searchbar-button">搜索</button></div></div></header>
<section id="results">原搜索结果</section>
<script>window.sharedHost = document.querySelector('#shared-host');</script>
</body></html>`;

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.route('https://www.douyin.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
    await page.goto('https://www.douyin.com/search/JavaScript?type=video');
    await page.addScriptTag({ path: path.resolve(__dirname, '../extension/content/native-search-redirect-runtime.js') });
    await page.evaluate(() => {
      window.fixtureController = MySearchNativeRedirect.createController({ chrome: {
        runtime: { sendMessage(_message, done) { done({ rules: { highRiskDomains: [] } }); } },
      } });
      window.fixtureController.start();
    });
    await page.waitForFunction(() => !document.querySelector('input[data-e2e="searchbar-input"]'));
    assert.equal(await page.evaluate(() => sharedHost.isConnected), true, 'initial replacement must preserve the future portal host');

    for (let cycle = 1; cycle <= 4; cycle += 1) {
      // Closing with X regenerates the search controls before the next modal
      // mounts; at this point there are no media/close controls to guard the host.
      await page.evaluate(() => {
        sharedHost.replaceChildren();
        const unit = document.createElement('div');
        unit.className = 'dynamic-search-unit';
        const input = document.createElement('input');
        input.setAttribute('data-e2e', 'searchbar-input');
        const submit = document.createElement('button');
        submit.setAttribute('data-e2e', 'searchbar-button');
        submit.textContent = '搜索';
        unit.append(input, submit);
        sharedHost.append(unit);
        history.replaceState({}, '', '/search/JavaScript?type=video');
      });
      await page.waitForFunction(() => !document.querySelector('input[data-e2e="searchbar-input"]'));
      assert.equal(await page.evaluate(() => sharedHost.isConnected), true, `cycle ${cycle}: cached host was detached on close`);
      await page.evaluate(cycle => {
        const modal = document.createElement('div');
        modal.setAttribute('data-e2e', 'modal-video-container');
        modal.append(document.createElement('video'));
        sharedHost.append(modal);
        history.replaceState({}, '', '/search/JavaScript?type=video&modal_id=' + cycle);
      }, cycle);
      assert.deepEqual(await page.evaluate(() => ({
        connected: sharedHost.isConnected,
        videos: document.querySelectorAll('[data-e2e="modal-video-container"] video').length,
        results: Boolean(document.querySelector('#results')),
      })), { connected: true, videos: 1, results: true }, `cycle ${cycle}: detail must mount into the live document`);
    }
    await page.evaluate(() => fixtureController.destroy());
    console.log('PASS: Douyin unmarked portal host remains connected through four close/remount cycles (media hiding absent).');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
