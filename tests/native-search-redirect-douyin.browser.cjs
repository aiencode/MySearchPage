'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const extension = path.resolve(__dirname, '../extension');
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
<head><title>Douyin 原生搜索替换验证</title></head>
<body>
  <header id="header">
    <div class="dy-owner-initial">
      <div class="dynamic-input-wrapper">
        <input
          data-e2e="searchbar-input"
          placeholder="搜索你感兴趣的内容"
        >
      </div>
      <button data-e2e="searchbar-button">搜索</button>
    </div>
  </header>
  <input id="ordinary-input" placeholder="发表评论">
  <div id="ordinary-text">文章讨论热榜，不是搜索浮层</div>
  <div
    id="preexisting-random-popup"
    class="dy-preexisting-random"
    style="position:absolute;left:0;top:48px"
  >猜你想搜</div>
  <script>
    function appendPopup(kind, text) {
      const popup = document.createElement('div');
      popup.setAttribute('data-e2e', kind);
      popup.textContent = text;
      popup.style.position = 'absolute';
      popup.style.left = '0px';
      popup.style.top = '48px';
      document.body.appendChild(popup);
    }

    function appendAllPopups() {
      appendPopup('search-history-panel', '历史记录');
      appendPopup('search-suggest-panel', '猜你想搜');
      appendPopup('search-hot-panel', '抖音热点');
      appendPopup('search-trend-panel', '热榜');

      const dynamicPopup = document.createElement('div');
      dynamicPopup.className = 'dy-random-popup';
      dynamicPopup.textContent = '猜你想搜';
      dynamicPopup.style.position = 'absolute';
      dynamicPopup.style.left = '0px';
      dynamicPopup.style.top = '48px';
      document.body.appendChild(dynamicPopup);
    }

    document.addEventListener('mouseover', event => {
      if (
        event.target.closest(
          '[data-msp-native-search-root="true"]'
        )
      ) {
        appendAllPopups();
      }
    }, true);

    window.popupTimer = setInterval(
      appendAllPopups,
      200
    );

    const characterPopup = document.createElement('div');
    characterPopup.className = 'dy-character-popup';
    characterPopup.style.position = 'absolute';
    characterPopup.style.left = '0px';
    characterPopup.style.top = '48px';
    characterPopup.appendChild(
      document.createTextNode('普通占位')
    );
    document.body.appendChild(characterPopup);

    setTimeout(() => {
      characterPopup.firstChild.nodeValue = '抖音热点';
    }, 1100);

    setTimeout(() => {
      const currentRoot = document.querySelector(
        '[data-msp-native-search-root="true"]'
      );
      const parent = currentRoot?.parentNode;
      if (!currentRoot || !parent) return;

      const marker = document.createComment(
        'douyin-spa-wrapper-marker'
      );
      parent.replaceChild(marker, currentRoot);

      const owner = document.createElement('div');
      owner.className = 'dy-owner-wrapped-rebuild';
      owner.innerHTML =
        '<div class="new-dynamic-wrapper">' +
          '<input data-e2e="searchbar-input">' +
        '</div>' +
        '<button data-e2e="searchbar-button">搜索</button>';
      owner.appendChild(currentRoot);
      parent.replaceChild(owner, marker);
    }, 700);

    setTimeout(() => {
      const owner = document.createElement('div');
      owner.className = 'dy-owner-separate-rebuild';
      owner.innerHTML =
        '<input data-e2e="searchbar-input">' +
        '<button data-e2e="searchbar-button">搜索</button>';
      document.querySelector('#header').appendChild(owner);
    }, 1500);

    setTimeout(() => {
      const dormant = document.createElement('div');
      dormant.id = 'dormant-popup';
      dormant.textContent = '普通内容';
      dormant.style.display = 'none';
      document.body.appendChild(dormant);

      setTimeout(() => {
        dormant.setAttribute(
          'data-e2e',
          'search-history-panel'
        );
        dormant.textContent = '历史记录';
        dormant.style.display = 'block';
        dormant.hidden = false;
      }, 400);
    }, 900);
  </script>
