'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.MYSEARCHPAGE_PLAYWRIGHT_MODULE || 'playwright-core');
const executablePath = process.env.MYSEARCHPAGE_CHROMIUM_BINARY;
if (!executablePath) throw new Error('需要设置 MYSEARCHPAGE_CHROMIUM_BINARY');
// Override is exclusively for an isolated negative-control copy, never the live browser.
const runtimePath = process.env.MYSEARCHPAGE_NATIVE_REDIRECT_SOURCE ||
  path.resolve(__dirname, '../extension/content/native-search-redirect-runtime.js');

function fixture(options) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; } [hidden] { display: none !important; }
    [data-e2e="modal-video-container"] { position: fixed; inset: 0; background: #fff; z-index: 10; }
    video { display: block; width: 320px; height: 180px; }
  </style></head><body><header><div id="portal-host"></div></header>
  <section id="results"><button data-result="A">视频 A</button><button data-result="B">视频 B</button><button data-result="C">视频 C</button></section>
  <script>
    const options = ${JSON.stringify(options)};
    const host = document.querySelector('#portal-host');
    const wrappers = [host];
    let slot = host;
    for (let i = 0; i < options.depth; i++) {
      const wrapper = document.createElement('div');
      wrapper.className = 'search-wrapper-' + i;
      slot.append(wrapper); wrappers.push(wrapper); slot = wrapper;
    }
    const state = window.fixtureState = { host, wrappers, results: document.querySelector('#results'), opened: [], closed: 0, errors: [], cached: null };
    function rebuildSearch() {
      slot.replaceChildren();
      const shell = document.createElement('div');
      if (options.marked) shell.setAttribute('data-e2e', 'searchbar-container');
      const unit = document.createElement('div');
      unit.className = 'dynamic-search-unit';
      const input = document.createElement('input'); input.setAttribute('data-e2e', 'searchbar-input');
      const submit = document.createElement('button'); submit.setAttribute('data-e2e', 'searchbar-button'); submit.textContent = '搜索';
      unit.append(input, submit); shell.append(unit); slot.append(shell);
    }
    rebuildSearch();
    function closeDetail() {
      const modal = state.cached;
      const video = modal.querySelector('video');
      video.pause(); clearInterval(state.timer);
      state.closedTracks = state.stream.getTracks(); state.closedTracks.forEach(track => track.stop());
      video.srcObject = null; state.lastClosedVideo = video;
      if (options.closeMode === 'cache') modal.hidden = true;
      else { modal.remove(); state.cached = null; }
      document.body.style.overflow = '';
      history.replaceState({}, '', '/search/JavaScript?type=video');
      state.closed++; rebuildSearch();
    }
    document.querySelectorAll('[data-result]').forEach(button => button.addEventListener('click', () => {
      const id = button.getAttribute('data-result');
      history.replaceState({}, '', '/search/JavaScript?type=video&modal_id=' + id);
      document.body.style.overflow = 'hidden';
      // React keeps this object reference. A detached host must NOT be recreated
      // or reattached by the fixture: that would conceal the production failure.
      setTimeout(async () => {
        try {
          let modal = state.cached;
          if (!modal) {
            modal = document.createElement('div'); modal.setAttribute('data-e2e', 'modal-video-container');
            const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', '关闭详情');
            close.addEventListener('click', closeDetail);
            const title = document.createElement('p'); title.id = 'detail-title';
            const video = document.createElement('video'); video.muted = true; video.playsInline = true;
            modal.append(close, title, video); host.append(modal); state.cached = modal;
          }
          modal.hidden = false; modal.setAttribute('data-aweme-id', id);
          modal.querySelector('p').textContent = '当前视频 ' + id;
          const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
          const draw = () => { const ctx = canvas.getContext('2d'); ctx.fillStyle = id === 'A' ? '#f00' : '#0a0'; ctx.fillRect(0, 0, 160, 90); };
          draw(); state.timer = setInterval(draw, 30);
          state.stream = canvas.captureStream(30);
          const video = modal.querySelector('video'); video.srcObject = state.stream;
          await video.play(); state.opened.push(id);
        } catch (error) { state.errors.push(String(error)); }
      }, 25);
    }));
  </script></body></html>`;
}

const scenarios = [
  { name: 'DYP-01/02 单层空容器，× 后移除详情', depth: 0, closeMode: 'remove', marked: false },
  { name: 'DYP-02/03 三层搜索 class 包装，× 后移除详情', depth: 3, closeMode: 'remove', marked: false },
  { name: 'DYP-01/05 三层包装，× 后缓存隐藏并复用详情', depth: 3, closeMode: 'cache', marked: false },
  { name: 'DYP-04 明确搜索 shell 仍替换且外围 portal 保留', depth: 1, closeMode: 'remove', marked: true },
];

(async () => {
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    for (const scenario of scenarios) {
      const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
      try {
        const page = await context.newPage(); page.setDefaultTimeout(8000);
        const errors = []; page.on('pageerror', error => errors.push(error.message));
        await context.route('**/*', route => route.request().url().startsWith('https://www.douyin.com/search/')
          ? route.fulfill({ contentType: 'text/html', body: fixture(scenario) }) : route.abort());
        await page.goto('https://www.douyin.com/search/JavaScript?type=video');
        await page.addScriptTag({ path: runtimePath });
        await page.evaluate(() => {
          window.fixtureController = MySearchNativeRedirect.createController({ chrome: {
            runtime: { sendMessage(_message, done) { done({ rules: { highRiskDomains: [] } }); } },
          } });
          fixtureController.start();
        });
        await page.waitForFunction(() => !document.querySelector('input[data-e2e="searchbar-input"]'));
        assert.deepEqual(await page.evaluate(() => ({
          nativeShells: document.querySelectorAll('[data-e2e="searchbar-container"]').length,
          entries: document.querySelectorAll('[data-msp-native-search-button="true"]').length,
        })), { nativeShells: 0, entries: 1 }, 'search replacement remains active and unique');
        assert.equal(await page.evaluate(() => fixtureState.wrappers.every(node => node.isConnected)), true,
          scenario.name + ': initial search replacement detached the future portal host');
        let cachedModal;
        for (const id of ['A', 'B', 'C', 'A']) {
          await page.click('[data-result="' + id + '"]');
          await page.waitForFunction(id => fixtureState.opened.at(-1) === id &&
            document.querySelector('[data-e2e="modal-video-container"] video')?.currentTime > 0, id);
          const state = await page.evaluate(id => {
            const modal = document.querySelector('[data-e2e="modal-video-container"]');
            const video = modal.querySelector('video'); const rect = video.getBoundingClientRect();
            let visibleAncestors = true;
            for (let node = video; node; node = node.parentElement) {
              const style = getComputedStyle(node);
              if (node.hidden || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) visibleAncestors = false;
            }
            return { connected: fixtureState.wrappers.every(node => node.isConnected) && video.isConnected,
              sameHost: document.querySelector('#portal-host') === fixtureState.host,
              sameResults: document.querySelector('#results') === fixtureState.results,
              target: modal.getAttribute('data-aweme-id'), route: new URL(location.href).searchParams.get('modal_id'),
              title: modal.querySelector('p').textContent, visible: visibleAncestors && !modal.hidden && rect.width > 0 && rect.height > 0 &&
                document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === video,
              playing: !video.paused && video.readyState >= 2 && video.videoWidth > 0,
              time: video.currentTime, errors: fixtureState.errors,
              sameCached: !window.previousModal || window.previousModal === modal };
          }, id);
          assert.equal(state.connected && state.sameHost && state.sameResults, true, scenario.name + ': preserved live DOM identities');
          assert.equal(state.visible && state.playing, true, scenario.name + ': detail must be visible AND playing, not just have a modal URL');
          assert.equal(state.target, id); assert.equal(state.route, id); assert.equal(state.title, '当前视频 ' + id);
          assert.deepEqual(state.errors, []);
          if (scenario.closeMode === 'cache' && cachedModal) assert.equal(state.sameCached, true);
          await page.waitForFunction(time => document.querySelector('[data-e2e="modal-video-container"] video').currentTime > time + 0.05, state.time);
          await page.evaluate(() => { window.previousModal = fixtureState.cached; }); cachedModal = true;
          await page.click('[aria-label="关闭详情"]');
          await page.waitForFunction(() => !document.querySelector('input[data-e2e="searchbar-input"]'));
          assert.deepEqual(await page.evaluate(() => ({
            connected: fixtureState.wrappers.every(node => node.isConnected),
            sameResults: document.querySelector('#results') === fixtureState.results,
            modalId: new URL(location.href).searchParams.get('modal_id'), scrollLock: document.body.style.overflow,
            stopped: fixtureState.lastClosedVideo.paused && fixtureState.closedTracks.every(track => track.readyState === 'ended'),
            visibleDetails: Array.from(document.querySelectorAll('[data-e2e="modal-video-container"]')).filter(node => !node.hidden).length,
            entryCount: document.querySelectorAll('[data-msp-native-search-button="true"]').length,
            nativeShells: document.querySelectorAll('[data-e2e="searchbar-container"]').length,
          })), { connected: true, sameResults: true, modalId: null, scrollLock: '', stopped: true, visibleDetails: 0, entryCount: 1, nativeShells: 0 },
          scenario.name + ': X close must restore the list and allow the next genuine click');
        }
        assert.deepEqual(await page.evaluate(() => ({ opened: fixtureState.opened, closed: fixtureState.closed, errors: fixtureState.errors })),
          { opened: ['A', 'B', 'C', 'A'], closed: 4, errors: [] });
        assert.deepEqual(errors, []);
        await page.evaluate(() => fixtureController.destroy());
        console.log('PASS: ' + scenario.name + '，四轮真实点击/×/播放时间推进');
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
