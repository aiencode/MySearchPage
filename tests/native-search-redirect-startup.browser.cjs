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
const runs = Math.max(
  1,
  Number(process.env.MYSEARCHPAGE_BLACKBOX_RUNS || 10)
);
const warmups = Math.max(
  0,
  Number(process.env.MYSEARCHPAGE_BLACKBOX_WARMUPS || 1)
);
const domNodes = Math.max(
  100,
  Number(
    process.env.MYSEARCHPAGE_BLACKBOX_DOM_NODES || 3000
  )
);
const hoverMs = Math.max(
  1000,
  Number(
    process.env.MYSEARCHPAGE_BLACKBOX_HOVER_MS || 5000
  )
);

const FIXTURE_BASE_URL =
  'https://www.douyin.com/startup-blackbox';

if (!playwrightModule || !executable) {
  throw new Error(
    '需要设置 MYSEARCHPAGE_PLAYWRIGHT_MODULE 和 ' +
    'MYSEARCHPAGE_CHROMIUM_BINARY'
  );
}

const ordinaryNodes = Array.from(
  { length: domNodes },
  (_, index) =>
    `<div class="feed-node feed-${index % 24}">` +
    `<span>普通内容 ${index}</span></div>`
).join('');

const fixture = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Native Search Black-box Startup</title>
  <style>
    .douyin-native-search-shell {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      width: 600px;
      min-height: 40px;
      padding: 4px;
      background: rgba(80, 80, 80, 0.35);
    }

    .native-input-face {
      box-sizing: border-box;
      width: 470px;
      min-height: 32px;
      background: rgba(255, 255, 255, 0.35);
    }

    /*
     * 模拟真实问题：离开时输入框面显示，移入时反而隐藏。
     * 正确实现必须在 hover 发生前就整体删除该 shell。
     */
    .douyin-native-search-shell:hover >
      .native-input-face {
      display: none;
    }
  </style>
  <script>
    window.__mspBlackboxTiming = {
      scriptStartedAt: performance.now(),
      ownerParseStartedAt: null,
      buttonObservedAt: null,
      domContentLoadedAt: null
    };

    const buttonObserver = new MutationObserver(() => {
      if (
        window.__mspBlackboxTiming.buttonObservedAt == null &&
        document.querySelector(
          '[data-msp-native-search-button="true"]'
        )
      ) {
        window.__mspBlackboxTiming.buttonObservedAt =
          performance.now();
      }
    });

    buttonObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    document.addEventListener('DOMContentLoaded', () => {
      window.__mspBlackboxTiming.domContentLoadedAt =
        performance.now();
      if (
        window.__mspBlackboxTiming.buttonObservedAt == null &&
        document.querySelector(
          '[data-msp-native-search-button="true"]'
        )
      ) {
        window.__mspBlackboxTiming.buttonObservedAt =
          performance.now();
      }
    });
  </script>
</head>
<body>
  <script>
    window.__mspBlackboxTiming.ownerParseStartedAt =
      performance.now();
  </script>
  <header id="header">
    <div
      id="native-visual-shell"
      class="douyin-native-search-shell"
    >
      <div class="native-input-face">
        原生搜索输入框
      </div>
      <div class="perf-search-owner">
        <div class="perf-input-wrapper">
          <input
            data-e2e="searchbar-input"
            placeholder="搜索你感兴趣的内容"
          >
        </div>
        <button data-e2e="searchbar-button">
          搜索
        </button>
      </div>
    </div>
  </header>
  <main id="ordinary-content">${ordinaryNodes}</main>
  <div id="mutation-root"></div>
  <script>
    let mutationBatch = 0;
    window.__mutationTimer = setInterval(() => {
      const root = document.querySelector('#mutation-root');
      const fragment = document.createDocumentFragment();

      for (let index = 0; index < 12; index += 1) {
        const node = document.createElement('div');
        node.className =
          'mutation-node mutation-' +
          ((mutationBatch + index) % 16);
        node.textContent =
          '动态普通内容 ' + mutationBatch + '-' + index;
        fragment.appendChild(node);
      }

      root.appendChild(fragment);
      root.className =
        'mutation-root state-' + (mutationBatch % 5);
      if (root.firstChild) {
        root.firstChild.textContent =
          '更新后的普通内容 ' + mutationBatch;
      }
      while (root.childNodes.length > 360) {
        root.removeChild(root.firstChild);
      }

      mutationBatch += 1;
      if (mutationBatch >= 100) {
        clearInterval(window.__mutationTimer);
      }
    }, 20);

    function appendPopup(kind, text, className) {
      const popup = document.createElement('div');
      if (kind) popup.setAttribute('data-e2e', kind);
      popup.className = className || '';
      popup.textContent = text;
      popup.style.position = 'absolute';
      popup.style.left = '0px';
      popup.style.top = '48px';
      document.body.appendChild(popup);
    }

    window.__startPopupChurn = () => {
      if (window.__popupTimer) return;
      window.__popupTimer = setInterval(() => {
        appendPopup(
          'search-history-panel',
          '历史记录',
          ''
        );
        appendPopup(
          '',
          '猜你想搜',
          'runtime-random-popup'
        );
      }, 100);
    };

    window.__stopPopupChurn = () => {
      clearInterval(window.__popupTimer);
      window.__popupTimer = null;
    };

    /*
     * 模拟 SPA 使用完全不同 class 重建同样的灰色搜索 shell。
     * 它也必须在用户 hover 前被整体清除。
     */
    setTimeout(() => {
      const shell = document.createElement('div');
      shell.className =
        'douyin-native-search-shell spa-native-shell';
      shell.innerHTML =
        '<div class="native-input-face">' +
          'SPA 原生搜索输入框' +
        '</div>' +
        '<div class="spa-inner-search-owner">' +
          '<input data-e2e="searchbar-input">' +
          '<button data-e2e="searchbar-button">' +
            '搜索' +
          '</button>' +
        '</div>';
      document.querySelector('#header').appendChild(shell);
    }, 700);
  </script>
