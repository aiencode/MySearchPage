'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const extension = path.resolve(__dirname, '../extension');
const targetUrl =
  'https://www.douyin.com/search/detail-boundary?type=video';
const playwrightModule =
  process.env.MYSEARCHPAGE_PLAYWRIGHT_MODULE;
const executable =
  process.env.MYSEARCHPAGE_CHROMIUM_BINARY;

if (!playwrightModule || !executable) {
  throw new Error(
    '需要设置 MYSEARCHPAGE_PLAYWRIGHT_MODULE 和 ' +
    'MYSEARCHPAGE_CHROMIUM_BINARY'
  );
}

const fixture = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Douyin detail boundary regression</title>
  <style>
    canvas, video, audio {
      display: block;
      width: 160px;
      height: 90px;
    }
  </style>
</head>
<body>
  <main>
    <ul data-e2e="search-result-list" id="results">
      <li
        data-e2e="search-video-card"
        id="active-card"
      >
        <a
          class="video-cover"
          href="/video/7000000000000000001"
        >
          <canvas id="active-canvas"></canvas>
          <video
            id="active-video"
            autoplay
            src=""
          ></video>
        </a>
        <h2>待打开的视频</h2>
        <button id="open-detail" type="button">
          打开详情
        </button>
      </li>
      <li
        data-e2e="search-video-card"
        id="background-card"
      >
        <a
          class="video-cover"
          href="/video/7000000000000000002"
        >
          <canvas id="background-canvas"></canvas>
          <video
            id="background-video"
            autoplay
            src=""
          ></video>
        </a>
        <h2>背景搜索结果</h2>
      </li>
    </ul>
  </main>
  <script>
    document
      .querySelector('#open-detail')
      .addEventListener('click', () => {
        const activeCard =
          document.querySelector('#active-card');
        const detail =
          document.createElement('section');

        detail.id = 'active-detail';
        detail.setAttribute(
          'data-e2e',
          'feed-active-video'
        );

        activeCard.replaceWith(detail);
        detail.appendChild(activeCard);

        /*
         * 模拟真实 SPA：详情根先出现，内容 ID 稍后挂载。
         * 这段窗口内不得把详情当成搜索结果卡片阻断。
         */
        setTimeout(() => {
          detail.setAttribute(
            'data-aweme-id',
            '7000000000000000001'
          );
        }, 200);

        const audio = document.createElement('audio');
        audio.id = 'detail-audio';
        audio.controls = true;
        detail.appendChild(audio);
      });
  </script>
