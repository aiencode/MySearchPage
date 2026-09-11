'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { sites, cardMarkup, pageMarkup } = require('./fixtures/search-media/sites');

// Resolve from an existing external toolchain if supplied. No install or personal
// toolchain path is embedded in the project. A missing dependency is EXECUTION_ERROR.
let JSDOM;
let VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require(process.env.MYSEARCHPAGE_JSDOM_MODULE || 'jsdom'));
} catch (error) {
  throw new Error('EXECUTION_ERROR: jsdom unavailable; set MYSEARCHPAGE_JSDOM_MODULE to its module entry', { cause: error });
}

const EXTENSION = path.resolve(__dirname, '../extension');
const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION, 'manifest.json'), 'utf8'));
const TC = {
  'S-01': 'TC-01a07543-5a84-7268-83ed-ebe9a540e9be',
  'S-02': 'TC-01a07543-5a85-7349-9126-28434946fe97',
  'S-03': 'TC-01a07543-5a86-7205-a273-4892fe4902aa',
  'S-04': 'TC-01a07543-5a87-7de0-b7e4-acd3a543f0b1',
  'S-05': 'TC-01a07543-5a88-76be-8e60-6877c941eaa7',
  'S-06': 'TC-01a07543-5a89-740d-9cb0-9ab1094befb9',
  'S-07': 'TC-01a07543-5a8a-7c5a-aa3b-1333dd4bcb91',
  'S-08': 'TC-01a07543-5a8b-796f-be91-2abcc54f9e8e',
  'S-09': 'TC-01a07543-5a8c-7d24-8322-79a51f49a6bc',
  'S-10': 'TC-01a07543-5a8d-7139-9902-83790c4f8d9c',
  'S-11': 'TC-01a07543-5a8e-77e3-aea9-9eae8e471cbf',
  'S-12': 'TC-01a07543-5a8f-72ba-b31c-1a8eaa43e99b',
  'S-13': 'TC-01a07546-cca1-7540-8346-f6107840ac94',
};

