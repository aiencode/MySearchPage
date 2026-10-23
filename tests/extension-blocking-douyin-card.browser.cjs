'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const extension = path.resolve(__dirname, '../extension');
const targetUrl = 'https://www.douyin.com/search/管型冷压端子?type=general';
const fixture = `<!doctype html><html><head><title>抖音搜索</title>
<style>
  [data-e2e="search-result-container"] {
    width: 880px;
  }

  [data-e2e="search-result-item"] {
    display: inline-block;
    vertical-align: top;
    box-sizing: border-box;
    margin: 4px;
    padding: 8px;
    border: 1px solid #ccc;
  }

  [data-e2e="search-result-item"] h2 {
    margin: 0;
    font: 16px/1.2 sans-serif;
    white-space: nowrap;
  }

  [data-e2e="search-result-item"] img {
    display: block;
    width: 120px;
    height: 80px;
  }
</style></head><body>
  <main data-e2e="search-result-container">
    <article data-e2e="search-result-item" id="shared-badge-card">
      <a href="/video/100"><h2>普通视频标题</h2></a>
      <span class="common-live-badge">直播</span>
      <img alt="普通视频封面" src="data:image/gif;base64,R0lGODlhAQABAAD/ACw=" />
    </article>
    <article data-e2e="search-result-item" id="keyword-card">
      <a href="/video/200"><h2>真正封禁词</h2></a>
      <span class="common-live-badge">普通标签</span>
      <img alt="命中视频封面" src="data:image/gif;base64,R0lGODlhAQABAAD/ACw=" />
    </article>
  </main>
  <script>
    window.keywordCardOriginalWidth =
      document.querySelector(
        '#keyword-card'
      ).getBoundingClientRect().width;
  </script>
</body></html>`;

async function main() {
  const playwright = require(
    process.env.MYSEARCHPAGE_PLAYWRIGHT_MODULE || 'playwright'
  );
  const executable = process.env.MYSEARCHPAGE_CHROMIUM_BINARY;
  if (!executable) throw new Error('缺少 MYSEARCHPAGE_CHROMIUM_BINARY');

  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), 'mysearch-douyin-card-')
  );
  let context;
  try {
    context = await playwright.chromium.launchPersistentContext(profile, {
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
        blockedKeywords: ['真正封禁词', '直播'],
        blockedUrlPatterns: [],
        blockedAuthors: [],
        highRiskDomains: [],
        blockingEnabled: true,
        globalEnabled: false,
        searchMediaSettings: {
          'douyin.com': false,
        },
      });
    });

    await context.route('**/*', async route => {
      if (route.request().url().startsWith('https://www.douyin.com/search/')) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: fixture,
        });
        return;
      }
      const url = route.request().url();
      if (/^(chrome-extension|chrome|about|data|blob):/.test(url)) {
        await route.continue();
        return;
      }
      await route.abort('blockedbyclient');
    });

    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => {
      const container = document.querySelector(
        '[data-e2e="search-result-container"]'
      );
      const keywordCard = document.querySelector(
        '#keyword-card'
      );
      const placeholder = keywordCard?.querySelector(
        '.mysearch-blocked-card-placeholder'
      );

      return {
      sharedBadgeCardVisible: Boolean(
        document.querySelector('#shared-badge-card h2')
      ),
      sharedBadgeCardText: document.querySelector('#shared-badge-card')?.textContent || '',
      keywordCardVisible: Boolean(
        document.querySelector('#keyword-card h2')
      ),
      keywordCardPlaceholder: Boolean(
        document.querySelector('#keyword-card .mysearch-blocked-card-placeholder')
      ),
      sharedBadgeCardPlaceholder: Boolean(
        document.querySelector('#shared-badge-card .mysearch-blocked-card-placeholder')
      ),
      keywordCardOriginalWidth:
        Number(window.keywordCardOriginalWidth) || 0,
      keywordCardWidth:
        keywordCard?.getBoundingClientRect().width || 0,
      keywordPlaceholderWidth:
        placeholder?.getBoundingClientRect().width || 0,
      resultContainerWidth:
        container?.getBoundingClientRect().width || 0,
      blockedInlineSize:
        keywordCard
          ? getComputedStyle(keywordCard)
            .getPropertyValue(
              '--mysearch-blocked-card-inline-size'
            )
            .trim()
          : '',
      };
    });
    assert.equal(state.sharedBadgeCardVisible, true, JSON.stringify(state));
    assert.match(state.sharedBadgeCardText, /普通视频标题/);
    assert.equal(state.sharedBadgeCardPlaceholder, false, JSON.stringify(state));
    assert.equal(state.keywordCardVisible, false, JSON.stringify(state));
    assert.equal(state.keywordCardPlaceholder, true, JSON.stringify(state));
    assert.ok(
      state.keywordCardOriginalWidth > 0,
      JSON.stringify(state)
    );
    assert.ok(
      Math.abs(
        state.keywordCardWidth -
        state.keywordCardOriginalWidth
      ) <= 1,
      JSON.stringify(state)
    );
    assert.ok(
      state.keywordCardWidth <
        state.resultContainerWidth / 2,
      JSON.stringify(state)
    );
    assert.ok(
      state.keywordPlaceholderWidth > 0 &&
        state.keywordPlaceholderWidth <=
          state.keywordCardWidth,
      JSON.stringify(state)
    );
    assert.match(state.blockedInlineSize, /^\d+(?:\.\d+)?px$/);
    console.log(JSON.stringify({ status: 'PASS', state }));
  } finally {
    if (context) await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