</body>
</html>`;

async function main() {
  const { chromium } = require(playwrightModule);
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), 'msp-douyin-detail-')
  );
  let context;

  try {
    context = await chromium.launchPersistentContext(
      profile,
      {
        executablePath: executable,
        headless: true,
        timeout: 30000,
        viewport: {
          width: 1200,
          height: 900,
        },
        ignoreDefaultArgs: [
          '--disable-extensions',
          '--headless',
        ],
        args: [
          '--headless=new',
          '--disable-gpu',
          '--disable-gpu-compositing',
          `--load-extension=${extension}`,
          `--disable-extensions-except=${extension}`,
          '--no-first-run',
          '--no-default-browser-check',
        ],
      }
    );

    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(targetUrl)) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: fixture,
        });
        return;
      }
      if (
        /^(chrome-extension|chrome|about|data|blob):/
          .test(url)
      ) {
        await route.continue();
        return;
      }
      await route.abort('blockedbyclient');
    });

    const worker =
      context.serviceWorkers()[0] ||
      await context.waitForEvent('serviceworker', {
        timeout: 10000,
      });

    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        searchMediaSettings: {
          'bilibili.com': true,
          'douyin.com': true,
          'youtube.com': true,
          'xiaohongshu.com': true,
        },
        blockedKeywords: [],
        blockedUrlPatterns: [],
        blockedAuthors: [],
        highRiskDomains: [],
        blockingEnabled: true,
      });
    });

    const page = await context.newPage();
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForFunction(() => {
      const activeVideo =
        document.querySelector('#active-video');
      const backgroundVideo =
        document.querySelector('#background-video');
      return activeVideo &&
        backgroundVideo &&
        getComputedStyle(activeVideo).display === 'none' &&
        getComputedStyle(backgroundVideo).display === 'none';
    });

    await page.locator('#open-detail').click();

    await page.waitForFunction(() => {
      const detail =
        document.querySelector(
          '[data-e2e="feed-active-video"]' +
          '[data-aweme-id]'
        );
      const activeVideo =
        document.querySelector('#active-video');
      const activeCanvas =
        document.querySelector('#active-canvas');
      const backgroundVideo =
        document.querySelector('#background-video');

      return detail &&
        activeVideo &&
        activeCanvas &&
        getComputedStyle(activeVideo).display !== 'none' &&
        getComputedStyle(activeCanvas).display !== 'none' &&
        getComputedStyle(backgroundVideo).display === 'none';
    }, null, {
      timeout: 10000,
    });

    const state = await page.evaluate(() => {
      function visible(element) {
        if (!element?.isConnected) return false;
        for (
          let current = element;
          current;
          current = current.parentElement
        ) {
          const style = getComputedStyle(current);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.opacity === '0'
          ) {
            return false;
          }
        }
        return true;
      }

      const activeVideo =
        document.querySelector('#active-video');
      const activeCanvas =
        document.querySelector('#active-canvas');
      const backgroundVideo =
        document.querySelector('#background-video');
      const backgroundCanvas =
        document.querySelector('#background-canvas');
      const detailAudio =
        document.querySelector('#detail-audio');

      return {
        pathname: location.pathname,
        detailRootCount: document.querySelectorAll(
          '[data-e2e="feed-active-video"]' +
          '[data-aweme-id]'
        ).length,
        blockedPlaceholderCount: document.querySelectorAll(
          '.mysearch-blocked-card-placeholder'
        ).length,
        blockedCardCount: document.querySelectorAll(
          '[data-mysearch-blocked-card]'
        ).length,
        detailBlockedNodeCount: document.querySelectorAll(
          '#active-detail [data-mysearch-blocked],' +
          '#active-detail [data-mysearch-blocked-card]'
        ).length,
        pageGateActive: document.documentElement.hasAttribute(
          'data-mysearch-page-gate'
        ),
        bodyVisibility: getComputedStyle(document.body).visibility,
        activeVideoVisible: visible(activeVideo),
        activeCanvasVisible: visible(activeCanvas),
        detailAudioVisible: visible(detailAudio),
        backgroundVideoVisible:
          visible(backgroundVideo),
        backgroundCanvasVisible:
          visible(backgroundCanvas),
        activeVideoMuted: activeVideo?.muted,
        activeVideoAutoplay: activeVideo?.autoplay,
        activeVideoStyleLedger: activeVideo?.hasAttribute(
          'data-mysearch-media-style-ledger'
        ),
        activeVideoPlayerLedger: activeVideo?.hasAttribute(
          'data-mysearch-media-player-ledger'
        ),
      };
    });

    assert.deepEqual(state, {
      pathname: '/search/detail-boundary',
      detailRootCount: 1,
      blockedPlaceholderCount: 0,
      blockedCardCount: 0,
      detailBlockedNodeCount: 0,
      pageGateActive: false,
      bodyVisibility: 'visible',
      activeVideoVisible: true,
      activeCanvasVisible: true,
      detailAudioVisible: true,
      backgroundVideoVisible: false,
      backgroundCanvasVisible: false,
      activeVideoMuted: false,
      activeVideoAutoplay: true,
      activeVideoStyleLedger: false,
      activeVideoPlayerLedger: false,
    });

    console.log(JSON.stringify({
      status: 'PASS',
      state,
    }));
  } finally {
    if (context) await context.close();
    fs.rmSync(profile, {
      recursive: true,
      force: true,
    });
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
