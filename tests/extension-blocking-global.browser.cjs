'use strict';

// 真实扩展浏览器验证：覆盖非四站、非搜索页、无平台控件标记、动态节点和 iframe。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const extension = path.resolve(__dirname, '../extension');
const fixtureUrl = 'https://global-blocking.test/fixture';
const frameUrl = 'https://global-blocking.test/frame';
const douyinUrl = 'https://www.douyin.com/jingxuan/search/%E5%85%89%E7%8E%8B?type=general';
const requireEnv = name => {
  if (!process.env[name]) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return process.env[name];
};

const fixture = `<!doctype html>
<html><head><title>普通页面</title></head><body>
  <button id="blocked-button">BLOCKME button</button>
  <button id="allowed-button">allowed button</button>
  <a id="blocked-url" href="https://global-blocked.example/path">allowed label</a>
  <div id="blocked-card"><a href="/card"><span>BLOCKME card</span></a><p>extra card text</p></div>
  <input id="blocked-input" value="BLOCKME input">
  <img id="blocked-image" alt="BLOCKME image" src="data:image/gif;base64,R0lGODlhAQABAAD/ACw=">
  <div id="blocked-tooltip" title="BLOCKME tooltip"></div>
  <div id="dynamic-host"></div>
  <iframe id="blocked-frame" src="${frameUrl}"></iframe>
  <script>
    setTimeout(() => {
      const button = document.createElement('button');
      button.id = 'dynamic-blocked-button';
      button.textContent = 'BLOCKME dynamic';
      document.querySelector('#dynamic-host').append(button);
    }, 250);
  </script>
</body></html>`;

const frame = `<!doctype html><html><body>
  <button id="frame-blocked">BLOCKME frame</button>
</body></html>`;

const douyinFixture = `<!doctype html><html><head><title>搜索页</title></head><body>
  <main id="douyin-results"><article><a href="/video/1"><h2>光王结果</h2></a></article></main>
</body></html>`;

async function main() {
  const { chromium } = require(requireEnv('MYSEARCHPAGE_PLAYWRIGHT_MODULE'));
  const executable = requireEnv('MYSEARCHPAGE_CHROMIUM_BINARY');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mysearch-global-blocking-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: executable,
      headless: true,
      timeout: 20000,
      viewport: { width: 1200, height: 900 },
      ignoreDefaultArgs: ['--disable-extensions', '--headless'],
      args: [
        '--headless=new',
        `--load-extension=${extension}`,
        `--disable-extensions-except=${extension}`,
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    const worker = context.serviceWorkers()[0] || await context.waitForEvent(
      'serviceworker',
      { timeout: 10000 }
    );
    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        blockedKeywords: ['BLOCKME'],
        blockedUrlPatterns: ['global-blocked.example'],
        highRiskDomains: [],
        blockingEnabled: true,
      });
    });

    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url === fixtureUrl) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: fixture,
        });
        return;
      }
      if (url === frameUrl) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: frame,
        });
        return;
      }
      if (url === douyinUrl) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: douyinFixture,
        });
        return;
      }
      if (/^(chrome-extension|chrome|about|data|blob):/.test(url)) {
        await route.continue();
        return;
      }
      await route.abort('blockedbyclient');
    });

    const page = await context.newPage();
    await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const state = await page.evaluate(() => ({
      blockedButtonOriginalVisible: document.body.textContent.includes('BLOCKME button'),
      allowedButtonVisible: Boolean(document.querySelector('#allowed-button')),
      blockedUrlOriginalVisible: document.body.textContent.includes('allowed label'),
      blockedUrlStillActionable: Boolean(document.querySelector('#blocked-url[href]')),
      blockedCardOriginalVisible: document.body.textContent.includes('BLOCKME card'),
      blockedInputVisible: Boolean(document.querySelector('#blocked-input')),
      blockedImageVisible: Boolean(document.querySelector('#blocked-image')),
      blockedTooltipVisible: Boolean(document.querySelector('#blocked-tooltip[title]')),
      dynamicBlockedVisible: document.querySelector('#dynamic-blocked-button')
        ?.textContent.includes('BLOCKME dynamic') || false,
      placeholders: document.querySelectorAll('.mysearch-blocked-card-placeholder').length,
      elementStates: ['#blocked-button', '#blocked-url', '#blocked-input', '#blocked-image']
        .map(selector => {
          const element = document.querySelector(selector);
          return {
            selector,
            exists: Boolean(element),
            outer: element?.outerHTML || '',
            blocked: element?.hasAttribute('data-mysearch-blocked-card') || false,
          };
        }),
      dynamicOuter: document.querySelector('#dynamic-blocked-button')?.outerHTML || '',
    }));
    assert.equal(state.blockedButtonOriginalVisible, false);
    assert.equal(state.allowedButtonVisible, true);
    assert.equal(state.blockedUrlOriginalVisible, false);
    assert.equal(state.blockedUrlStillActionable, false, JSON.stringify(state));
    assert.equal(state.blockedCardOriginalVisible, false);
    assert.equal(state.blockedInputVisible, false, JSON.stringify(state));
    assert.equal(state.blockedImageVisible, false, JSON.stringify(state));
    assert.equal(state.blockedTooltipVisible, false, JSON.stringify(state));
    assert.equal(state.dynamicBlockedVisible, false, JSON.stringify(state));
    assert.ok(state.placeholders >= 6, JSON.stringify(state));

    const childFrame = page.frames().find(item => item.url() === frameUrl);
    assert.ok(childFrame, 'iframe should load the fixture');
    await page.waitForTimeout(1000);
    const frameState = await childFrame.evaluate(() => ({
      originalVisible: document.querySelector('#frame-blocked')
        ?.textContent.includes('BLOCKME frame') || false,
      placeholders: document.querySelectorAll(
        '.mysearch-blocked-card-placeholder'
      ).length,
      html: document.querySelector('#frame-blocked')?.outerHTML || '',
    }));
    assert.equal(frameState.originalVisible, false, JSON.stringify(frameState));
    assert.ok(frameState.placeholders >= 1, JSON.stringify(frameState));

    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        blockedKeywords: ['BLOCKME', '光王'],
      });
    });
    const douyinPage = await context.newPage();
    await douyinPage.goto(douyinUrl, { waitUntil: 'domcontentloaded' });
    await douyinPage.waitForFunction(() => (
      document.documentElement.hasAttribute('data-mysearch-page-gate') &&
      document.querySelector('#mysearch-blocking-notice')
    ), { timeout: 10000 });
    const douyinState = await douyinPage.evaluate(() => ({
      gate: document.documentElement.hasAttribute('data-mysearch-page-gate'),
      resultVisible: getComputedStyle(document.querySelector('#douyin-results'))
        .visibility !== 'hidden',
      notice: document.querySelector('#mysearch-blocking-notice')?.textContent || '',
    }));
    assert.equal(douyinState.gate, true);
    assert.equal(douyinState.resultVisible, false, JSON.stringify(douyinState));
    assert.match(douyinState.notice, /搜索词已阻断/);

    console.log(JSON.stringify({
      status: 'PASS',
      url: fixtureUrl,
      state,
      frameState,
      douyinState,
      iframeBlocked: true,
    }));
  } finally {
    if (context) await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
