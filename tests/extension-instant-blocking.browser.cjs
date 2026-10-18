'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.MYSEARCHPAGE_PLAYWRIGHT_MODULE || 'playwright');
const extension = path.resolve(__dirname, '../extension');
const output = process.env.MYSEARCHPAGE_BROWSER_OUTPUT;
if (!output) throw new Error('MYSEARCHPAGE_BROWSER_OUTPUT is required');
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'profile-'));
const urls = [
  'https://www.youtube.com/results?search_query=REPRO_BLOCKED',
  'https://www.douyin.com/jingxuan/search/REPRO_BLOCKED',
  'https://www.xiaohongshu.com/search_result?keyword=REPRO_BLOCKED',
  'https://search.bilibili.com/all?keyword=REPRO_BLOCKED',
];
const html = '<!doctype html><html><head><title>离线检索复现</title></head><body><button id="normal" onclick="this.dataset.clicked = &quot;yes&quot;">普通动作</button><p>离线测试内容</p></body></html>';
(async () => {
  let context;
  const results = [];
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--no-first-run', '--no-default-browser-check'],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
    const identity = await worker.evaluate(async () => {
      await chrome.storage.local.set({ blockingEnabled: true, blockedKeywords: ['REPRO_BLOCKED'], blockedUrlPatterns: [], blockedAuthors: [], highRiskDomains: [] });
      return { id: chrome.runtime.id, version: chrome.runtime.getManifest().version };
    });
    console.log(JSON.stringify({ extension, identity }));
    await context.route(/^https?:\/\//, async route => {
      if (route.request().isNavigationRequest() && ['www.google.com', ...urls.map(url => new URL(url).hostname)].includes(new URL(route.request().url()).hostname)) await route.fulfill({ status: 200, contentType: 'text/html', body: html });
      else await route.abort();
    });
    for (const url of urls) {
      const page = await context.newPage();
      await page.goto(url);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-mysearch-page-gate'), null, { timeout: 3000 });
      const safeUrl = url.replace('REPRO_BLOCKED', 'safe');
      const result = await page.evaluate(({ safeUrl, blockedUrl }) => {
        const started = performance.now();
        const blockedEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
        const cancelled = !document.querySelector('#normal').dispatchEvent(blockedEvent);
        const blockMs = performance.now() - started;
        const presentationCount = document.querySelectorAll('img, [id*="feedback"], [class*="feedback"]').length;
        let commits = 0;
        addEventListener('mysearch-blocking-route-committed', () => { commits++; });
        history.pushState({}, '', safeUrl);
        const leftBlockedRoute = location.href === safeUrl;
        const gateAfterRoute = document.documentElement.hasAttribute('data-mysearch-page-gate');
        const allowed = document.querySelector('#normal').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        const replacement = new URL(safeUrl);
        replacement.searchParams.set('phase', 'replace');
        history.replaceState({}, '', replacement.href);
        const cleanReplaceAllowed = location.href === replacement.href && !document.documentElement.hasAttribute('data-mysearch-page-gate');
        history.replaceState({}, '', blockedUrl);
        const blockedRouteCancelled = location.href === replacement.href && !document.documentElement.hasAttribute('data-mysearch-page-gate');
        return { cancelled, blockMs, presentationCount, leftBlockedRoute, gateAfterRoute, allowed, cleanReplaceAllowed, blockedRouteCancelled, commits };
      }, { safeUrl, blockedUrl: url });
      result.url = url;
      result.normalButtonVisible = await page.locator('#normal').isVisible();
      await page.evaluate(() => { delete document.querySelector('#normal').dataset.clicked; });
      await page.locator('#normal').click({ timeout: 1000 });
      result.physicalClick = await page.locator('#normal').getAttribute('data-clicked') === 'yes';
      results.push(result);
      await page.screenshot({ path: path.join(output, `${new URL(url).hostname}.png`) });
      await page.close();
      console.log(JSON.stringify(result));
    }
    const stalePage = await context.newPage();
    await stalePage.goto(urls[0].replace('REPRO_BLOCKED', 'safe'));
    await stalePage.waitForFunction(() => document.documentElement.hasAttribute('data-mysearch-blocking-runtime'));
    await stalePage.evaluate(() => document.documentElement.setAttribute('data-mysearch-blocking-runtime', 'explicit-homepage-permission-v3'));
    const staleGoogle = await context.newPage();
    await staleGoogle.goto('https://www.google.com/search?q=safe');
    await staleGoogle.waitForFunction(() => document.documentElement.hasAttribute('data-mysearch-blocking-runtime'));
    await staleGoogle.evaluate(() => document.documentElement.setAttribute('data-mysearch-blocking-runtime', 'explicit-homepage-permission-v3'));
    const freshGoogle = await context.newPage();
    await freshGoogle.goto('https://www.google.com/search?q=fresh');
    await freshGoogle.waitForFunction(() => document.documentElement.hasAttribute('data-mysearch-blocking-runtime'));
    await freshGoogle.evaluate(() => { window.fixtureInstance = 'must-not-reload'; });
    const options = await context.newPage();
    await options.goto(`chrome-extension://${identity.id}/options/options.html`);
    const reconnect = await options.evaluate(() => chrome.runtime.sendMessage({ type: 'RECONNECT_SEARCH_MEDIA_TABS' }));
    if (reconnect.reloaded === 2) {
      for (const tab of [stalePage, staleGoogle]) {
        await tab.waitForFunction(() => document.documentElement.getAttribute('data-mysearch-blocking-runtime') === 'immediate-rule-blocking-v4', null, { timeout: 3000 });
      }
    }
    const oldMarkersCleared = (await Promise.all([stalePage, staleGoogle].map(tab => tab.evaluate(() => document.documentElement.getAttribute('data-mysearch-blocking-runtime'))))).every(version => version === 'immediate-rule-blocking-v4');
    const compatibility = { reconnect, expectedOldTabReload: reconnect.reloaded === 2, oldMarkersCleared, freshPagePreserved: await freshGoogle.evaluate(() => window.fixtureInstance === 'must-not-reload') };
    console.log(JSON.stringify({ compatibility }));
    fs.writeFileSync(path.join(output, 'compatibility.json'), JSON.stringify(compatibility, null, 2));
    await stalePage.close();
    await staleGoogle.close();
    await freshGoogle.close();
    await options.close();
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    for (const result of results) {
      assert.equal(result.cancelled, true, `matched action must be cancelled: ${result.url}`);
      assert.equal(result.presentationCount, 0, `no presentation overlay: ${result.url}`);
      assert.equal(result.leftBlockedRoute, true, `clean search navigation must not remain locked: ${result.url}`);
      assert.equal(result.gateAfterRoute, false, `clean route must clear the gate synchronously: ${result.url}`);
      assert.equal(result.allowed, true, `normal action must be immediately available: ${result.url}`);
      assert.equal(result.normalButtonVisible, true, `normal controls must be visible: ${result.url}`);
      assert.equal(result.physicalClick, true, 'a real browser click must reach the restored normal control');
      assert.equal(result.cleanReplaceAllowed, true, 'normal replaceState must be allowed');
      assert.equal(result.blockedRouteCancelled, true, 'matched route must still be blocked without changing the current page');
      assert.equal(result.commits, 2, 'only successful route operations emit commits');
    }
    assert.equal(compatibility.expectedOldTabReload, true, 'an old runtime marker must cause a tab reload');
    assert.equal(compatibility.oldMarkersCleared, true, 'reloaded tabs must actually run v4');
    assert.equal(compatibility.freshPagePreserved, true, 'a current non-media page must remain untouched');
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