</body>
</html>`;

async function main() {
  const { chromium } = require(playwrightModule);
  const server = http.createServer((request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
    });
    response.end(fixture);
  });

  await new Promise(resolve =>
    server.listen(0, '127.0.0.1', resolve)
  );

  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), 'msp-douyin-search-')
  );
  let context;

  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: executable,
      headless: true,
      timeout: 20000,
      viewport: { width: 1200, height: 900 },
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
        '--host-resolver-rules=MAP www.douyin.com 127.0.0.1',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    const worker = context.serviceWorkers()[0] ||
      await context.waitForEvent('serviceworker', {
        timeout: 10000,
      });

    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        highRiskDomains: ['douyin.com'],
        blockedKeywords: [],
        blockedUrlPatterns: [],
        blockingEnabled: true,
      });
    });

    const page = await context.newPage();
    await page.goto(
      `http://www.douyin.com:${server.address().port}/fixture`,
      { waitUntil: 'domcontentloaded' }
    );

    const button = page.locator(
      '[data-msp-native-search-button="true"]'
    );
    await button.waitFor({
      state: 'visible',
      timeout: 10000,
    });
    await button.hover();

    let maximumVisiblePopupCount = 0;
    for (let sample = 0; sample < 50; sample += 1) {
      await page.waitForTimeout(100);
      const snapshot = await page.evaluate(() => {
        const popupSelector = [
          '[data-e2e*="search-history"]',
          '[data-e2e*="search-suggest"]',
          '[data-e2e*="search-hot"]',
          '[data-e2e*="search-trend"]',
          '.dy-random-popup',
          '.dy-preexisting-random',
          '.dy-character-popup',
        ].join(',');

        const visiblePopupCount = Array.from(
          document.querySelectorAll(popupSelector)
        ).filter(element => {
          const style = getComputedStyle(element);
          return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            /历史记录|猜你想搜|抖音热点|热榜/.test(
              element.textContent || ''
            );
        }).length;

        return {
          visiblePopupCount,
          buttonCount: document.querySelectorAll(
            '[data-msp-native-search-button="true"]'
          ).length,
          inputCount: document.querySelectorAll(
            '[data-e2e="searchbar-input"]'
          ).length,
          submitCount: document.querySelectorAll(
            '[data-e2e="searchbar-button"]'
          ).length,
        };
      });

      maximumVisiblePopupCount = Math.max(
        maximumVisiblePopupCount,
        snapshot.visiblePopupCount
      );
      assert.equal(snapshot.buttonCount, 1);
      assert.equal(snapshot.inputCount, 0);
      assert.equal(snapshot.submitCount, 0);
    }

    await page.evaluate(() => clearInterval(window.popupTimer));
    await page.waitForTimeout(150);

    const finalState = await page.evaluate(() => ({
      buttonCount: document.querySelectorAll(
        '[data-msp-native-search-button="true"]'
      ).length,
      inputCount: document.querySelectorAll(
        '[data-e2e="searchbar-input"]'
      ).length,
      submitCount: document.querySelectorAll(
        '[data-e2e="searchbar-button"]'
      ).length,
      originalOwnerCount: document.querySelectorAll(
        '.dy-owner-initial,' +
        '.dy-owner-wrapped-rebuild,' +
        '.dy-owner-separate-rebuild'
      ).length,
      replacementInsideNativeOwner: Boolean(
        document.querySelector(
          '[data-msp-native-search-root="true"]'
        )?.closest(
          '.dy-owner-initial,' +
          '.dy-owner-wrapped-rebuild,' +
          '.dy-owner-separate-rebuild'
        )
      ),
      sourceRoot: document.querySelector(
        '[data-msp-native-search-root="true"]'
      )?.getAttribute(
        'data-msp-native-search-source-root'
      ) || '',
      popupCount: document.querySelectorAll([
        '[data-e2e*="search-history"]',
        '[data-e2e*="search-suggest"]',
        '[data-e2e*="search-hot"]',
        '[data-e2e*="search-trend"]',
        '.dy-random-popup',
        '.dy-preexisting-random',
        '.dy-character-popup',
      ].join(',')).length,
      ordinaryInputExists: Boolean(
        document.querySelector('#ordinary-input')
      ),
      ordinaryTextExists: Boolean(
        document.querySelector('#ordinary-text')
      ),
    }));

    assert.equal(maximumVisiblePopupCount, 0);
    assert.deepEqual(finalState, {
      buttonCount: 1,
      inputCount: 0,
      submitCount: 0,
      originalOwnerCount: 0,
      replacementInsideNativeOwner: false,
      sourceRoot: 'douyin-owner-with-submit',
      popupCount: 0,
      ordinaryInputExists: true,
      ordinaryTextExists: true,
    });

    const openedPage = context.waitForEvent('page', {
      timeout: 10000,
    });
    await button.click();
    const searchPage = await openedPage;
    await searchPage.waitForLoadState('domcontentloaded');
    await searchPage.waitForFunction(
      () => document.activeElement?.id === 'search-input',
      null,
      { timeout: 15000 }
    );

    const focusState = await searchPage.evaluate(() => ({
      activeId: document.activeElement?.id || '',
      value: document.querySelector('#search-input')?.value || '',
      pathname: window.location.pathname,
    }));

    assert.deepEqual(focusState, {
      activeId: 'search-input',
      value: '',
      pathname: '/navigation/navigation.html',
    });

    console.log(JSON.stringify({
      status: 'PASS',
      maximumVisiblePopupCount,
      finalState,
      focusState,
    }));
  } finally {
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
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
