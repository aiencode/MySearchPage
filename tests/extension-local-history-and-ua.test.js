'use strict';

/*
 * 用户需求 → TC-RUNTIME → 可执行断言映射
 * 1. IndexedDB 初始化或写入失败时，导航历史新增、编辑、删除、导入、撤销仍跨重开保存
 *    → TC-RUNTIME-001 → VM fake 的每项操作分别触发 init 拒绝和 write(operation, history)
 *      拒绝，再以同一 localStorage 新建 store 验证状态。
 * 2. 关闭全局、单站 enabled 或单站 uiTransform 后，B站/抖音不得重排或插入手机样式
 *    → TC-RUNTIME-002 → 真实 ui-transformer.js 与站点脚本在 fake DOM/chrome 中执行，
 *      对每站三种关闭状态断言 init/style/link 均为零；manifest 无静态 CSS。
 * 3. 关闭全局、B站 enabled 或 B站 uiTransform 后，只有受影响已开页刷新
 *    → TC-RUNTIME-003 → fake chrome 断言 storage.set 在匹配标签 reload 之前。
 * 4. UA 设置和已迁移的网站设置使用紧凑扁平表格
 *    → TC-RUNTIME-004 → options 中两张表的桌面、768px、480px规则，以及网站右键二态控件契约。
 * 5. 多个导航页基于各自旧快照新增历史时，不得互相覆盖
 *    → TC-RUNTIME-005 → 两个 store 共享同一 localStorage/IndexedDB adapter，先各自 load，
 *      再依次 add 不同关键词，断言两个持久化落点最终均保留两条历史。
 * 6. 运行时 UA 开关不得被扩展清单中的静态 UA 规则绕过
 *    → TC-RUNTIME-006 → 解析 manifest 启用的静态规则资源，断言其中没有修改 User-Agent 的规则。
 * 7. 快速搜索激活网站按钮时，也必须立即记录并显示主搜索词
 *    → TC-RUNTIME-007A → 直接执行真实 search、addToHistory、renderHistory 与
 *      SearchHistoryPersistence，证明统一入口会更新 #history-list 和 localStorage。
 *    → TC-RUNTIME-007B → 执行真实 activateCurrentMatch 并委托上述真实链路，断言统一入口
 *      只调用一次、两处历史出现同一关键词且只打开一次目标网址。
 *    → TC-RUNTIME-007C → 用可控锁延后真实 SearchHistoryPersistence 回调；若回调 pending 时
 *      window.open 会使其失效。断言真实 search 先开一次网址，再启动并完成历史持久化与渲染。
 * 8. 桌面 UA 下的 B站/抖音移动布局样式必须能被对应站点读取
 *    → TC-RUNTIME-008 → 按 Chrome match pattern 严格解析真实 web_accessible_resources，
 *      再以后台真实 desktop 默认配置执行站点脚本和 UITransformer 的 getURL/fetch/style 链路，
 *      断言请求正确 CSS 并插入 style[data-ua-controller="mobile-style"]。
 * 9. UA 模式变化必须即时应用并刷新匹配页面
 *    → TC-RUNTIME-009 → 向真实后台处理器发送 UPDATE_RULE，验证持久化与精确刷新。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const HISTORY_HELPER = 'extension/navigation/history-persistence.js';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractFunction(source, signature, { last = false } = {}) {
  const start = last ? source.lastIndexOf(signature) : source.indexOf(signature);
  assert.notEqual(start, -1, 'expected source to define ' + signature);
  const open = source.indexOf('{', start + signature.length);
  assert.notEqual(open, -1, 'expected ' + signature + ' to have a function body');
  return source.slice(start, findClosingBrace(source, open) + 1);
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeMemoryStorage(initialHistory = []) {
  const values = new Map([['searchHistory', JSON.stringify(initialHistory)]]);
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function makeHistoryAdapter(localStorage, { failInit = false, failWrite = false } = {}) {
  const calls = [];
  return {
    calls,
    async init() {
      calls.push({ type: 'init' });
      if (failInit) throw new Error('fake IndexedDB initialization failure');
    },
    async read() {
      calls.push({ type: 'read' });
      return JSON.parse(localStorage.getItem('searchHistory') || '[]');
    },
    async write(operation, history) {
      calls.push({ type: 'write', operation, history: clone(history) });
      if (failWrite) throw new Error('fake IndexedDB write failure for ' + operation);
    },
  };
}

function makeSharedHistoryAdapter(initialHistory = []) {
  let persistedHistory = clone(initialHistory);
  return {
    async init() {},
    async read() { return clone(persistedHistory); },
    async write(_operation, history) { persistedHistory = clone(history); },
    snapshot() { return clone(persistedHistory); },
  };
}

function loadHistoryStore(indexedDB, localStorage, locks) {
  assert.ok(exists(HISTORY_HELPER),
    'navigation must provide the testable history persistence helper at ' + HISTORY_HELPER);
  const sandbox = { module: { exports: {} }, exports: {}, console: { error() {}, log() {}, warn() {} }, Date, JSON, Promise };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read(HISTORY_HELPER), sandbox, { filename: HISTORY_HELPER });
  const api = sandbox.SearchHistoryPersistence || sandbox.module.exports;
  assert.equal(typeof api?.create, 'function',
    'history helper must expose SearchHistoryPersistence.create({ indexedDB, localStorage })');
  return Promise.resolve(api.create({ indexedDB, localStorage, locks }));
}

async function rebuildKeywords(localStorage) {
  const rebuilt = await loadHistoryStore(makeHistoryAdapter(localStorage, { failInit: true }), localStorage);
  await rebuilt.load();
  return (await rebuilt.getAll()).map((item) => item.keyword).sort();
}

const HISTORY_OPERATIONS = [
  { name: 'add', seed: [], args: ['新增'], expected: ['新增'] },
  { name: 'rename', seed: [{ keyword: '旧值' }], args: ['旧值', '编辑后'], expected: ['编辑后'] },
  { name: 'remove', seed: [{ keyword: '删除项' }, { keyword: '保留项' }], args: ['删除项'], expected: ['保留项'] },
  { name: 'import', seed: [], args: [[{ keyword: '导入项' }]], expected: ['导入项'] },
  { name: 'restore', seed: [], args: [{ keyword: '撤销项' }], expected: ['撤销项'] },
];

async function runHistoryOperation(spec, failureMode) {
  const localStorage = makeMemoryStorage(spec.seed);
  const adapter = makeHistoryAdapter(localStorage, {
    failInit: failureMode === 'init',
    failWrite: failureMode === 'write',
  });
  const store = await loadHistoryStore(adapter, localStorage);
  for (const method of ['load', 'add', 'rename', 'remove', 'import', 'restore', 'getAll']) {
    assert.equal(typeof store?.[method], 'function', 'history store must expose ' + method + '()');
  }
  await store.load();
  await store[spec.name](...spec.args);
  if (failureMode === 'init') {
    assert.ok(adapter.calls.some((call) => call.type === 'init'), spec.name + ' must exercise IndexedDB initialization failure');
  } else {
    assert.ok(adapter.calls.some((call) => call.type === 'write' && call.operation === spec.name),
      spec.name + ' must make its own IndexedDB write(operation, history) call before the forced rejection');
  }
  assert.deepEqual(await rebuildKeywords(localStorage), [...spec.expected].sort(),
    spec.name + ' must persist to localStorage after IndexedDB ' + failureMode + ' failure');
}

function contentScript(manifest, domain) {
  return contentScriptsForUrl(manifest, 'https://www.' + domain + '/');
}

function contentScriptsForUrl(manifest, pageUrl) {
  const entries = manifest.content_scripts.filter((item) =>
    item.matches.some((pattern) => matchPatternMatchesUrl(pattern, pageUrl)) &&
    !(item.exclude_matches || []).some((pattern) => matchPatternMatchesUrl(pattern, pageUrl)));
  assert.ok(entries.length, 'manifest content_scripts must strictly match ' + pageUrl);
  // Chrome executes every matching entry in manifest order. A shared entry must
  // not replace the later site-specific scripts in this integration harness.
  return {
    js: entries.flatMap((entry) => entry.js || []),
    css: entries.flatMap((entry) => entry.css || []),
  };
}

function wildcardMatches(pattern, value) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + '$').test(value);
}

function matchPatternMatchesUrl(pattern, pageUrl) {
  if (pattern === '<all_urls>') return /^(https?|file|ftp):/.test(pageUrl);
  const match = /^(\*|http|https):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!match) return false;
  const url = new URL(pageUrl);
  const [, schemePattern, hostPattern, pathPattern] = match;
  const schemeMatches = schemePattern === '*'
    ? url.protocol === 'http:' || url.protocol === 'https:'
    : url.protocol === schemePattern + ':';
  let hostMatches = false;
  if (hostPattern === '*') {
    hostMatches = true;
  } else if (hostPattern.startsWith('*.')) {
    const baseHost = hostPattern.slice(2).toLowerCase();
    const actualHost = url.hostname.toLowerCase();
    hostMatches = actualHost === baseHost || actualHost.endsWith('.' + baseHost);
  } else {
    hostMatches = url.hostname.toLowerCase() === hostPattern.toLowerCase();
  }
  return schemeMatches && hostMatches && wildcardMatches(pathPattern, url.pathname + url.search);
}

function manifestAllowsResource(manifest, asset, pageUrl) {
  return (manifest.web_accessible_resources || []).some((entry) =>
    Array.isArray(entry.resources) && entry.resources.some((pattern) => wildcardMatches(pattern, asset)) &&
    Array.isArray(entry.matches) && entry.matches.some((pattern) => matchPatternMatchesUrl(pattern, pageUrl)));
}

function makeFakeDocument() {
  const headChildren = [];
  const createElement = (tagName) => ({
    tagName: String(tagName).toLowerCase(),
    style: { setProperty() {} },
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    appendChild() {},
  });
  return {
    headChildren,
    document: {
      readyState: 'complete',
      head: { appendChild(node) { headChildren.push(node); return node; } },
      body: {},
      documentElement: {},
      addEventListener() {},
      querySelector(selector) {
        if (selector === 'style[data-ua-controller="mobile-style"]') {
          return headChildren.find((node) =>
            node.tagName === 'style' && node.getAttribute('data-ua-controller') === 'mobile-style') || null;
        }
        return null;
      },
      querySelectorAll() { return []; },
      createElement,
    },
  };
}

function makeContentBrowserEnvironment(pageUrl, initialStorage) {
  const location = new URL(pageUrl);
  const stored = clone(initialStorage);
  const storageListeners = new Set();
  const timers = new Map();
  const trackTimer = (create, cancel) => (...args) => {
    const timer = create(...args);
    timers.set(timer, cancel);
    return timer;
  };
  const cancelTimer = (cancel) => (timer) => { timers.delete(timer); cancel(timer); };
  const storage = {
    onChanged: {
      addListener(listener) { storageListeners.add(listener); },
      removeListener(listener) { storageListeners.delete(listener); },
    },
    local: {
      get(keys, callback) {
        let result;
        if (keys == null) result = clone(stored);
        else {
          const defaults = typeof keys === 'object' && !Array.isArray(keys) ? clone(keys) : {};
          const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
          result = { ...defaults, ...Object.fromEntries(names.filter((key) => key in stored).map((key) => [key, clone(stored[key])])) };
        }
        if (callback) queueMicrotask(() => callback(result));
        return Promise.resolve(result);
      },
      set(values, callback) {
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          changes[key] = { oldValue: key in stored ? clone(stored[key]) : undefined, newValue: clone(value) };
          stored[key] = clone(value);
        }
        for (const listener of storageListeners) listener(changes, 'local');
        if (callback) queueMicrotask(callback);
        return Promise.resolve();
      },
    },
  };
  return {
    storage,
    globals: {
      location,
      window: { addEventListener() {}, location },
      URL,
      queueMicrotask,
      setTimeout: trackTimer(setTimeout, clearTimeout),
      clearTimeout: cancelTimer(clearTimeout),
      setInterval: trackTimer(setInterval, clearInterval),
      clearInterval: cancelTimer(clearInterval),
    },
    dispose() {
      for (const [timer, cancel] of timers) cancel(timer);
      timers.clear();
      storageListeners.clear();
    },
  };
}

async function runEnabledContentScript(manifest, pageUrl, status) {
  const entry = contentScriptsForUrl(manifest, pageUrl);
  const requestedAssets = [];
  const { document } = makeFakeDocument();
  const browser = makeContentBrowserEnvironment(pageUrl, {
    globalEnabled: status.globalEnabled, uaRules: status.rules,
  });
  class FakeMutationObserver {
    observe() {}
    disconnect() {}
  }
  const sandbox = {
    console: { error() {}, log() {}, warn() {} },
    chrome: {
      runtime: {
        async sendMessage() { return clone(status); },
        getURL(asset) { return 'chrome-extension://test-extension/' + asset; },
      },
      storage: browser.storage,
    },
    document,
    ...browser.globals,
    history: { pushState() {}, replaceState() {} },
    MutationObserver: FakeMutationObserver,
    async fetch(stylesheetUrl) {
      const asset = new URL(stylesheetUrl).pathname.replace(/^\//, '');
      requestedAssets.push(asset);
      if (!manifestAllowsResource(manifest, asset, pageUrl)) throw new TypeError('Failed to fetch');
      return { text: async () => read(path.posix.join('extension', asset)) };
    },
    Promise,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    for (const script of entry.js) {
      vm.runInContext(read(path.posix.join('extension', script)), sandbox, { filename: script });
    }
    await settle();
    await settle();
    await settle();
    await settle();
    const mobileStyle = document.querySelector('style[data-ua-controller="mobile-style"]');
    return {
      requestedAssets,
      mobileStyleInserted: Boolean(mobileStyle),
      mobileStyleText: mobileStyle?.textContent || '',
    };
  } finally { browser.dispose(); }
}

async function runDisabledContentScript(domain, status) {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const entry = contentScript(manifest, domain);
  const rule = { enabled: status.enabled, uiTransform: status.uiTransform };
  const effectiveEnabled = Boolean(status.globalEnabled && status.enabled && status.uiTransform);
  const response = {
    globalEnabled: status.globalEnabled,
    rule,
    rules: { [domain]: rule },
    enabled: effectiveEnabled,
    shouldTransform: effectiveEnabled,
    transformEnabled: effectiveEnabled,
    uiTransformEnabled: effectiveEnabled,
  };
  const reply = (callback) => {
    const value = clone(response);
    if (callback) callback(value);
    return Promise.resolve(value);
  };
  const { document, headChildren } = makeFakeDocument();
  const browser = makeContentBrowserEnvironment('https://www.' + domain + '/', {
    globalEnabled: response.globalEnabled, uaRules: response.rules,
  });
  class FakeMutationObserver {
    constructor() {}
    observe() {}
    disconnect() {}
  }
  const sandbox = {
    console: { error() {}, log() {}, warn() {} },
    chrome: {
      runtime: { sendMessage(_message, callback) { return reply(callback); }, getURL(value) { return value; } },
      storage: browser.storage,
    },
    document,
    ...browser.globals,
    history: { pushState() {}, replaceState() {} },
    MutationObserver: FakeMutationObserver,
    fetch: async () => ({ text: async () => '/* fake mobile CSS */' }),
    Promise,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  let initializations = 0;
  try {
    for (const script of entry.js) {
      vm.runInContext(read(path.posix.join('extension', script)), sandbox, { filename: script });
      if (script === 'content/ui-transformer.js') {
        const transformer = vm.runInContext('UITransformer', sandbox);
        const actualInit = transformer.init.bind(transformer);
        transformer.init = (...args) => {
          initializations += 1;
          return actualInit(...args);
        };
      }
    }
    await settle();
    await settle();
    await settle();
    const mobileAssets = headChildren.filter((node) => node.tagName === 'style' || node.tagName === 'link');
    return { initializations, mobileAssets };
  } finally { browser.dispose(); }
}