const copy = value => JSON.parse(JSON.stringify(value));
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function matchPattern(pattern, url) {
  if (pattern === '<all_urls>') return /^https?:/.test(url);
  const parsed = new URL(url);
  const match = pattern.match(/^(\*|https?|file):\/\/([^/]*)(\/.*)$/);
  if (!match) throw new Error('EXECUTION_ERROR: unsupported manifest match pattern ' + pattern);
  const [, scheme, host, pathname] = match;
  const hostMatches = host === '*' || host === parsed.hostname ||
    (host.startsWith('*.') && (parsed.hostname === host.slice(2) || parsed.hostname.endsWith('.' + host.slice(2))));
  const pathPattern = new RegExp('^' + pathname.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return (scheme === '*' ? /^https?:$/.test(parsed.protocol) : parsed.protocol === scheme + ':') &&
    hostMatches && pathPattern.test(parsed.pathname + parsed.search);
}

function createEvent() {
  const listeners = new Set();
  return {
    addListener(fn) { listeners.add(fn); },
    removeListener(fn) { listeners.delete(fn); },
    hasListener(fn) { return listeners.has(fn); },
    emit(...args) { for (const listener of listeners) listener(...args); },
  };
}

async function harness(t, site, {
  url = site.search, html = pageMarkup(site), ua = {},
  mediaSettings = undefined, shared = undefined, loadOptions = false,
} = {}) {
  const failures = [];
  const actions = [];
  const writes = [];
  const loadedScripts = [];
  const store = shared?.store || {
    globalEnabled: false,
    uaRules: Object.fromEntries(sites.map(item => [item.domain, {
      enabled: false, uiTransform: false, uaMode: 'desktop', presetKey: 'chrome_windows', customUA: null,
    }])),
    // Every core scenario explicitly enables its site; defaults are not asserted.
    searchMediaSettings: Object.fromEntries(sites.map(item => [item.domain, item.domain === site.domain])),
  };
  if ('globalEnabled' in ua) store.globalEnabled = ua.globalEnabled;
  Object.assign(store.uaRules[site.domain], ua.rule || {});
  if (mediaSettings === null) delete store.searchMediaSettings;
  else if (mediaSettings !== undefined) store.searchMediaSettings = copy(mediaSettings);
  const originalUA = copy({ globalEnabled: store.globalEnabled, uaRules: store.uaRules });
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => failures.push(error));
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  const observers = new Set();
  const NativeMutationObserver = window.MutationObserver;
  // Each instance still runs jsdom's real observer implementation. The wrapper
  // only retains ownership so document deletion during teardown cannot notify it.
  window.MutationObserver = class extends NativeMutationObserver {
    constructor(callback) {
      super(callback);
      observers.add(this);
    }
  };
  const timerResources = [];
  for (const [createName, cancelName] of [
    ['setTimeout', 'clearTimeout'], ['setInterval', 'clearInterval'],
    ['requestAnimationFrame', 'cancelAnimationFrame'],
  ]) {
    const create = window[createName].bind(window);
    const cancel = window[cancelName].bind(window);
    const ids = new Set();
    timerResources.push({ ids, cancel });
    window[createName] = (...args) => {
      const id = create(...args);
      ids.add(id);
      return id;
    };
    window[cancelName] = id => { ids.delete(id); cancel(id); };
  }
  const stopHarnessResources = () => {
    for (const observer of observers) observer.disconnect();
    for (const { ids, cancel } of timerResources) {
      for (const id of ids) cancel(id);
      ids.clear();
    }
  };
  const targetSnapshots = new WeakMap();
  const cardSnapshots = new WeakMap();
  function capture(root = window.document.querySelector('[data-test-results]')) {
    if (!root) return;
    const previous = targetSnapshots.get(root) || { media: [], slots: [] };
    targetSnapshots.set(root, {
      media: [...new Set([...previous.media, ...root.querySelectorAll('[data-test-media]')])],
      slots: [...new Set([...previous.slots, ...root.querySelectorAll('[data-test-media-slot]')])],
    });
  }
  capture();
  const originalSnapshot = preserveSnapshot({ document: window.document });
  t.after(async () => {
    try {
      stopHarnessResources();
      // Keep the document alive for already-queued promises/microtasks. A host
      // event-loop turn drains them without relying on a product-specific event.
      await new Promise(resolve => setImmediate(resolve));
      if (failures.length) throw new Error('EXECUTION_ERROR: pending DOM/script errors before teardown: ' + failures.map(error => error.message).join('; '));
    } finally {
      stopHarnessResources();
      dom.window.close();
    }
  });
  window.addEventListener('error', event => failures.push(event.error || new Error(event.message)));
  window.addEventListener('unhandledrejection', event => failures.push(event.reason));
  const changed = shared?.changed || createEvent();
  const runtimeMessage = createEvent();
  function storageResult(keys) {
    if (keys == null) return copy(store);
    if (typeof keys === 'string') return keys in store ? { [keys]: copy(store[keys]) } : {};
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter(key => key in store).map(key => [key, copy(store[key])]));
    return { ...copy(keys), ...Object.fromEntries(Object.keys(keys).filter(key => key in store).map(key => [key, copy(store[key])])) };
  }
  window.chrome = {
    storage: {
      onChanged: changed,
      local: {
        get(keys, callback) {
          const result = storageResult(keys);
          if (callback) queueMicrotask(() => callback(result));
          return Promise.resolve(result);
        },
        set(values, callback) {
          writes.push(copy(values));
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: store[key], newValue: copy(value) };
            store[key] = copy(value);
          }
          changed.emit(changes, 'local');
          if (callback) queueMicrotask(callback);
          return Promise.resolve();
        },
      },
    },
    runtime: {
      id: 'search-media-test', onMessage: runtimeMessage,
      getURL: resource => 'chrome-extension://search-media-test/' + resource,
      sendMessage(message, callback) {
        if (message.type !== 'GET_STATUS') actions.push({ type: 'runtimeMessage', message: copy(message) });
        const result = message.type === 'GET_STATUS' ? { globalEnabled: store.globalEnabled, rules: copy(store.uaRules) } : {};
        if (callback) queueMicrotask(() => callback(result));
        return Promise.resolve(result);
      },
    },
    tabs: {
      reload(...args) { actions.push({ type: 'reload', args }); return Promise.resolve(); },
      update(...args) { actions.push({ type: 'tabUpdate', args }); return Promise.resolve(); },
    },
  };
  window.fetch = async input => {
    const target = String(input);
    if (target.startsWith('chrome-extension://search-media-test/')) {
      const resource = path.resolve(EXTENSION, target.split('search-media-test/')[1]);
      if (!resource.startsWith(EXTENSION + path.sep)) throw new Error('EXECUTION_ERROR: resource escapes extension');
      return { ok: true, text: async () => fs.readFileSync(resource, 'utf8'), json: async () => JSON.parse(fs.readFileSync(resource, 'utf8')) };
    }
    actions.push({ type: 'fetch', url: target });
    return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  };
  window.XMLHttpRequest.prototype.open = function(method, target) { this._testRequest = { type: 'xhr', method, url: String(target) }; };
  window.XMLHttpRequest.prototype.send = function() { actions.push(this._testRequest); };
  window.navigator.sendBeacon = target => { actions.push({ type: 'beacon', url: String(target) }); return true; };
  window.scrollTo = (...args) => actions.push({ type: 'scrollTo', args });
  window.scrollBy = (...args) => actions.push({ type: 'scrollBy', args });
  window.Element.prototype.scrollIntoView = function() { actions.push({ type: 'scrollIntoView', tag: this.tagName }); };
  window.document.querySelector('[data-test-load]')?.addEventListener('click', () => actions.push({ type: 'loadMoreClick' }));

  const mediaState = new WeakMap();
  const stateFor = element => {
    if (!mediaState.has(element)) mediaState.set(element, { paused: !element.hasAttribute('autoplay'), pauseCalls: 0, playCalls: 0 });
    return mediaState.get(element);
  };
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return stateFor(this).paused; } });
  window.HTMLMediaElement.prototype.pause = function() {
    const state = stateFor(this);
    state.pauseCalls += 1;
    const wasPlaying = !state.paused;
    state.paused = true;
    if (wasPlaying) this.dispatchEvent(new window.Event('pause'));
  };
  window.HTMLMediaElement.prototype.play = function() {
    const state = stateFor(this);
    state.playCalls += 1;
    state.paused = false;
    this.dispatchEvent(new window.Event('play'));
    this.dispatchEvent(new window.Event('playing'));
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.load = function() { stateFor(this).paused = true; };

  if (loadOptions) {
    // Unrelated navigation-settings storage uses an empty, valid IndexedDB
    // record so the real options boot can complete without altering product code.
    const request = result => {
      const pending = { result };
      window.setTimeout(() => pending.onsuccess?.({ target: pending }), 0);
      return pending;
    };
    const database = {
      objectStoreNames: { contains: () => true },
      transaction: () => ({ objectStore: () => ({
        get: () => request({ id: 'main', data: { siteUrls: {}, buttonConfig: [], siteFlags: {} } }),
        put: value => request(value.id),
      }) }),
      close() {},
    };
    window.indexedDB = { open: () => request(database) };
    for (const link of window.document.querySelectorAll('link[rel="stylesheet"][href]')) {
      const style = window.document.createElement('style');
      style.textContent = fs.readFileSync(path.resolve(EXTENSION, 'options', link.getAttribute('href')), 'utf8');
      window.document.head.appendChild(style);
    }
  }
  const contentEntries = loadOptions
    ? [{ matches: ['https://extension.test/*'], js: [...window.document.querySelectorAll('script[src]')].map(script => path.relative(EXTENSION, path.resolve(EXTENSION, 'options', script.getAttribute('src')))) }]
    : manifest.content_scripts || [];
  for (const entry of contentEntries) {
    if (!entry.matches.some(pattern => matchPattern(pattern, url))) continue;
    if ((entry.exclude_matches || []).some(pattern => matchPattern(pattern, url))) continue;
    for (const css of entry.css || []) {
      const style = window.document.createElement('style');
      style.textContent = fs.readFileSync(path.join(EXTENSION, css), 'utf8');
      window.document.head.appendChild(style);
    }
    for (const script of entry.js || []) {
      loadedScripts.push(script);
      try {
        vm.runInContext(fs.readFileSync(path.join(EXTENSION, script), 'utf8'), dom.getInternalVMContext(), { filename: script });
      } catch (error) {
        throw new Error('EXECUTION_ERROR: content script ' + script + ' failed', { cause: error });
      }
    }
  }
  async function settle(milliseconds = 360) {
    await sleep(milliseconds);
    if (failures.length) throw new Error('EXECUTION_ERROR: DOM/script errors: ' + failures.map(error => error.message).join('; '));
  }
  await settle();
  return {
    window, document: window.document, store, actions, writes, originalUA, loadedScripts, settle, stateFor,
    targetSnapshots, cardSnapshots, capture, originalSnapshot, shared: { store, changed },
    async route(target, event = 'pushState') {
      if (event === 'popstate') {
        window.history.replaceState({}, '', target);
        window.dispatchEvent(new window.PopStateEvent('popstate'));
      } else window.history[event]({}, '', target);
      await settle(650);
    },
  };
}

