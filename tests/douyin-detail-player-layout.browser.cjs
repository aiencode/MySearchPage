'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const extension = path.resolve(__dirname, '../extension');
const playwrightModule =
  process.env.MYSEARCHPAGE_PLAYWRIGHT_MODULE;
const executable =
  process.env.MYSEARCHPAGE_CHROMIUM_BINARY;
const targetUrl =
  'https://www.douyin.com/video/7000000000000000001';

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
  <title>Douyin detail player layout</title>
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
    }

    #app {
      width: 640px;
    }

    #detail-player {
      position: relative;
      display: block;
      width: 640px;
      height: 360px;
      background: rgb(20, 20, 20);
      overflow: hidden;
    }

    #detail-player video,
    #detail-player canvas {
      position: absolute;
      inset: 0;
      display: block;
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <div id="app">
    <section
      data-e2e="feed-active-video"
      data-aweme-id="7000000000000000001"
    >
      <xgplayer
        id="detail-player"
        class="xgplayer xgplayer-pc detail-player-container"
      >
        <video id="detail-video"></video>
        <canvas id="detail-canvas"></canvas>
      </xgplayer>
      <audio id="detail-audio" controls></audio>
    </section>
  </div>
</body>
</html>`;

async function main() {
  const { chromium } = require(playwrightModule);
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), 'msp-douyin-player-')
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
        /^(chrome-extension|chrome|about|data|blob):/.test(url)
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
        globalEnabled: true,
        uaRules: {
          'douyin.com': {
            enabled: true,
            uiTransform: true,
            uaMode: 'desktop',
            presetKey: 'chrome_windows',
            customUA: null,
          },
        },
        searchMediaSettings: {
          'douyin.com': true,
        },
        blockedKeywords: [],
        blockedUrlPatterns: [],
        blockedAuthors: [],
        blockingEnabled: false,
      });
    });

    const page = await context.newPage();
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForFunction(() => {
      const player = document.querySelector(
        '#detail-player'
      );
      return player?.style.width === '100%' &&
        player?.style.maxWidth === '100%';
    }, null, {
      timeout: 10000,
    });

    const state = await page.evaluate(() => {
      const player = document.querySelector(
        '#detail-player'
      );
      const video = document.querySelector(
        '#detail-video'
      );
      const canvas = document.querySelector(
        '#detail-canvas'
      );
      const audio = document.querySelector(
        '#detail-audio'
      );

      const playerStyle = getComputedStyle(player);
      const videoStyle = getComputedStyle(video);
      const canvasStyle = getComputedStyle(canvas);
      const playerRect = player.getBoundingClientRect();
      const videoRect = video.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();

      return {
        viewportWidth: document.documentElement.clientWidth,
        playerDisplay: playerStyle.display,
        playerComputedHeight: playerStyle.height,
        playerWidth: playerRect.width,
        playerHeight: playerRect.height,
        videoDisplay: videoStyle.display,
        videoVisibility: videoStyle.visibility,
        videoOpacity: videoStyle.opacity,
        videoWidth: videoRect.width,
        videoHeight: videoRect.height,
        canvasDisplay: canvasStyle.display,
        canvasVisibility: canvasStyle.visibility,
        canvasOpacity: canvasStyle.opacity,
        canvasWidth: canvasRect.width,
        canvasHeight: canvasRect.height,
        inlineWidth: player.style.width,
        inlineMaxWidth: player.style.maxWidth,
        inlineHeight: player.style.height,
        inlineAspectRatio:
          player.style.getPropertyValue('aspect-ratio'),
        audioConnected: audio.isConnected,
        audioInsidePlayer: player.contains(audio),
      };
    });

    assert.equal(state.playerDisplay, 'block');
    assert.equal(state.playerComputedHeight, '360px');
    assert.equal(state.inlineWidth, '100%');
    assert.equal(state.inlineMaxWidth, '100%');
    assert.equal(state.inlineHeight, '');
    assert.equal(state.inlineAspectRatio, '');
    assert.ok(
      state.playerWidth > 0,
      `播放器宽度必须大于零，实际为 ${state.playerWidth}`
    );
    assert.ok(
      state.playerHeight >= 360,
      `播放器不得高度塌陷，实际为 ${state.playerHeight}`
    );
    assert.equal(state.videoDisplay, 'block');
    assert.notEqual(state.videoVisibility, 'hidden');
    assert.notEqual(state.videoOpacity, '0');
    assert.ok(
      state.videoWidth > 0,
      `视频画面宽度必须大于零，实际为 ${state.videoWidth}`
    );
    assert.ok(
      state.videoHeight >= 360,
      `视频画面不得高度塌陷，实际为 ${state.videoHeight}`
    );
    assert.equal(state.canvasDisplay, 'block');
    assert.notEqual(state.canvasVisibility, 'hidden');
    assert.notEqual(state.canvasOpacity, '0');
    assert.ok(
      state.canvasWidth > 0,
      `画布宽度必须大于零，实际为 ${state.canvasWidth}`
    );
    assert.ok(
      state.canvasHeight >= 360,
      `画布不得高度塌陷，实际为 ${state.canvasHeight}`
    );
    const minimumVisualWidth =
      Math.min(state.playerWidth, state.viewportWidth) * 0.9;
    assert.ok(
      state.videoWidth >= minimumVisualWidth,
      '视频画面必须覆盖播放器的主要可见宽度'
    );
    assert.ok(
      state.canvasWidth >= minimumVisualWidth,
      '画布必须覆盖播放器的主要可见宽度'
    );
    assert.equal(state.audioConnected, true);
    assert.equal(
      state.audioInsidePlayer,
      false,
      '独立音频路径不能参与播放器容器高度计算'
    );

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