function makeBackgroundHarness({ rules, globalEnabled, tabs }) {
  const stored = { globalEnabled };
  if (rules !== undefined) stored.uaRules = clone(rules);
  const events = [];
  let dynamicRules = [];
  let messageListener;
  const chrome = {
    declarativeNetRequest: {
      async getDynamicRules() { return clone(dynamicRules); },
      async updateDynamicRules(change) {
        const removed = new Set(change.removeRuleIds || []);
        dynamicRules = dynamicRules.filter((rule) => !removed.has(rule.id)).concat(clone(change.addRules || []));
        events.push({ type: 'dnr.update', change: clone(change) });
      },
    },
    runtime: { onMessage: { addListener(listener) { messageListener = listener; } } },
    storage: {
      local: {
        async get(keys) { return typeof keys === 'string' ? { [keys]: stored[keys] } : clone(stored); },
        async set(patch) { Object.assign(stored, clone(patch)); events.push({ type: 'storage.set', patch: clone(patch) }); },
      },
      onChanged: { addListener() {} },
    },
    tabs: {
      async query() { return clone(tabs); },
      async reload(tabId) { events.push({ type: 'tabs.reload', tabId }); },
    },
  };
  const sandbox = { chrome, console: { error() {}, log() {}, warn() {} }, Promise, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('extension/background/ua-controller.js'), sandbox, { filename: 'extension/background/ua-controller.js' });
  return {
    stored,
    events,
    get dynamicRules() { return clone(dynamicRules); },
    async ready() { await settle(); await settle(); events.length = 0; },
    send(message) {
      assert.equal(typeof messageListener, 'function', 'background must register a runtime message listener');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('background message did not respond')), 500);
        messageListener(message, {}, (response) => { clearTimeout(timer); resolve(response); });
      });
    },
  };
}