function visible(h, element) {
  if (!element || !element.isConnected) return false;
  for (let current = element; current?.nodeType === 1; current = current.parentElement) {
    const style = h.window.getComputedStyle(current);
    if (current.hidden || style.display === 'none' || style.opacity === '0' ||
      (current === element && (style.visibility === 'hidden' || style.visibility === 'collapse'))) return false;
  }
  return true;
}

function preserveSnapshot(h, root = h.document) {
  return {
    texts: [...root.querySelectorAll('[data-test-text]')].map(element => ({ element, text: element.textContent })),
    links: [...root.querySelectorAll('[data-test-link]')].map(element => ({ element, href: element.href, target: element.target })),
  };
}

function assertPreserved(h, snapshot) {
  for (const { element, text } of snapshot.texts) {
    assert.equal(element.textContent, text, 'BEHAVIOR_FAILURE: original text was changed');
    assert.ok(visible(h, element), 'BEHAVIOR_FAILURE: original text is hidden: ' + text);
  }
  for (const { element, href, target } of snapshot.links) {
    assert.ok(visible(h, element), 'BEHAVIOR_FAILURE: original text entry is hidden');
    assert.equal(element.href, href, 'BEHAVIOR_FAILURE: original entry target changed');
    assert.equal(element.target, target, 'BEHAVIOR_FAILURE: original new-tab behavior changed');
    assert.notEqual(h.window.getComputedStyle(element).pointerEvents, 'none', 'BEHAVIOR_FAILURE: original entry cannot receive pointer input');
  }
}

function assertMediaHidden(h, root = h.document.querySelector('[data-test-results]')) {
  const media = h.targetSnapshots.get(root)?.media || [...root.querySelectorAll('[data-test-media]')];
  assert.ok(media.length > 0, 'EXECUTION_ERROR: fixture has no target media');
  for (const element of media) assert.equal(visible(h, element), false,
    'BEHAVIOR_FAILURE: result ' + element.tagName.toLowerCase() + ' remains visible');
}

function assertSlotsReleased(h) {
  const slots = h.targetSnapshots.get(h.document.querySelector('[data-test-results]')).slots;
  assert.ok(slots.length > 0, 'EXECUTION_ERROR: fixture has no media-only slots');
  for (const slot of slots) {
    // display:none is a DOM/CSS contract only. Browser rectangle evidence remains
    // outstanding; visibility:hidden/opacity:0 alone must not pass this check.
    const style = h.window.getComputedStyle(slot);
    const removed = !slot.isConnected || style.display === 'none';
    const cleared = ['auto', '0px', ''].includes(style.height) && ['auto', '0px', ''].includes(style.minHeight) &&
      ['auto', ''].includes(style.aspectRatio) && ['0px', ''].includes(style.paddingTop) && ['0px', ''].includes(style.paddingBottom);
    assert.ok(removed || cleared, 'BEHAVIOR_FAILURE: media-only slot retains fixed height/aspect-ratio');
  }
  for (const mixed of h.document.querySelectorAll('[data-test-mixed-cover]')) {
    const style = h.window.getComputedStyle(mixed);
    assert.ok(['auto', '0px', ''].includes(style.height) && ['auto', ''].includes(style.aspectRatio),
      'BEHAVIOR_FAILURE: mixed cover retains media height/aspect-ratio around preserved statistics');
  }
}

function assertPaused(h, root = h.document.querySelector('[data-test-results]')) {
  const videos = [...root.querySelectorAll('video')];
  assert.ok(videos.length > 0, 'EXECUTION_ERROR: fixture has no preview video');
  for (const video of videos) assert.equal(video.paused, true, 'BEHAVIOR_FAILURE: result preview was not paused (observable media stub, not an audio measurement)');
}

function addCard(h, site, suffix, options) {
  const container = h.document.createElement('div');
  container.innerHTML = cardMarkup(site, suffix, options);
  const card = container.firstElementChild;
  h.cardSnapshots.set(card, preserveSnapshot(h, card));
  h.document.querySelector('[data-test-results]').appendChild(card);
  h.capture(card);
  h.capture();
  return card;
}

function addDetail(h, { dialog = false, nested = false } = {}) {
  const detail = h.document.createElement(dialog ? 'dialog' : 'main');
  if (dialog) { detail.setAttribute('open', ''); detail.setAttribute('role', 'dialog'); }
  detail.className = 'note-detail-mask video-detail-modal';
  detail.innerHTML = '<article class="note-detail"><img data-test-detail-image src="https://media.invalid/detail.jpg"><video data-test-detail-video controls src="https://media.invalid/detail.mp4"></video><h1>用户主动打开的原详情</h1></article>';
  (nested ? h.document.querySelector('[data-test-card]') : h.document.body).appendChild(detail);
  return detail;
}

