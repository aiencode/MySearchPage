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
  'https://www.douyin.com/search/safe',
  'https://search.bilibili.com/all?keyword=safe',
  'https://www.xiaohongshu.com/search_result?keyword=safe',
  'https://www.youtube.com/results?search_query=safe',
];
const html = '<!doctype html><html><head><title>后台唤醒回归</title></head><body><input id="draft"><button id="action" onclick="this.dataset.clicked = &quot;yes&quot;">继续操作</button></body></html>';

(async () => {
  let context;
  const results = [];
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--no-first-run', '--no-default-browser-check'],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 });
    const id = await worker.evaluate(async () => {
      await chrome.storage.local.set({ uaRules: {}, blockedKeywords: [], blockedUrlPatterns: [], blockedAuthors: [] });
      return chrome.runtime.id;
    });
    await context.route(/^https?:\/\//, async route => {
      if (route.request().isNavigationRequest() && urls.some(url => new URL(url).hostname === new URL(route.request().url()).hostname)) {
        await route.fulfill({ status: 200, contentType: 'text/html', body: html });
      } else await route.abort();
    });
    const pages = [];
    for (const url of urls) {
      const page = await context.newPage();
      await page.goto(url);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-mysearch-blocking-runtime'));
      pages.push(page);
    }
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options/options.html`);
    const cdp = await context.newCDPSession(options);
    const workerUrl = worker.url();
    async function waitForWorker(running) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const { targetInfos } = await cdp.send('Target.getTargets');
        const target = targetInfos.find(item => item.type === 'service_worker' && item.url === workerUrl);
        if (Boolean(target) === running) return target;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`CDP worker did not become ${running ? 'running' : 'stopped'}`);
    }
    for (let round = 0; round < 3; round++) {
      for (const [index, page] of pages.entries()) {
        await page.evaluate(({ round, index }) => {
          window.wakeupInstance = `${round}-${index}`;
          document.querySelector('#draft').value = '未提交的输入';
          if (index % 2) document.documentElement.setAttribute('data-mysearch-blocking-runtime', 'old-runtime');
          else document.documentElement.removeAttribute('data-mysearch-blocking-runtime');
          delete document.querySelector('#action').dataset.clicked;
        }, { round, index });
      }
      const target = await waitForWorker(true);
      const stopped = await cdp.send('Target.closeTarget', { targetId: target.targetId });
      assert.equal(stopped.success, true);
      await waitForWorker(false);
      const status = await options.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_BLOCKING_STATUS' }));
      assert.equal(status.success, true);
      await waitForWorker(true);
      // Allow the asynchronous top-level injections to finish before checking page state.
      await new Promise(resolve => setTimeout(resolve, 500));
      for (const [index, page] of pages.entries()) {
        await page.locator('#action').click();
        const state = await page.evaluate(() => ({
          instance: window.wakeupInstance,
          draft: document.querySelector('#draft').value,
          clicked: document.querySelector('#action').dataset.clicked,
        }));
        assert.equal(state.instance, `${round}-${index}`, `document must survive wakeup: ${page.url()}`);
        assert.equal(state.draft, '未提交的输入');
        assert.equal(state.clicked, 'yes');
        results.push({ round, url: page.url(), ...state });
      }
    }
    // Model the essential reload handoff: stale DOM survives while the current
    // extension world no longer contains the controller or its rules module.
    for (const page of pages) {
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-mysearch-blocking-runtime', 'immediate-rule-blocking-v4');
        window.beforeExtensionReload = true;
      });
    }
    await options.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: ['*://*.douyin.com/*', '*://*.bilibili.com/*', '*://*.xiaohongshu.com/*', '*://*.youtube.com/*'] });
      for (const tab of tabs) await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        delete globalThis.__mySearchBlockingRuntimeVersion;
        delete globalThis.MySearchBlockingRules;
      } });
    });
    const response = await options.evaluate(() => chrome.runtime.sendMessage({ type: 'RECONNECT_SEARCH_MEDIA_TABS' }));
    assert.equal(response.success, true);
    assert.equal(response.reloaded, urls.length);
    for (const page of pages) {
      await page.waitForFunction(() => !window.beforeExtensionReload &&
        document.documentElement.getAttribute('data-mysearch-blocking-runtime') === 'immediate-rule-blocking-v4', null, { timeout: 15000 });
      await page.locator('#action').click();
      assert.equal(await page.locator('#action').getAttribute('data-clicked'), 'yes');
      results.push({ scenario: 'orphaned-isolated-world-and-explicit-reconnect', url: page.url(), recovered: true });
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ passed: results.length, wakeupRounds: 3, sites: urls.length, orphanedRuntimeReconnect: true }));
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