function dnrRuleMatchesUrl(rule, pageUrl) {
  const condition = rule.condition || {};
  const url = new URL(pageUrl);
  if (Array.isArray(condition.requestDomains)) {
    const host = url.hostname.toLowerCase();
    if (!condition.requestDomains.some((domain) => host === domain || host.endsWith('.' + domain))) return false;
  }
  if (condition.regexFilter && !(new RegExp(condition.regexFilter).test(pageUrl))) return false;
  if (condition.urlFilter) {
    const domainAnchor = /^\|\|([^/^]+)\^$/.exec(condition.urlFilter);
    if (domainAnchor) {
      const domain = domainAnchor[1].toLowerCase();
      const host = url.hostname.toLowerCase();
      if (host !== domain && !host.endsWith('.' + domain)) return false;
    } else {
      const escaped = condition.urlFilter
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*');
      if (!(new RegExp('^' + escaped + '$', 'i').test(pageUrl))) return false;
    }
  }
  return true;
}

function ruleChangesUserAgent(rule) {
  return rule.action?.type === 'modifyHeaders' && rule.action.requestHeaders?.some((header) =>
    String(header.header).toLowerCase() === 'user-agent' && header.operation === 'set');
}

function defaultRules() {
  return {
    'bilibili.com': { enabled: true, uaMode: 'desktop', presetKey: 'chrome_windows', uiTransform: true },
    'douyin.com': { enabled: true, uaMode: 'desktop', presetKey: 'chrome_windows', uiTransform: true },
  };
}