for (const site of sites) {
  const scenario = (id, title, run) => test(`${TC[id]} ${id} ${site.id}: ${title}`, async t => run(t));

  scenario('S-01', '首屏图片封面不可见且原文字保留', async t => {
    // Capture pre-extension DOM, so rewritten/deleted text cannot become baseline.
    const reference = new JSDOM(pageMarkup(site), { url: site.search });
    const expectedTexts = [...reference.window.document.querySelectorAll('[data-test-text]')].map(element => element.textContent);
    reference.window.close();
    const h = await harness(t, site);
    assert.deepEqual([...h.document.querySelectorAll('[data-test-text]')].map(element => element.textContent), expectedTexts);
    assertPreserved(h, h.originalSnapshot);
    assertMediaHidden(h);
  });

  scenario('S-01', '媒体独占固定高度和比例容器释放样式约束', async t => {
    const h = await harness(t, site);
    assertSlotsReleased(h);
    assertPreserved(h, h.originalSnapshot);
  });

  scenario('S-02', '头像和混排多图全部隐藏且统计作者摘要可见', async t => {
    const h = await harness(t, site);
    const card = h.document.querySelector('[data-test-card]');
    assertPreserved(h, h.originalSnapshot);
    assertMediaHidden(h);
  });

  scenario('S-03', '原文字链接目标焦点及点击未被拦截', async t => {
    const h = await harness(t, site);
    const expected = [['title', site.detail], ['author', site.author]];
    for (const [kind, href] of expected) {
      const link = h.document.querySelector(`[data-test-link="${kind}"]`);
      assert.ok(visible(h, link));
      assert.equal(link.href, href);
      assert.equal(link.target, '_blank');
      link.focus();
      assert.equal(h.document.activeElement, link);
      const clicks = [];
      const observe = event => { clicks.push({ target: event.target.closest('a')?.href, prevented: event.defaultPrevented }); event.preventDefault(); };
      h.document.addEventListener('click', observe, { once: true });
      link.click();
      assert.deepEqual(clicks, [{ target: href, prevented: false }], 'BEHAVIOR_FAILURE: entry click was intercepted');
    }
  });

  scenario('S-04', '自动预览被暂停且重复play事件不能恢复', async t => {
    const h = await harness(t, site);
    assertPaused(h);
    const video = h.document.querySelector('[data-test-preview]');
    for (let i = 0; i < 2; i += 1) {
      video.dispatchEvent(new h.window.MouseEvent('mouseenter', { bubbles: true }));
      await video.play();
      await h.settle();
      assertPaused(h);
    }
    assertMediaHidden(h);
  });

  scenario('S-05', '新增延迟src更新替换预览与复用节点继续处理', async t => {
    const h = await harness(t, site);
    const added = addCard(h, site, '2', { media: false });
    const snapshot = h.cardSnapshots.get(added);
    await h.settle();
    const slot = added.querySelector('[data-test-media-slot]');
    slot.innerHTML = '<img data-test-media><video data-test-media data-test-preview autoplay></video>';
    h.capture(added);
    await h.settle();
    added.querySelector('img').setAttribute('src', 'https://media.invalid/late.jpg');
    await h.settle();
    assertMediaHidden(h, added);
    assertSlotsReleased(h);
    assertPaused(h, added);
    const replacement = h.document.createElement('video');
    replacement.autoplay = true;
    replacement.setAttribute('data-test-media', '');
    added.querySelector('video').replaceWith(replacement);
    h.capture(added);
    added.remove();
    h.document.querySelector('[data-test-results]').appendChild(added);
    await h.settle();
    assertMediaHidden(h, added);
    assertSlotsReleased(h);
    assertPaused(h, added);
    assertPreserved(h, snapshot);
  });

  scenario('S-06', 'pushState筛选replaceState及popstate继续覆盖结果', async t => {
    const h = await harness(t, site);
    for (const [target, event] of [[site.nextSearch, 'pushState'], [site.nextSearch + '&page=2', 'replaceState'], [site.search, 'popstate']]) {
      const results = h.document.querySelector('[data-test-results]');
      const beforeRoute = preserveSnapshot(h, results);
      await h.route(target, event);
      assertPreserved(h, beforeRoute);
      const incoming = h.document.createElement('div');
      incoming.innerHTML = cardMarkup(site, event);
      const incomingSnapshot = preserveSnapshot(h, incoming);
      results.replaceChildren(...incoming.childNodes);
      h.capture();
      await h.settle();
      assertPreserved(h, incomingSnapshot);
      assertMediaHidden(h);
      assertSlotsReleased(h);
      assertPaused(h);
    }
  });

  scenario('S-07', '纯文字和无结果提示保留且不主动加载', async t => {
    const h = await harness(t, site, { html: pageMarkup(site, { result: false }) });
    const results = h.document.querySelector('[data-test-results]');
    const textCard = addCard(h, site, 'text', { media: false });
    const snapshot = preserveSnapshot(h, textCard);
    await h.settle();
    assertPreserved(h, snapshot);
    results.innerHTML = '<p data-test-empty>没有找到相关结果</p><button data-test-empty-action>重新搜索</button>';
    await h.settle();
    assert.ok(visible(h, results.querySelector('[data-test-empty]')));
    assert.equal(results.querySelector('[data-test-empty]').textContent, '没有找到相关结果');
    assert.ok(visible(h, results.querySelector('[data-test-empty-action]')));
    assert.deepEqual(h.actions, [], 'BEHAVIOR_FAILURE: media processing actively loads more results');
  });

  scenario('S-07', '无结果之后出现媒体仍被处理', async t => {
    const h = await harness(t, site, { html: pageMarkup(site, { result: false }) });
    addCard(h, site, 'after-empty');
    await h.settle();
    assertMediaHidden(h);
    assertPaused(h);
  });

  scenario('S-08', '直接详情文档中的媒体可见并允许用户play', async t => {
    const h = await harness(t, site, { url: site.detail, html: pageMarkup(site, { result: false }) });
    const detail = addDetail(h);
    await h.settle();
    assert.ok(visible(h, detail.querySelector('img')), 'BEHAVIOR_FAILURE: detail image hidden');
    const video = detail.querySelector('video');
    await video.play();
    await h.settle();
    assert.ok(visible(h, video), 'BEHAVIOR_FAILURE: detail video hidden');
    assert.equal(video.paused, false, 'BEHAVIOR_FAILURE: user detail playback paused');
    assert.equal(video.muted, false, 'BEHAVIOR_FAILURE: detail media was muted');
  });

  scenario('S-09', '详情弹窗允许播放且动态背景结果继续屏蔽', async t => {
    const h = await harness(t, site);
    const dialog = addDetail(h, { dialog: true });
    await h.settle();
    const video = dialog.querySelector('video');
    await video.play();
    const laterImage = h.document.createElement('img');
    laterImage.src = 'https://media.invalid/detail-late.jpg';
    dialog.appendChild(laterImage);
    const backgroundCard = addCard(h, site, 'background-update');
    await h.settle();
    assert.ok(visible(h, dialog.querySelector('img')));
    assert.ok(visible(h, laterImage));
    assert.ok(visible(h, video));
    assert.equal(video.paused, false, 'BEHAVIOR_FAILURE: detail popup video paused');
    assert.equal(video.muted, false);
    assertPreserved(h, h.originalSnapshot);
    assertPreserved(h, h.cardSnapshots.get(backgroundCard));
    assertMediaHidden(h);
    assertSlotsReleased(h);
    assertPaused(h);
  });

  scenario('S-10', '关闭详情和恢复搜索后复用及新结果继续处理', async t => {
    const h = await harness(t, site);
    const dialog = addDetail(h, { dialog: true });
    const sameOriginDetail = site.sameOriginDetail || site.detail;
    if (site.id === 'xiaohongshu') await h.route(sameOriginDetail);
    await dialog.querySelector('video').play();
    await h.settle();
    dialog.remove();
    if (site.id === 'xiaohongshu') {
      // 小红书先移除详情遮罩，再异步恢复搜索 URL。两者之间不能撤销
      // 背景结果样式，否则会出现图片闪现和瀑布流全页重排。
      await h.settle(0);
      assertMediaHidden(h);
      assertSlotsReleased(h);
      assertPaused(h);
    } else {
      await h.route(sameOriginDetail);
    }
    // Keep the existing result nodes while simulating a same-document detail
    // route. Real cross-origin/new-tab navigation is a browser follow-up.
    const beforeReturn = preserveSnapshot(h, h.document.querySelector('[data-test-results]'));
    await h.route(site.search, 'popstate');
    assertPreserved(h, beforeReturn);
    h.window.dispatchEvent(new h.window.PageTransitionEvent('pageshow', { persisted: true }));
    const returnedCard = addCard(h, site, 'after-return');
    await h.document.querySelector('[data-test-preview]').play();
    await h.settle();
    assertPreserved(h, h.originalSnapshot);
    assertPreserved(h, h.cardSnapshots.get(returnedCard));
    assertMediaHidden(h);
    assertSlotsReleased(h);
    assertPaused(h);
  });

  if (site.id === 'xiaohongshu') {
    scenario('S-10', '详情遮罩先隐藏、路由延迟且瀑布流重建时持续收起', async t => {
    const h = await harness(t, site);
      const dialog = addDetail(h, { dialog: true });
      await h.route(site.detail);
      await dialog.querySelector('video').play();
      await h.settle();

      const initialRoot = h.document.querySelector('[data-test-results]');
      const assertSuppressed = (root, snapshot) => {
        assertPreserved(h, snapshot);
        assertMediaHidden(h, root);
        assertSlotsReleased(h);
        assertPaused(h, root);
      };

      // 关闭时遮罩可先进入隐藏状态，而详情 pathname 尚未恢复。
      dialog.setAttribute('aria-hidden', 'true');
      await h.settle(0);
      assert.equal(h.window.location.pathname, new URL(site.detail).pathname);
      assertSuppressed(initialRoot, h.originalSnapshot);

      // 超过旧固定350ms宽限期，搜索路由仍未恢复。
      await h.settle(500);
      assertSuppressed(initialRoot, h.originalSnapshot);

      // 站点可在恢复搜索路由之前重建整个瀑布流。
      const rebuiltRoot = h.document.createElement('div');
      rebuiltRoot.className = 'feeds-container';
      rebuiltRoot.setAttribute('data-test-results', '');
      rebuiltRoot.innerHTML = cardMarkup(site, 'detail-return-rebuilt');
      const rebuiltSnapshot = preserveSnapshot(h, rebuiltRoot);
      initialRoot.replaceWith(rebuiltRoot);
      h.capture(rebuiltRoot);
      await h.settle(0);
      assertSuppressed(rebuiltRoot, rebuiltSnapshot);

      dialog.remove();
      await h.settle(0);
      assertSuppressed(rebuiltRoot, rebuiltSnapshot);

      await h.route(site.search, 'popstate');
      assertPreserved(h, rebuiltSnapshot);
      assertSuppressed(rebuiltRoot, rebuiltSnapshot);
    });

    scenario('S-10', '详情关闭后转到另一非搜索路径会解除返回保护', async t => {
      const h = await harness(t, site);
      const dialog = addDetail(h, { dialog: true });
      await h.route(site.detail);
      dialog.setAttribute('aria-hidden', 'true');
      await h.settle(0);
      assertMediaHidden(h);
      assertSlotsReleased(h);

      dialog.remove();
      await h.route(site.outside);
      assertNativeResults(h, site);

      const preview = h.document.querySelector('[data-test-preview]');
      await preview.play();
      await h.settle();
      assert.equal(preview.paused, false,
        'BEHAVIOR_FAILURE: detail-return guard leaked into another non-search route');
      assert.equal(preview.muted, false,
        'BEHAVIOR_FAILURE: detail-return guard kept non-search preview muted');
    });
  }

  if (site.id === 'xiaohongshu') {
    scenario('S-10', '关闭前静态保护覆盖同步重建并跨越搜索首个动画帧', async t => {
      const h = await harness(t, site);
      const dialog = addDetail(h, { dialog: true });
      await h.route(site.detail);
      await h.settle();

      const oldRoot = h.document.querySelector('[data-test-results]');
      const rebuiltRoot = h.document.createElement('div');
      rebuiltRoot.className = 'feeds-container';
      rebuiltRoot.setAttribute('data-test-results', '');
      rebuiltRoot.style.display = 'block';
      rebuiltRoot.style.height = '1200px';
      rebuiltRoot.innerHTML =
        cardMarkup(site, 'return-static-1') +
        cardMarkup(site, 'return-static-2');
      [...rebuiltRoot.querySelectorAll('[data-test-card]')].forEach((card, index) => {
        card.style.position = 'absolute';
        card.style.width = '340px';
        card.style.transform =
          `translate(0px, ${index * 600}px) scale(${index === 0 ? 1.8 : 1})`;
      });

      dialog.setAttribute('aria-hidden', 'true');
      dialog.remove();
      oldRoot.replaceWith(rebuiltRoot);
      h.capture(rebuiltRoot);
      const rebuiltSnapshot = preserveSnapshot(h, rebuiltRoot);

      // 不让出当前任务：MutationObserver和逐节点内联样式尚未执行。
      assert.equal(h.window.location.href, site.detail);
      assertPreserved(h, rebuiltSnapshot);
      assertMediaHidden(h, rebuiltRoot);
      assertSlotsReleased(h);
      assert.equal(h.window.getComputedStyle(rebuiltRoot).display, 'flex',
        'BEHAVIOR_FAILURE: rebuilt waterfall was paintable in native block layout');
      assert.equal(
        h.window.getComputedStyle(
          rebuiltRoot.querySelector('[data-test-card]')
        ).transform,
        'none',
        'BEHAVIOR_FAILURE: selected rebuilt card retained its enlarged transform'
      );

      h.window.history.replaceState({}, '', site.search);
      h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
      await h.settle(0);

      // 首个rAF仍必须由静态保护覆盖；此时同步加入的新卡片不能露图。
      await new Promise(resolve => h.window.requestAnimationFrame(resolve));
      const holder = h.document.createElement('div');
      holder.innerHTML = cardMarkup(site, 'first-search-frame');
      const firstFrameCard = holder.firstElementChild;
      firstFrameCard.style.position = 'absolute';
      firstFrameCard.style.transform = 'scale(2)';
      rebuiltRoot.appendChild(firstFrameCard);
      h.capture(rebuiltRoot);

      assertMediaHidden(h, rebuiltRoot);
      assert.equal(h.window.getComputedStyle(firstFrameCard).transform, 'none',
        'BEHAVIOR_FAILURE: first search frame exposed a FLIP-style enlargement');

      await h.settle(0);
      assertPaused(h, rebuiltRoot);
      await h.settle(80);
      assertPreserved(h, rebuiltSnapshot);
      assertMediaHidden(h, rebuiltRoot);
      assertSlotsReleased(h);
      assertPaused(h, rebuiltRoot);

      // 转入明确的另一非搜索路径后，静态和逐节点保护都必须释放。
      await h.route(site.outside);
      for (const media of rebuiltRoot.querySelectorAll('[data-test-media]')) {
        assert.ok(visible(h, media),
          'BEHAVIOR_FAILURE: return guard leaked into another non-search path');
      }
      assert.equal(h.window.getComputedStyle(rebuiltRoot).display, 'block',
        'BEHAVIOR_FAILURE: return guard retained the waterfall root layout');
    });
  }

  scenario('S-11', '结果外标识及同站非搜索媒体不被处理', async t => {
    const h = await harness(t, site, { url: site.outside });
    assert.ok(visible(h, h.document.querySelector('[data-test-outside]')));
    for (const image of h.document.querySelectorAll('[data-test-media]')) assert.ok(visible(h, image), 'BEHAVIOR_FAILURE: non-search media hidden');
    const video = h.document.querySelector('video');
    await video.play();
    await h.settle();
    assert.equal(video.paused, false, 'BEHAVIOR_FAILURE: non-search playback paused');
  });

  scenario('S-11', '搜索内头像隐藏与结果外账户标识隔离', async t => {
    const h = await harness(t, site);
    assert.ok(visible(h, h.document.querySelector('[data-test-outside]')));
    assertMediaHidden(h);
  });

  scenario('S-12', '静置和DOM更新不发补结果请求或模拟加载动作', async t => {
    const h = await harness(t, site);
    const before = copy(h.actions);
    for (let index = 0; index < 2; index += 1) {
      addCard(h, site, 'repeat-' + index);
      await h.settle();
    }
    assert.deepEqual(before, [], 'BEHAVIOR_FAILURE: initialization requested extra results');
    assert.deepEqual(h.actions, [], 'BEHAVIOR_FAILURE: DOM processing requested extra results or simulated scrolling');
    h.document.querySelector('[data-test-load]').click();
    assert.deepEqual(h.actions, [{ type: 'loadMoreClick' }], 'BEHAVIOR_FAILURE: original user load action was blocked');
  });

  for (const [label, ua] of [
    ['UA总开关关闭', { globalEnabled: false, rule: { enabled: true, uiTransform: true } }],
    ['单站UA关闭', { globalEnabled: true, rule: { enabled: false, uiTransform: true } }],
    ['uiTransform关闭', { globalEnabled: true, rule: { enabled: true, uiTransform: false } }],
    ['三个UA开关均关闭', { globalEnabled: false, rule: { enabled: false, uiTransform: false } }],
  ]) {
    scenario('S-13', label + '仍隐藏暂停动态结果且不写UA或刷新', async t => {
      const h = await harness(t, site, { ua });
      addCard(h, site, 'ua-isolation');
      await h.settle();
      assert.deepEqual({ globalEnabled: h.store.globalEnabled, uaRules: h.store.uaRules }, h.originalUA,
        'BEHAVIOR_FAILURE: media processing changed UA configuration');
      assert.ok(h.writes.every(write => !('globalEnabled' in write) && !('uaRules' in write)), 'BEHAVIOR_FAILURE: media processing wrote UA keys');
      assert.deepEqual(h.actions, [], 'BEHAVIOR_FAILURE: media processing sent UA message or navigation/load action');
      assertMediaHidden(h);
      assertPaused(h);
    });
  }
}