</body>
</html>`;

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(
      0,
      Math.ceil(sorted.length * fraction) - 1
    )
  );
  return sorted[index];
}

function statistics(values) {
  const numbers = values
    .map(Number)
    .filter(Number.isFinite);

  return {
    min: Math.min(...numbers),
    median: percentile(numbers, 0.5),
    p95: percentile(numbers, 0.95),
    max: Math.max(...numbers),
  };
}

async function readIsolatedRuntimeState(worker, pageUrl) {
  return worker.evaluate(async url => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(item => item.url === url);
    if (!Number.isInteger(tab?.id)) return null;

    const results = await chrome.scripting.executeScript({
      target: {
        tabId: tab.id,
        frameIds: [0],
      },
      func: () => ({
        runtimeApiLoaded: Boolean(
          globalThis.MySearchNativeRedirect
        ),
        performanceInstrumentationPresent:
          '__MYSEARCH_NATIVE_SEARCH_PERF__' in globalThis,
      }),
    });

    return results?.[0]?.result || null;
  }, pageUrl);
}

async function main() {
  const { chromium } = require(playwrightModule);
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), 'msp-native-blackbox-')
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
          width: 1280,
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

    await context.route(
      /^https:\/\/www\.douyin\.com\/startup-blackbox(?:\?|$)/,
      route => route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: fixture,
      })
    );

    const worker =
      context.serviceWorkers()[0] ||
      await context.waitForEvent('serviceworker', {
        timeout: 10000,
      });

    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        highRiskDomains: ['douyin.com'],
        blockingEnabled: true,
      });
    });

    async function runOnce(runIndex, emit) {
      const page = await context.newPage();
      const pageUrl =
        `${FIXTURE_BASE_URL}?run=${runIndex}`;

      try {
        await page.goto(pageUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        const button = page.locator(
          '[data-msp-native-search-button="true"]'
        );
        await button.waitFor({
          state: 'visible',
          timeout: 10000,
        });
        await page.waitForFunction(
          () =>
            window.__mspBlackboxTiming?.buttonObservedAt !=
            null
        );

        const isolatedRuntimeState =
          await readIsolatedRuntimeState(
            worker,
            page.url()
          );
        assert.deepEqual(isolatedRuntimeState, {
          runtimeApiLoaded: true,
          performanceInstrumentationPresent: false,
        });

        await page.waitForTimeout(2300);

        const preHoverNativeState =
          await page.evaluate(() => {
            const root = document.querySelector(
              '[data-msp-native-search-root="true"]'
            );

            return {
              nativeVisualShells:
                document.querySelectorAll(
                  '.douyin-native-search-shell'
                ).length,
              nativeInputFaces:
                document.querySelectorAll(
                  '.native-input-face'
                ).length,
              replacementInsideNativeShell: Boolean(
                root?.closest(
                  '.douyin-native-search-shell'
                )
              ),
              replacementWidth:
                root?.getBoundingClientRect().width || 0,
              headerExists: Boolean(
                document.querySelector('#header')
              ),
            };
          });

        assert.deepEqual(
          {
            nativeVisualShells:
              preHoverNativeState.nativeVisualShells,
            nativeInputFaces:
              preHoverNativeState.nativeInputFaces,
            replacementInsideNativeShell:
              preHoverNativeState
                .replacementInsideNativeShell,
            headerExists:
              preHoverNativeState.headerExists,
          },
          {
            nativeVisualShells: 0,
            nativeInputFaces: 0,
            replacementInsideNativeShell: false,
            headerExists: true,
          },
          '未 hover 时原生视觉 shell 和输入框面必须已消失'
        );

        assert.ok(
          preHoverNativeState.replacementWidth > 0 &&
          preHoverNativeState.replacementWidth <= 260,
          `自绘入口不得继承 600px 原生占位，实际宽度为 ${
            preHoverNativeState.replacementWidth
          }`
        );

        await page.evaluate(() =>
          window.__startPopupChurn()
        );

        const hoverStartedAt = Date.now();
        await button.hover();
        const box = await button.boundingBox();
        assert.ok(box, '自绘按钮必须有可见矩形');

        for (let index = 0; index < 100; index += 1) {
          await page.mouse.move(
            box.x + 4 + (index % 8),
            box.y + 4 + (index % 6)
          );
          await page.waitForTimeout(10);
        }

        const remainingHoverMs =
          hoverMs - (Date.now() - hoverStartedAt);
        if (remainingHoverMs > 0) {
          await page.waitForTimeout(remainingHoverMs);
        }

        await page.evaluate(() =>
          window.__stopPopupChurn()
        );
        await page.mouse.move(1270, 890);
        await page.waitForTimeout(150);

        const result = await page.evaluate(() => {
          const popupSelector = [
            '[data-e2e*="search-history"]',
            '.runtime-random-popup',
          ].join(',');
          const visiblePopups = Array.from(
            document.querySelectorAll(popupSelector)
          ).filter(element => {
            const style = getComputedStyle(element);
            return style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              style.opacity !== '0';
          }).length;

          const timing = window.__mspBlackboxTiming;
          return {
            navigationToButtonObservedMs:
              timing.buttonObservedAt,
            fixtureScriptToButtonObservedMs:
              timing.buttonObservedAt -
              timing.scriptStartedAt,
            ownerParseStartToButtonObservedMs:
              timing.buttonObservedAt -
              timing.ownerParseStartedAt,
            state: {
              buttons: document.querySelectorAll(
                '[data-msp-native-search-button="true"]'
              ).length,
              inputs: document.querySelectorAll(
                '[data-e2e="searchbar-input"]'
              ).length,
              submits: document.querySelectorAll(
                '[data-e2e="searchbar-button"]'
              ).length,
              originalOwners: document.querySelectorAll(
                '.perf-search-owner'
              ).length,
              nativeVisualShells:
                document.querySelectorAll(
                  '.douyin-native-search-shell'
                ).length,
              nativeInputFaces:
                document.querySelectorAll(
                  '.native-input-face'
                ).length,
              replacementInsideNativeShell: Boolean(
                document.querySelector(
                  '[data-msp-native-search-root="true"]'
                )?.closest(
                  '.douyin-native-search-shell'
                )
              ),
              headerExists: Boolean(
                document.querySelector('#header')
              ),
              sourceRoot: document.querySelector(
                '[data-msp-native-search-root="true"]'
              )?.getAttribute(
                'data-msp-native-search-source-root'
              ) || '',
              visiblePopups,
              ordinaryNodes: document.querySelectorAll(
                '.feed-node'
              ).length,
            },
          };
        });

        assert.deepEqual(result.state, {
          buttons: 1,
          inputs: 0,
          submits: 0,
          originalOwners: 0,
          nativeVisualShells: 0,
          nativeInputFaces: 0,
          replacementInsideNativeShell: false,
          headerExists: true,
          sourceRoot: 'douyin-owner-with-submit',
          visiblePopups: 0,
          ordinaryNodes: domNodes,
        });

        for (const field of [
          'navigationToButtonObservedMs',
          'fixtureScriptToButtonObservedMs',
          'ownerParseStartToButtonObservedMs',
        ]) {
          assert.ok(
            Number.isFinite(result[field]) &&
              result[field] >= 0,
            `${field} 必须是非负有限数值`
          );
        }

        const record = {
          type: 'run',
          schemaVersion: 1,
          run: runIndex,
          preHoverNativeState,
          ...result,
        };
        if (emit) console.log(JSON.stringify(record));
        return record;
      } finally {
        await page.close();
      }
    }

    for (let index = 0; index < warmups; index += 1) {
      await runOnce(`warmup-${index + 1}`, false);
    }

    const results = [];
    for (let index = 0; index < runs; index += 1) {
      results.push(await runOnce(index + 1, true));
    }

    console.log(JSON.stringify({
      type: 'summary',
      schemaVersion: 1,
      runs,
      warmups,
      domNodes,
      hoverMs,
      summary: {
        navigationToButtonObservedMs: statistics(
          results.map(
            item => item.navigationToButtonObservedMs
          )
        ),
        fixtureScriptToButtonObservedMs: statistics(
          results.map(
            item => item.fixtureScriptToButtonObservedMs
          )
        ),
        ownerParseStartToButtonObservedMs: statistics(
          results.map(
            item =>
              item.ownerParseStartToButtonObservedMs
          )
        ),
      },
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