function closingRun(message) {
  const tabs = [
    { id: 1, url: 'https://www.bilibili.com/video/BV1' },
    { id: 2, url: 'https://www.douyin.com/video/1' },
    { id: 3, url: 'https://www.example.com/' },
  ];
  return makeBackgroundHarness({ rules: defaultRules(), globalEnabled: true, tabs, message });
}

function findClosingBrace(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}' && --depth === 0) return index;
  }
  throw new Error('unclosed CSS block');
}

function mediaBlock(css, width) {
  const match = new RegExp('@media\\s*(?:screen\\s+and\\s*)?\\([^)]*max-width\\s*:\\s*' + width + 'px[^)]*\\)\\s*\\{', 'i').exec(css);
  assert.ok(match, 'options CSS must define an explicit max-width:' + width + 'px media block');
  const open = css.indexOf('{', match.index + match[0].length - 1);
  return css.slice(open + 1, findClosingBrace(css, open));
}

function assertCompactTable(css, expected, label, tableId = 'rules-table') {
  const selector = '(?:#' + tableId + '|\\.' + tableId + ')';
  const tableCell = new RegExp(selector + '[^{]*(?:th|td)[^{]*\\{[^}]*padding\\s*:\\s*1px', 'i');
  assert.ok(tableCell.test(css), label + ' must use 1px compact table-cell padding');
  assert.ok(new RegExp(selector + '\\s+tr\\s*\\{[^}]*height\\s*:\\s*' + expected.height + 'px', 'i').test(css),
    label + ' must use ' + expected.height + 'px table rows');
  if (expected.fontSize) {
    assert.ok(new RegExp(selector + '[^{]*(?:th|td)[^{]*\\{[^}]*font-size\\s*:\\s*' + expected.fontSize + 'px', 'i').test(css),
      label + ' must use ' + expected.fontSize + 'px table-cell text');
  }
}

test('TC-RUNTIME-001: every history mutation persists after forced IndexedDB initialization and write failures', async () => {
  for (const spec of HISTORY_OPERATIONS) {
    await runHistoryOperation(spec, 'init');
    await runHistoryOperation(spec, 'write');
  }
  assert.ok(read('extension/navigation/navigation.html').includes('history-persistence.js'), 'navigation entry must load the tested history helper');
  assert.ok(read('extension/navigation/navigation.js').includes('SearchHistoryPersistence'), 'navigation lifecycle must use the tested history helper');
});

test('TC-RUNTIME-002: disabled Bilibili and Douyin transforms run no engine and insert no mobile style/link', async () => {
  const scenarios = [
    { globalEnabled: false, enabled: true, uiTransform: true },
    { globalEnabled: true, enabled: false, uiTransform: true },
    { globalEnabled: true, enabled: true, uiTransform: false },
  ];
  const outcomes = [];
  for (const domain of ['bilibili.com', 'douyin.com']) {
    for (const scenario of scenarios) outcomes.push(await runDisabledContentScript(domain, scenario));
  }
  assert.deepEqual(outcomes.map((outcome) => outcome.initializations), [0, 0, 0, 0, 0, 0],
    'each disabled state must prevent the actual UITransformer.init() call');
  assert.deepEqual(outcomes.map((outcome) => outcome.mobileAssets.length), [0, 0, 0, 0, 0, 0],
    'each disabled state must prevent dynamic mobile style/link insertion');
  const manifest = JSON.parse(read('extension/manifest.json'));
  for (const domain of ['bilibili.com', 'douyin.com']) {
    assert.deepEqual(contentScript(manifest, domain).css || [], [], domain + ' must not declaratively inject mobile CSS');
  }
});