// Settings batch: separate from the explicitly-enabled S-01...S-13 baseline.
const SETTINGS_TC = {
  'S-14': 'TC-01a07553-0f53-7e42-88d9-38633641daa4',
  'S-15': 'TC-01a07553-0f54-7e5c-96b4-dc3c654eb9a7',
  'S-16': 'TC-01a07553-0f55-784e-a133-bfb6074b8cb1',
  'S-17': 'TC-01a07553-0f56-72d5-b396-791fa04fb09a',
  'S-18': 'TC-01a07553-0f57-71e3-8825-64900a448d94',
};
const settingsSites = sites.filter(site => site.id !== 'youtube-mobile');
const siteLabels = {
  'bilibili.com': '哔哩哔哩', 'douyin.com': '抖音',
  'youtube.com': 'YouTube', 'xiaohongshu.com': '小红书',
};
const allChoices = enabled => Object.fromEntries(settingsSites.map(site => [site.domain, enabled]));
const settingsScenario = (id, title, run) => test(`${SETTINGS_TC[id]} ${id} settings: ${title}`, run);

function newSettingsStorage(mediaSettings) {
  const store = {
    globalEnabled: false,
    uaRules: Object.fromEntries(settingsSites.map(site => [site.domain, {
      enabled: false, uiTransform: false, uaMode: 'desktop', presetKey: 'chrome_windows', customUA: null,
    }])),
  };
  if (mediaSettings !== undefined) store.searchMediaSettings = copy(mediaSettings);
  return { store, changed: createEvent() };
}