test('TC-RUNTIME-003: global and per-site closures persist before only matching reloads', async () => {
  const messages = [
    { message: { type: 'TOGGLE_GLOBAL', enabled: false }, expected: [1, 2], storageValue: (patch) => patch.globalEnabled === false },
    { message: { type: 'UPDATE_RULE', domain: 'bilibili.com', rule: { enabled: false } }, expected: [1], storageValue: (patch) => patch.uaRules?.['bilibili.com']?.enabled === false },
    { message: { type: 'UPDATE_RULE', domain: 'bilibili.com', rule: { uiTransform: false } }, expected: [1], storageValue: (patch) => patch.uaRules?.['bilibili.com']?.uiTransform === false },
    { message: { type: 'UPDATE_RULE', domain: 'douyin.com', rule: { enabled: false } }, expected: [2], storageValue: (patch) => patch.uaRules?.['douyin.com']?.enabled === false },
    { message: { type: 'UPDATE_RULE', domain: 'douyin.com', rule: { uiTransform: false } }, expected: [2], storageValue: (patch) => patch.uaRules?.['douyin.com']?.uiTransform === false },
  ];
  const actual = [];
  for (const item of messages) {
    const harness = closingRun(item.message);
    await harness.ready();
    await harness.send(item.message);
    const reloaded = harness.events.filter((event) => event.type === 'tabs.reload').map((event) => event.tabId);
    const stored = harness.events.find((event) => event.type === 'storage.set');
    const persisted = harness.events.indexOf(stored);
    const firstReload = harness.events.findIndex((event) => event.type === 'tabs.reload');
    actual.push({
      reloaded,
      persistedBeforeReload: persisted >= 0 && firstReload > persisted,
      persistedClosingValue: Boolean(stored && item.storageValue(stored.patch)),
    });
  }
  assert.deepEqual(actual, [
    { reloaded: [1, 2], persistedBeforeReload: true, persistedClosingValue: true },
    { reloaded: [1], persistedBeforeReload: true, persistedClosingValue: true },
    { reloaded: [1], persistedBeforeReload: true, persistedClosingValue: true },
    { reloaded: [2], persistedBeforeReload: true, persistedClosingValue: true },
    { reloaded: [2], persistedBeforeReload: true, persistedClosingValue: true },
  ], 'each closure must persist first and reload only matching Bilibili/Douyin tabs');
});

test('TC-RUNTIME-004: options UA and site tables are compact and site settings retain the right-click control', () => {
  const optionsHtml = read('extension/options/options.html');
  const optionsCss = read('extension/options/options.css');
  const optionsJs = read('extension/options/options.js');
  const desktopCss = optionsCss.slice(0, optionsCss.search(/@media/i) === -1 ? optionsCss.length : optionsCss.search(/@media/i));
  assert.ok(/<table\b[^>]*\bid=["']rules-table["']/i.test(optionsHtml), 'UA settings must remain a table');
  assert.ok(/(?:#rules-table|\.rules-table)\s*\{[^}]*table-layout\s*:\s*fixed/i.test(desktopCss), 'desktop UA table must use fixed flat-grid layout');
  assertCompactTable(desktopCss, { height: 24 }, 'desktop UA table');
  assertCompactTable(mediaBlock(optionsCss, 768), { height: 18, fontSize: 10 }, '768px UA table');
  assertCompactTable(mediaBlock(optionsCss, 480), { height: 14, fontSize: 8 }, '480px UA table');
  assert.ok(optionsJs.includes('two-state-checkbox'), 'UA per-rule state must render as a flat two-state checkbox');
  assert.ok(/<table\b[^>]*\bid=["']sites-table["']/i.test(optionsHtml),
    'options must own #sites-table after the complete settings migration');
  assert.ok(/(?:#sites-table|\.sites-table)\s*\{[^}]*table-layout\s*:\s*fixed/i.test(desktopCss),
    'desktop site table must use fixed flat-grid layout');
  assertCompactTable(desktopCss, { height: 24 }, 'desktop site table', 'sites-table');
  assertCompactTable(mediaBlock(optionsCss, 768), { height: 18, fontSize: 10 }, '768px site table', 'sites-table');
  assertCompactTable(mediaBlock(optionsCss, 480), { height: 14, fontSize: 8 }, '480px site table', 'sites-table');
  assert.ok(/<th[^>]*>\s*右键\s*</i.test(optionsHtml),
    'options site settings must retain the per-site right-click column');
  assert.ok(optionsJs.includes('rightClick') && optionsJs.includes('two-state-checkbox'),
    'options site table must retain the flat right-click two-state control');
});

test('TC-RUNTIME-005: two loaded history stores preserve both sequential additions in shared persistence', async () => {
  const localStorage = makeMemoryStorage();
  const indexedDB = makeSharedHistoryAdapter();
  const firstStore = await loadHistoryStore(indexedDB, localStorage);
  const secondStore = await loadHistoryStore(indexedDB, localStorage);

  await firstStore.load();
  await secondStore.load();
  await firstStore.add('tab-a');
  await secondStore.add('tab-b');

  const localKeywords = JSON.parse(localStorage.getItem('searchHistory')).map((item) => item.keyword).sort();
  const indexedDBKeywords = indexedDB.snapshot().map((item) => item.keyword).sort();
  assert.deepEqual({ localStorage: localKeywords, indexedDB: indexedDBKeywords }, {
    localStorage: ['tab-a', 'tab-b'],
    indexedDB: ['tab-a', 'tab-b'],
  }, 'a later addition from a stale loaded store must not overwrite history already persisted by another store');
});

test('TC-RUNTIME-006: manifest enables no static ruleset that modifies User-Agent', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const enabledStaticUaResources = (manifest.declarative_net_request?.rule_resources || [])
    .filter((resource) => resource.enabled === true && typeof resource.path === 'string')
    .filter((resource) => {
      const rules = JSON.parse(read(path.posix.join('extension', resource.path)));
      return Array.isArray(rules) && rules.some((rule) =>
        rule.action?.type === 'modifyHeaders' &&
        rule.action.requestHeaders?.some((header) => String(header.header).toLowerCase() === 'user-agent'));
    })
    .map((resource) => ({ id: resource.id, path: resource.path }));

  assert.deepEqual(enabledStaticUaResources, [],
    'an enabled static User-Agent ruleset bypasses the runtime global and per-site switches');
});

function makeEdgePendingLockLifecycle() {
  const events = [];
  let pending = false;
  let invalidated = false;
  return {
    events,
    locks: {
      request(_name, _options, operation) {
        pending = true;
        invalidated = false;
        events.push('history-pending');
        return {
          then(resolve, reject) {
            if (invalidated) {
              pending = false;
              events.push('history-callback-invalidated');
              reject(new Error("Failed to execute 'open' on 'Window': The provided callback is no longer runnable"));
              return;
            }
            Promise.resolve()
              .then(operation)
              .then((value) => {
                pending = false;
                events.push('history-committed');
                resolve(value);
              }, reject);
          },
        };
      },
    },
    onWindowOpen() {
      events.push('window-open');
      if (pending) invalidated = true;
    },
    reset() {
      events.length = 0;
      pending = false;
      invalidated = false;
    },
  };
}

async function runRealNavigationSearch({ keyword, activateQuickMatch, edgeLifecycle }) {
  const source = read('extension/navigation/navigation.js');
  const activateSource = extractFunction(source, 'function activateCurrentMatch()');
  const legacyOpenSource = extractFunction(
    source,
    'async function openSearchResultWithLegacyBackground(keyword, url)'
  );
  const openSearchResultSource = extractFunction(
    source,
    'function openSearchResult(url)'
  );
  const unifiedSearchSource = extractFunction(source, 'function search(site, immediate = false)')
    .replace('function search(', 'function unifiedSearch(');
  const realAddToHistorySource = extractFunction(source, 'async function addToHistory(keyword)')
    .replace('async function addToHistory(', 'async function realAddToHistory(');
  const renderHistorySource = extractFunction(source, 'function renderHistory()');
  const localStorage = makeMemoryStorage();
  const historyStore = await loadHistoryStore(
    makeHistoryAdapter(localStorage),
    localStorage,
    edgeLifecycle?.locks);
  await historyStore.load();
  edgeLifecycle?.reset();
  const historyList = {
    children: [],
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(value) {
      this._innerHTML = value;
      if (value === '') this.children = [];
    },
    appendChild(item) { this.children.push(item); return item; },
  };
  const opened = [];
  const unifiedCalls = [];
  const blockingRuleStatus = {
    dataset: {},
    textContent: '',
  };
  const button = {
    hasAttribute(name) { return name === 'data-site'; },
    getAttribute(name) { return name === 'data-site' ? 'bilibili' : null; },
    click() { throw new Error('data-site quick match must not fall back to element.click()'); },
  };
  const sandbox = {
    currentMatchIndex: 0,
    matchedItems: [{ type: 'button', element: button }],
    searchInput: { value: keyword },
    siteUrls: { bilibili: 'https://search.bilibili.com/all?keyword=' },
    quickSearchKeys: 'blbl',
    quickSearchActive: true,
    searchHistory: [],
    historyItems: [],
    historyPersistence: historyStore,
    historyList,
    opened,
    unifiedCalls,
    blockingRuleStatus,
    recordingPromise: null,
    isEditMode: false,
    doesSiteAllowSearch() { return true; },
    doesSiteAllowBlank() { return false; },
    shouldAppendKeyword() { return true; },
    buildSearchUrl(_site, siteUrl, keyword) { return siteUrl + encodeURIComponent(keyword); },
    document: {
      querySelector() { return null; },
      createElement(tagName) {
        const item = {
          tagName: String(tagName).toUpperCase(),
          className: '',
          textContent: '',
          attributes: {},
          listeners: {},
          classList: {
            add(name) { item.className = item.className ? item.className + ' ' + name : name; },
          },
          setAttribute(name, value) { this.attributes[name] = String(value); },
          addEventListener(type, listener) { this.listeners[type] = listener; },
        };
        return item;
      },
    },
    showErrorModal() { throw new Error('an allowed keyword search must not show the error modal'); },
    updateQuickSearchDisplay() {},
    clearMatches() {},
    enhancedHistoryItemClick() {},
    removeFromHistory() {},
    toggleSelectElement() {},
    editHistoryItem() {},
    updatePositionMemory() {},
    navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          assert.equal(message.type, 'OPEN_SEARCH_RESULT');
          assert.equal(message.keyword, keyword);
          assert.equal(typeof message.targetUrl, 'string');
          edgeLifecycle?.onWindowOpen();
          opened.push({
            url: message.targetUrl,
            target: '_blank',
          });
          callback({
            success: true,
            opened: true,
            blocked: false,
            sessionEnabled: true,
          });
        },
      },
      tabs: {
        async getCurrent() {
          return { id: 1 };
        },
        async create() {
          throw new Error(
            'the current background path must create the result tab'
          );
        },
      },
    },
    setTimeout,
    clearTimeout,
    window: {
      open() {
        throw new Error(
          'extension new-tab search must not bypass OPEN_SEARCH_RESULT'
        );
      },
    },
    console: { error() {}, log() {}, warn() {} },
    encodeURIComponent,
  };
  sandbox.globalThis = sandbox;
  sandbox.MySearchBlockingRules = {
    isUnknownMessageResponse(response, messageType) {
      return response?.success !== true &&
        response?.error === `Unknown message type: ${messageType}`;
    },
  };
  vm.createContext(sandbox);
  const action = activateQuickMatch ? 'activateCurrentMatch();' : "search('bilibili', true);";
  const recordingPromise = vm.runInContext(`${renderHistorySource}\n${realAddToHistorySource}\n${legacyOpenSource}\n${openSearchResultSource}\n${unifiedSearchSource}
function addToHistory(...args) { recordingPromise = realAddToHistory(...args); return recordingPromise; }
function search(...args) { unifiedCalls.push(args); return unifiedSearch(...args); }
${activateSource}
${action}
recordingPromise;`, sandbox,
    { filename: 'extension/navigation/navigation.js#quick-search-activation' });
  if (recordingPromise) await recordingPromise;

  const persisted = JSON.parse(localStorage.getItem('searchHistory') || '[]');
  const result = {
    unifiedCalls: clone(sandbox.unifiedCalls),
    visibleHistory: historyList.children.map((item) => ({ className: item.className, textContent: item.textContent })),
    persistedKeywords: persisted.map((item) => item.keyword),
    opened,
  };
  if (edgeLifecycle) result.lifecycleEvents = [...edgeLifecycle.events];
  return result;
}

test('TC-RUNTIME-007A: unified search really renders and persists the main keyword', async () => {
  const actual = await runRealNavigationSearch({ keyword: 'real-history-chain', activateQuickMatch: false });
  assert.deepEqual(actual, {
    unifiedCalls: [['bilibili', true]],
    visibleHistory: [{ className: 'history-item', textContent: 'real-history-chain' }],
    persistedKeywords: ['real-history-chain'],
    opened: [{
      url: 'https://search.bilibili.com/all?keyword=real-history-chain',
      target: '_blank',
    }],
  }, 'the real unified search, add, render, and persistence functions must produce the visible and stored history');
});

test('TC-RUNTIME-007B: quick-search activation delegates once to the real history-recording search path', async () => {
  const actual = await runRealNavigationSearch({ keyword: 'quick-history-visible', activateQuickMatch: true });
  assert.deepEqual(actual, {
    unifiedCalls: [['bilibili', true]],
    visibleHistory: [{ className: 'history-item', textContent: 'quick-history-visible' }],
    persistedKeywords: ['quick-history-visible'],
    opened: [{
      url: 'https://search.bilibili.com/all?keyword=quick-history-visible',
      target: '_blank',
    }],
  }, 'quick-search activation must delegate to the proven unified path instead of only opening the destination');
});

test('TC-RUNTIME-007C: opening the target precedes the real pending history callback', async () => {
  const edgeLifecycle = makeEdgePendingLockLifecycle();
  const actual = await runRealNavigationSearch({
    keyword: 'edge-open-before-history',
    activateQuickMatch: false,
    edgeLifecycle,
  });
  assert.deepEqual(actual, {
    unifiedCalls: [['bilibili', true]],
    visibleHistory: [{ className: 'history-item', textContent: 'edge-open-before-history' }],
    persistedKeywords: ['edge-open-before-history'],
    opened: [{
      url: 'https://search.bilibili.com/all?keyword=edge-open-before-history',
      target: '_blank',
    }],
    lifecycleEvents: ['window-open', 'history-pending', 'history-committed'],
  }, 'search must open exactly once before starting history persistence so Edge keeps the real callback runnable');
});

test('TC-RUNTIME-008: desktop-UA site scripts fetch and inject their strictly web-accessible mobile CSS', async () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const expectedSites = [
    {
      domain: 'bilibili.com',
      pageUrl: 'https://www.bilibili.com/video/BV1TEST',
      asset: 'content/styles/bilibili-mobile.css',
    },
    {
      domain: 'douyin.com',
      pageUrl: 'https://www.douyin.com/video/123456',
      asset: 'content/styles/douyin-mobile.css',
    },
  ];
  const harness = makeBackgroundHarness({ rules: undefined, globalEnabled: true, tabs: [] });
  await harness.ready();
  const status = await harness.send({ type: 'GET_STATUS' });
  const actual = [];
  for (const site of expectedSites) {
    const outcome = await runEnabledContentScript(manifest, site.pageUrl, status);
    actual.push({
      domain: site.domain,
      defaultRule: {
        enabled: status.rules?.[site.domain]?.enabled,
        uaMode: status.rules?.[site.domain]?.uaMode,
        uiTransform: status.rules?.[site.domain]?.uiTransform,
      },
      manifestAllowsPage: manifestAllowsResource(manifest, site.asset, site.pageUrl),
      requestedAssets: outcome.requestedAssets,
      mobileStyleInserted: outcome.mobileStyleInserted,
      mobileStyleMatchesAsset: outcome.mobileStyleText === read(path.posix.join('extension', site.asset)),
    });
  }
  assert.deepEqual(actual, expectedSites.map((site) => ({
    domain: site.domain,
    defaultRule: { enabled: true, uaMode: 'desktop', uiTransform: true },
    manifestAllowsPage: true,
    requestedAssets: [site.asset],
    mobileStyleInserted: true,
    mobileStyleMatchesAsset: true,
  })), 'each desktop-UA transform must request its own CSS through getURL/fetch and insert the fetched text as the mobile style');
});

test('TC-RUNTIME-009: a live UA mode update is applied and reloads only matching open tabs', async () => {
  for (const uiTransform of [true, false]) {
    const rules = defaultRules();
    rules['bilibili.com'].uiTransform = uiTransform;
    const harness = makeBackgroundHarness({
      rules,
      globalEnabled: true,
      tabs: [
        { id: 1, url: 'https://www.bilibili.com/video/BV1' },
        { id: 2, url: 'https://www.douyin.com/video/2' },
        { id: 3, url: 'https://example.com/' },
      ],
    });
    await harness.ready();
    await harness.send({
      type: 'UPDATE_RULE',
      domain: 'bilibili.com',
      rule: { uaMode: 'mobile', presetKey: 'android_chrome', uiTransform },
    });
    assert.equal(harness.stored.uaRules['bilibili.com'].uaMode, 'mobile');
    assert.equal(harness.stored.uaRules['bilibili.com'].uiTransform, uiTransform);
    assert.deepEqual(harness.events.filter((event) => event.type === 'tabs.reload').map((event) => event.tabId), [1],
      'a UA mode change must refresh only already-open tabs matching the changed base domain');
  }
});

test('TC-RUNTIME-010: generated DNR UA coverage includes both a bare domain and its subdomains', async () => {
  const harness = makeBackgroundHarness({
    rules: {
      'example.com': { enabled: true, uaMode: 'desktop', presetKey: 'chrome_windows', uiTransform: false },
    },
    globalEnabled: true,
    tabs: [],
  });
  await harness.ready();
  const uaRules = harness.dynamicRules.filter(ruleChangesUserAgent);
  assert.ok(uaRules.some((rule) => dnrRuleMatchesUrl(rule, 'https://example.com/')),
    'the actual dynamic UA rules must match the bare configured domain');
  assert.ok(uaRules.some((rule) => dnrRuleMatchesUrl(rule, 'https://www.example.com/path')),
    'the actual dynamic UA rules must also match subdomains');
  assert.ok(!uaRules.some((rule) => dnrRuleMatchesUrl(rule, 'https://notexample.com/')),
    'a configured domain rule must not leak onto an unrelated lookalike domain');
});

test('TC-RUNTIME-011: shared domain extraction preserves public-suffix domains, IPs, and localhost', () => {
  const sandbox = { URL };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('extension/shared/utils.js'), sandbox, { filename: 'extension/shared/utils.js' });
  const extract = vm.runInContext('extractDomain', sandbox);
  assert.deepEqual([
    extract('https://www.google.com.hk/search?q=test'),
    extract('http://127.0.0.1:5500/navigation/'),
    extract('http://localhost:5500/navigation/'),
  ], ['google.com.hk', '127.0.0.1', 'localhost']);
});