function accessibleName(element) {
  if (element.hasAttribute('aria-labelledby')) return element.getAttribute('aria-labelledby').split(/\s+/)
    .map(id => element.ownerDocument.getElementById(id)?.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
  return (element.getAttribute('aria-label') || [...(element.labels || [])].map(label => label.textContent).join(' '))
    .replace(/\s+/g, ' ').trim();
}

function controlAvailable(h, control) {
  return Boolean(control && control.isConnected && !control.disabled && control.getAttribute('aria-disabled') !== 'true' &&
    (visible(h, control) || [...(control.labels || [])].some(label => visible(h, label))));
}

function mediaControls(h) {
  const heading = [...h.document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')]
    .find(element => element.textContent.trim() === '搜索结果图片与预览');
  assert.ok(heading && visible(h, heading), 'BEHAVIOR_FAILURE: options lacks the accessible 搜索结果图片与预览 settings heading');
  const region = heading.closest('section,[role="region"],fieldset') || heading.parentElement;
  const choices = [...region.querySelectorAll('input[type="checkbox"],[role="switch"],[role="checkbox"]')];
  assert.equal(choices.length, 4, 'BEHAVIOR_FAILURE: independent media region must expose four site switches');
  return Object.fromEntries(settingsSites.map(site => {
    const matches = choices.filter(control => accessibleName(control) === siteLabels[site.domain]);
    assert.equal(matches.length, 1, 'BEHAVIOR_FAILURE: missing or ambiguous accessible media switch for ' + siteLabels[site.domain]);
    assert.ok(controlAvailable(h, matches[0]), 'BEHAVIOR_FAILURE: media switch and its label are unavailable');
    return [site.domain, matches[0]];
  }));
}

const checked = control => 'checked' in control ? control.checked : control.getAttribute('aria-checked') === 'true';

async function optionsHarness(t, shared) {
  return harness(t, settingsSites[0], {
    shared, loadOptions: true, url: 'https://extension.test/options/options.html',
    html: fs.readFileSync(path.join(EXTENSION, 'options/options.html'), 'utf8'),
  });
}

async function setMediaChoice(options, domain, enabled) {
  const control = mediaControls(options)[domain];
  if (checked(control) !== enabled) control.click();
  await options.settle();
  assert.equal(checked(mediaControls(options)[domain]), enabled, 'BEHAVIOR_FAILURE: media switch did not retain the chosen state');
  assert.equal(options.store.searchMediaSettings?.[domain] !== false, enabled,
    'BEHAVIOR_FAILURE: media choice was not applied to persistent settings');
}

function assertUAUnchanged(...contexts) {
  for (const h of contexts) {
    assert.deepEqual({ globalEnabled: h.store.globalEnabled, uaRules: h.store.uaRules }, h.originalUA,
      'BEHAVIOR_FAILURE: media settings changed UA configuration');
    assert.ok(h.writes.every(write => !('uaRules' in write) && !('globalEnabled' in write)),
      'BEHAVIOR_FAILURE: media settings wrote UA keys');
    assert.deepEqual(h.actions, [], 'BEHAVIOR_FAILURE: media settings triggered UA messages, navigation or extra loading');
  }
}

function assertEnabledResults(h) {
  assertMediaHidden(h);
  assertSlotsReleased(h);
  assertPaused(h);
  assertPreserved(h, h.originalSnapshot);
  for (const card of h.document.querySelectorAll('[data-test-card]')) {
    const snapshot = h.cardSnapshots.get(card);
    if (snapshot) assertPreserved(h, snapshot);
  }
}

function assertNativeResults(h, site) {
  const reference = new JSDOM(pageMarkup(site), { url: site.search });
  try {
    const recordedMedia = h.targetSnapshots.get(h.document.querySelector('[data-test-results]'))?.media || [];
    assert.ok(recordedMedia.length > 0, 'EXECUTION_ERROR: restoration fixture has no original result media');
    for (const media of recordedMedia) assert.ok(visible(h, media),
      'BEHAVIOR_FAILURE: disabled site did not restore an original result media node');
    const selectors = ['[data-test-media-slot]', '[data-test-mixed-cover]'];
    const properties = ['display', 'width', 'height', 'minWidth', 'minHeight', 'aspectRatio', 'paddingTop', 'paddingBottom'];
    for (const card of h.document.querySelectorAll('[data-test-card]')) {
      for (const media of card.querySelectorAll('[data-test-media]')) {
        assert.ok(visible(h, media), 'BEHAVIOR_FAILURE: disabled site retains hidden result media');
      }
      for (const selector of selectors) {
        const expected = [...reference.window.document.querySelectorAll(selector)];
        const actual = [...card.querySelectorAll(selector)];
        assert.equal(actual.length, expected.length, 'BEHAVIOR_FAILURE: restoring media lost an original container');
        for (let index = 0; index < actual.length; index += 1) {
          const observedStyle = h.window.getComputedStyle(actual[index]);
          const nativeStyle = reference.window.getComputedStyle(expected[index]);
          for (const property of properties) assert.equal(observedStyle[property], nativeStyle[property],
            'BEHAVIOR_FAILURE: disabled site did not restore native ' + property + ' on ' + selector);
        }
      }
    }
    assertPreserved(h, h.originalSnapshot);
    for (const card of h.document.querySelectorAll('[data-test-card]')) {
      const snapshot = h.cardSnapshots.get(card);
      if (snapshot) assertPreserved(h, snapshot);
    }
  } finally { reference.window.close(); }
}

for (const site of settingsSites) {
  settingsScenario('S-14', site.id + ' 无媒体存储时无需打开设置即默认隐藏收起暂停', async t => {
    const h = await harness(t, site, { mediaSettings: null });
    assertEnabledResults(h);
    assertUAUnchanged(h);
  });
}

settingsScenario('S-14', '真实options独立区域显示四站默认开启', async t => {
  const options = await optionsHarness(t, newSettingsStorage());
  for (const control of Object.values(mediaControls(options))) assert.equal(checked(control), true,
    'BEHAVIOR_FAILURE: fresh options media choice is not enabled by default');
  assertUAUnchanged(options);
});

for (const target of settingsSites) {
  settingsScenario('S-15', target.id + ' 关闭即时恢复两个标签及后续结果且其他三站不变', async t => {
    const shared = newSettingsStorage(allChoices(true));
    const options = await optionsHarness(t, shared);
    mediaControls(options);
    const contexts = [];
    for (const site of settingsSites) contexts.push({ site, h: await harness(t, site, { shared }) });
    const second = await harness(t, target, { shared, url: target.nextSearch });
    const primary = contexts.find(item => item.site.domain === target.domain).h;
    for (const { h } of contexts) assertEnabledResults(h);
    assertEnabledResults(second);
    // A concurrent page-owned style change must survive removal of this module's
    // hiding styles; restoring a whole stale cssText would lose this value.
    const sentinel = primary.document.querySelector('[data-test-media-slot]');
    sentinel.style.borderColor = 'rgb(1, 2, 3)';
    const choicesBefore = copy(shared.store.searchMediaSettings);
    await setMediaChoice(options, target.domain, false);
    for (const { h } of contexts) await h.settle();
    await second.settle();
    assertNativeResults(primary, target);
    assertNativeResults(second, target);
    assert.equal(sentinel.style.borderColor, 'rgb(1, 2, 3)', 'BEHAVIOR_FAILURE: restoring media overwrote a page-owned style change');
    addCard(primary, target, 'while-disabled');
    await primary.settle();
    assertNativeResults(primary, target);
    const preview = primary.document.querySelector('[data-test-preview]');
    await preview.play();
    await primary.settle();
    assert.equal(preview.paused, false, 'BEHAVIOR_FAILURE: disabled site still blocks native preview triggers');
    for (const { site, h } of contexts) if (site.domain !== target.domain) {
      assertEnabledResults(h);
      assert.equal(shared.store.searchMediaSettings[site.domain], choicesBefore[site.domain],
        'BEHAVIOR_FAILURE: switching one site changed another site preference');
      assert.equal(checked(mediaControls(options)[site.domain]), true);
    }
    assertUAUnchanged(options, second, ...contexts.map(item => item.h));
  });

  settingsScenario('S-16', target.id + ' 重新开启覆盖已有延迟和新搜索结果且重复切换可恢复', async t => {
    const choices = { ...allChoices(true), [target.domain]: false };
    const shared = newSettingsStorage(choices);
    const options = await optionsHarness(t, shared);
    assert.equal(checked(mediaControls(options)[target.domain]), false);
    const h = await harness(t, target, { shared });
    addCard(h, target, 'created-while-disabled');
    await h.settle();
    assertNativeResults(h, target);
    await setMediaChoice(options, target.domain, true);
    await h.settle();
    assertEnabledResults(h);
    const delayed = addCard(h, target, 'late', { media: false });
    const slot = delayed.querySelector('[data-test-media-slot]');
    slot.innerHTML = '<img data-test-media src="https://media.invalid/late-settings.jpg"><video data-test-media autoplay></video>';
    h.capture(delayed);
    h.capture();
    await h.settle();
    assertEnabledResults(h);
    await h.route(target.nextSearch);
    addCard(h, target, 'after-query-change');
    await h.settle();
    assertEnabledResults(h);
    await setMediaChoice(options, target.domain, false);
    await h.settle();
    assertNativeResults(h, target);
    await setMediaChoice(options, target.domain, true);
    await h.settle();
    assertEnabledResults(h);
    for (const site of settingsSites) if (site.domain !== target.domain) {
      assert.equal(shared.store.searchMediaSettings[site.domain], choices[site.domain]);
    }
    assertUAUnchanged(options, h);
  });
}

settingsScenario('S-17', '两个开启两个关闭逐站保存并在重建设置与四站上下文后保持', async t => {
  const shared = newSettingsStorage();
  const options = await optionsHarness(t, shared);
  mediaControls(options);
  const choices = {
    'bilibili.com': false, 'douyin.com': true, 'youtube.com': false, 'xiaohongshu.com': true,
  };
  // Exercise successive writes to different sites, including off -> on, so a
  // stale snapshot/last-writer update cannot discard previous choices.
  for (const [domain, enabled] of [
    ['bilibili.com', false], ['douyin.com', false], ['youtube.com', false], ['douyin.com', true],
  ]) await setMediaChoice(options, domain, enabled);
  assertUAUnchanged(options);
  const saved = copy(shared.store);
  options.window.close();
  // This simulates persistence by rebuilding storage and JS/DOM contexts. It is
  // not a real browser process restart or proof of chrome.storage durability.
  const reopenedStorage = { store: copy(saved), changed: createEvent() };
  const reopened = await optionsHarness(t, reopenedStorage);
  const controls = mediaControls(reopened);
  const pages = [];
  for (const site of settingsSites) {
    assert.equal(checked(controls[site.domain]), choices[site.domain], 'BEHAVIOR_FAILURE: reopened options lost site selection');
    const h = await harness(t, site, { shared: reopenedStorage });
    pages.push(h);
    choices[site.domain] ? assertEnabledResults(h) : assertNativeResults(h, site);
  }
  assert.deepEqual({ globalEnabled: reopenedStorage.store.globalEnabled, uaRules: reopenedStorage.store.uaRules }, options.originalUA);
  assertUAUnchanged(reopened, ...pages);
});

for (const detailMode of ['page', 'dialog']) {
  settingsScenario('S-18', detailMode + ' 媒体切换不刷新详情不额外暂停且原UA操作保持', async t => {
    const target = settingsSites.find(site => site.id === 'douyin');
    const shared = newSettingsStorage(allChoices(true));
    const options = await optionsHarness(t, shared);
    mediaControls(options);
    const search = await harness(t, target, { shared });
    const detailContext = detailMode === 'dialog' ? search : await harness(t, target, {
      shared, url: target.detail, html: pageMarkup(target, { result: false }),
    });
    const detail = addDetail(detailContext, { dialog: detailMode === 'dialog' });
    const video = detail.querySelector('video');
    video.currentTime = 27.5;
    await video.play();
    await detailContext.settle();
    const playback = { pauseCalls: detailContext.stateFor(video).pauseCalls, currentTime: video.currentTime, href: detailContext.window.location.href };
    for (const [domain, enabled, expectedTargetEnabled] of [
      [target.domain, false, false], [target.domain, true, true], ['bilibili.com', false, true],
    ]) {
      await setMediaChoice(options, domain, enabled);
      await search.settle();
      if (detailContext !== search) await detailContext.settle();
      assert.ok(detail.isConnected && visible(detailContext, detail), 'BEHAVIOR_FAILURE: settings closed or hid active detail');
      assert.ok(visible(detailContext, detail.querySelector('img')));
      assert.ok(visible(detailContext, video));
      assert.equal(video.paused, false, 'BEHAVIOR_FAILURE: settings interrupted detail playback');
      assert.equal(video.muted, false, 'BEHAVIOR_FAILURE: settings muted detail playback');
      assert.equal(detailContext.stateFor(video).pauseCalls, playback.pauseCalls, 'BEHAVIOR_FAILURE: settings caused extra detail pause calls');
      assert.equal(video.currentTime, playback.currentTime, 'BEHAVIOR_FAILURE: settings reset detail playback position');
      assert.equal(detailContext.window.location.href, playback.href, 'BEHAVIOR_FAILURE: settings navigated active detail');
      assert.equal(shared.store.searchMediaSettings[target.domain] !== false, expectedTargetEnabled,
        'BEHAVIOR_FAILURE: a settings operation unexpectedly changed the active detail site preference');
      expectedTargetEnabled ? assertEnabledResults(search) : assertNativeResults(search, target);
    }
    assertUAUnchanged(options, search, detailContext);
    // Check the existing UA control against a fresh real options page using the
    // same configuration. This compares observable messages, not an invented API.
    const baseline = await optionsHarness(t, newSettingsStorage(allChoices(true)));
    const exerciseUaToggle = async h => {
      const originalControl = h.document.getElementById('opt-global-toggle');
      assert.ok(controlAvailable(h, originalControl), 'BEHAVIOR_FAILURE: original UA global control unavailable');
      const start = h.actions.length;
      originalControl.click();
      await h.settle();
      originalControl.click();
      await h.settle();
      return copy(h.actions.slice(start));
    };
    const expectedUaActions = await exerciseUaToggle(baseline);
    assert.ok(expectedUaActions.length > 0, 'EXECUTION_ERROR: UA control baseline produced no observable action');
    assert.deepEqual(await exerciseUaToggle(options), expectedUaActions, 'BEHAVIOR_FAILURE: media settings changed original UA control behavior');
  });
}