test('TC-RUNTIME-012: delete, import, and reset reload only tabs whose effective UA changed', async (t) => {
  const tabs = [
    { id: 1, url: 'https://www.bilibili.com/video/BV1' },
    { id: 2, url: 'https://www.douyin.com/video/2' },
    { id: 3, url: 'https://example.com/' },
  ];
  const liveOutcome = (harness) => {
    const applicationIndexes = harness.events
      .map((event, index) => ({ type: event.type, index }))
      .filter((event) => event.type === 'storage.set' || event.type === 'dnr.update')
      .map((event) => event.index);
    const reloadIndex = harness.events.findIndex((event) => event.type === 'tabs.reload');
    return {
      reloaded: harness.events.filter((event) => event.type === 'tabs.reload').map((event) => event.tabId).sort((a, b) => a - b),
      appliedBeforeReload: applicationIndexes.length > 0 && reloadIndex > Math.max(...applicationIndexes),
    };
  };

  await t.test('delete removes a live rule and reloads its matching tab', async () => {
    const harness = makeBackgroundHarness({ rules: defaultRules(), globalEnabled: true, tabs });
    await harness.ready();
    await harness.send({ type: 'DELETE_RULE', domain: 'bilibili.com' });
    assert.deepEqual(liveOutcome(harness), { reloaded: [1], appliedBeforeReload: true });
  });

  await t.test('import reloads changed domains but not unchanged domains', async () => {
    const harness = makeBackgroundHarness({ rules: defaultRules(), globalEnabled: true, tabs });
    await harness.ready();
    await harness.send({ type: 'IMPORT_RULES', rules: {
      'bilibili.com': { enabled: true, uaMode: 'mobile', presetKey: 'android_chrome', uiTransform: true },
      'douyin.com': defaultRules()['douyin.com'],
    } });
    assert.deepEqual(liveOutcome(harness), { reloaded: [1], appliedBeforeReload: true });
  });

  await t.test('reset reloads changed and removed rules but leaves an unchanged domain alone', async () => {
    const rules = defaultRules();
    rules['bilibili.com'] = { enabled: true, uaMode: 'mobile', presetKey: 'android_chrome', uiTransform: true };
    rules['example.com'] = { enabled: true, uaMode: 'desktop', presetKey: 'chrome_windows', uiTransform: false };
    const harness = makeBackgroundHarness({ rules, globalEnabled: true, tabs });
    await harness.ready();
    await harness.send({ type: 'RESET_RULES' });
    assert.deepEqual(liveOutcome(harness), { reloaded: [1, 3], appliedBeforeReload: true });
  });

  await t.test('bulk import while globally disabled applies storage/DNR without reloading tabs', async () => {
    const harness = makeBackgroundHarness({ rules: defaultRules(), globalEnabled: false, tabs });
    await harness.ready();
    await harness.send({ type: 'IMPORT_RULES', rules: {
      'bilibili.com': { enabled: true, uaMode: 'mobile', presetKey: 'android_chrome', uiTransform: true },
    } });
    assert.equal(harness.stored.uaRules['bilibili.com'].uaMode, 'mobile');
    assert.deepEqual(harness.dynamicRules, [], 'global-off state must leave no effective dynamic UA rules');
    assert.deepEqual(harness.events.filter((event) => event.type === 'tabs.reload').map((event) => event.tabId), []);
  });
});

test('TC-RUNTIME-013: fresh-profile default rules remain immutable across update/delete before reset', async (t) => {
  const harness = makeBackgroundHarness({ rules: undefined, globalEnabled: true, tabs: [] });
  await harness.ready();
  const original = clone((await harness.send({ type: 'GET_STATUS' })).rules);

  await harness.send({
    type: 'UPDATE_RULE',
    domain: 'bilibili.com',
    rule: { enabled: false, uaMode: 'mobile', presetKey: 'android_chrome', customUA: 'temporary', uiTransform: false },
  });
  await harness.send({ type: 'DELETE_RULE', domain: 'google.com' });
  await harness.send({ type: 'RESET_RULES' });

  const storedAfterReset = clone(harness.stored.uaRules);
  const statusAfterReset = clone((await harness.send({ type: 'GET_STATUS' })).rules);
  await t.test('persisted reset value restores the complete original defaults', () => {
    assert.deepEqual(storedAfterReset, original,
      'reset must persist every original default domain and all of their fields');
  });
  await t.test('GET_STATUS exposes the complete restored original defaults', () => {
    assert.deepEqual(statusAfterReset, original,
      'reset status must expose every original default domain and all of their fields');
  });
});
