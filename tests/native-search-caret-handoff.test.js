'use strict';
// Dependency-free function tests: no browser, jsdom, full-page startup or child workers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const navigation = require('../extension/shared/mysearch-navigation.js');
const { read: readProduction, loadFunctions } = require('./native-search-test-support.cjs');
const backgroundSource = readProduction('extension/background/ua-controller.js');
function backgroundHarness(chromeApi, navigationApi = navigation) {
  const { handleMessage } = loadFunctions(backgroundSource, [
    ['handleMessage', '// ============================================\n// 存储变更监听'],
  ], { chrome: chromeApi, MySearchNavigation: navigationApi, console: { error() {} } });
  const responses = [];
  return { responses, async send(message, sender = { tab: { id: 9 } }) {
    await handleMessage(message, sender, response => responses.push(response));
    return responses.at(-1);
  } };
}
const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const runtime = read('extension/content/native-search-redirect-runtime.js');
const page = read('extension/navigation/navigation.js');

function functionBetween(source, name, nextMarker) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  const end = source.indexOf(nextMarker, start);
  assert.ok(end > start, nextMarker);
  return source.slice(start, end).trim();
}
const redirectFunction = functionBetween(runtime, 'redirectToMySearchPage', 'function existingButton(');
const focusFunction = functionBetween(page, 'handleMySearchFocusHash', 'window.addEventListener(');

function targetHarness(hash, hidden = false) {
  const timers = [];
  const replaced = [];
  const document = { hidden, title: 'MySearchPage', activeElement: null, focused: true, hasFocus() { return this.focused; } };
  const input = {
    value: 'old', selectionStart: 0, selectionEnd: 0, selectionDirection: 'none',
    focus() {
      document.activeElement = this;
      // Simulate existing focus enhancements scheduling an end-position update.
      timers.push(() => { this.selectionStart = this.selectionEnd = this.value.length; });
    },
    setSelectionRange(start, end, direction) {
      this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction;
    },
  };
  const sandbox = {
    MySearchNavigation: navigation,
    document, searchInput: input, pendingMySearchFocus: false, mySearchFocusReady: true,
    lastInputValue: '', lastCursorPosition: 0,
    window: { location: { hash, pathname: '/navigation/navigation.html', search: '?from=site' }, history: {
      replaceState(_state, _title, url) { replaced.push(url); sandbox.window.location.hash = ''; },
    } },
    setTimeout(callback) { timers.push(callback); }, console,
  };
  const context = vm.createContext(sandbox);
  const handler = vm.runInContext(`(${focusFunction})`, context, { timeout: 500 });
  return { input, sandbox, timers, replaced, handler };
}

for (const position of [0, 6, 'ESP32 蓝牙😀连接 & 参数#?'.length]) {
  test(`TC-NS-11 点击位置 ${position} 经生产后台消息分支、新标签 URL 和目标恢复函数完整传递`, async () => {
    const keyword = 'ESP32 蓝牙😀连接 & 参数#?';
    const creates = [];
    const pending = [];
    let prevented = 0;
    const input = { value: keyword, selectionStart: position, selectionEnd: position, selectionDirection: 'none' };
    const chromeApi = { runtime: { getURL: file => `chrome-extension://fixture/${file}` }, tabs: {
      async create(properties) { creates.push(properties); return { id: 42 }; },
    } };
    const background = backgroundHarness(chromeApi);
    const handler = vm.runInNewContext(`(${redirectFunction})`, {
      windowRef: { setTimeout(callback) { callback(); } },
      chromeApi, purgeAllPopups() {},
      sendMessage(api, message) {
        assert.equal(message.type, 'OPEN_MYSEARCH_PAGE');
        pending.push(background.send(message));
      },
    }, { timeout: 500 });
    handler({ currentTarget: input, preventDefault() { prevented++; }, stopPropagation() {}, stopImmediatePropagation() {} });
    await Promise.all(pending);
    assert.equal(prevented, 1);
    assert.equal(creates.length, 1);
    assert.equal(creates[0].active, true);
    assert.equal(creates[0].openerTabId, 9);
    assert.equal(background.responses.length, 1);
    assert.equal(background.responses[0].opened, true);
    const url = new URL(creates[0].url);
    assert.equal(url.pathname, '/navigation/navigation.html');
    const target = targetHarness(url.hash);
    assert.equal(target.handler(), true);
    for (const callback of target.timers) callback();
    assert.equal(target.input.value, keyword);
    assert.equal(target.input.selectionStart, position);
    assert.equal(target.input.selectionEnd, position);
    assert.equal(target.sandbox.document.activeElement, target.input);
    assert.equal(target.sandbox.lastInputValue, keyword);
    assert.equal(target.sandbox.lastCursorPosition, position);
    assert.deepEqual(target.replaced, ['/navigation/navigation.html?from=site']);
    assert.equal(input.value, keyword, 'source control is not cleared');
  });
}

test('目标页隐藏时不清除传递数据，激活后再恢复选区', () => {
  const context = { keyword: '蓝牙连接', selectionStart: 1, selectionEnd: 3, selectionDirection: 'backward' };
  const url = new URL(navigation.buildFocusUrl('chrome-extension://fixture/navigation/navigation.html', context));
  const target = targetHarness(url.hash, true);
  assert.equal(target.handler(), true);
  assert.equal(target.sandbox.pendingMySearchFocus, true);
  assert.equal(target.input.value, context.keyword);
  assert.equal(target.input.selectionStart, 1);
  assert.equal(target.input.selectionEnd, 3);
  assert.equal(target.sandbox.document.activeElement, null, 'hidden-page data transfer must not request focus');
  assert.equal(target.timers.length, 0);
  assert.deepEqual(target.replaced, []);
  target.sandbox.document.hidden = false;
  assert.equal(target.handler(), true);
  for (const callback of target.timers) callback();
  assert.equal(target.sandbox.pendingMySearchFocus, false);
  assert.equal(target.input.value, context.keyword);
  assert.equal(target.input.selectionStart, 1);
  assert.equal(target.input.selectionEnd, 3);
  assert.equal(target.input.selectionDirection, 'backward');
});

test('兼容旧空白聚焦标记，忽略无关片段', () => {
  const empty = targetHarness('#msp-focus-search');
  assert.equal(empty.handler(), true);
  for (const callback of empty.timers) callback();
  assert.equal(empty.input.value, '');
  assert.equal(empty.input.selectionStart, 0);
  const unrelated = targetHarness('#other');
  assert.equal(unrelated.handler(), false);
  assert.equal(unrelated.input.value, 'old');
  assert.equal(unrelated.timers.length, 0);
});

test('延迟恢复不覆盖用户随后修改的关键词', () => {
  const url = new URL(navigation.buildFocusUrl('chrome-extension://fixture/navigation/navigation.html', { keyword: '蓝牙', selectionStart: 1 }));
  const target = targetHarness(url.hash);
  target.handler();
  target.timers[0]();
  target.input.value = '用户修改';
  target.input.setSelectionRange(2, 2, 'none');
  target.timers[1]();
  assert.equal(target.input.value, '用户修改');
  assert.equal(target.input.selectionStart, 2);
});

test('替换框只读、保留浏览器原生点击定位，并排除原生搜索再次识别', () => {
  assert.match(runtime, /createElement\('input'\)/);
  assert.match(runtime, /button\.type = 'text'/);
  assert.match(runtime, /button\.readOnly = true/);
  assert.match(runtime, /button\.placeholder = BUTTON_TEXT/);
  assert.match(runtime, /if \(event\.key === 'Enter'\)/);
  assert.doesNotMatch(runtime, /button\.addEventListener\?\.\('(?:pointerdown|mousedown)'/);
  assert.match(runtime, /return new Set\(Array\.from\(inputs\)\.filter\(input => input\.getAttribute\?\.\(BUTTON_ATTR\) !== 'true'\)\)/);
});

test('点击事件之后才更新的原生光标仍被采集，不读取失效的 event.currentTarget', async () => {
  const timers = [];
  const messages = [];
  const input = { value: 'ESP32 蓝牙连接', selectionStart: 0, selectionEnd: 0, selectionDirection: 'none' };
  const handler = vm.runInNewContext(`(${redirectFunction})`, {
    chromeApi: {}, windowRef: { setTimeout(callback) { timers.push(callback); } },
    purgeAllPopups() {}, sendMessage(_api, message) { messages.push(message); },
  }, { timeout: 500 });
  const event = { type: 'click', currentTarget: input, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
  handler(event);
  assert.equal(messages.length, 0, 'wait until native click selection is complete');
  input.selectionStart = input.selectionEnd = 6;
  event.currentTarget = null;
  for (const callback of timers) callback();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].searchContext.selectionStart, 6);
  assert.equal(messages[0].searchContext.selectionEnd, 6);
});

test('可见但尚未获得窗口焦点的新标签不提前消费光标交接', () => {
  const hash = new URL(navigation.buildFocusUrl('chrome-extension://fixture/navigation/navigation.html', { keyword: '蓝牙连接', selectionStart: 2 })).hash;
  const target = targetHarness(hash);
  target.sandbox.document.focused = false;
  target.handler();
  assert.equal(target.sandbox.pendingMySearchFocus, true);
  assert.equal(target.input.value, '蓝牙连接');
  assert.equal(target.input.selectionStart, 2);
  assert.equal(target.sandbox.document.activeElement, null, 'background-page data transfer must not request focus');
  assert.equal(target.timers.length, 0);
  assert.equal(target.sandbox.window.location.hash, hash);
  target.sandbox.document.focused = true;
  target.handler();
  for (const callback of target.timers) callback();
  assert.equal(target.input.selectionStart, 2);
  assert.equal(target.sandbox.window.location.hash, '');
});

test('初始化完成前不消费交接，完成后恢复而不是被初始化覆盖', () => {
  const hash = new URL(navigation.buildFocusUrl('chrome-extension://fixture/navigation/navigation.html', { keyword: 'ESP32 蓝牙', selectionStart: 6 })).hash;
  const target = targetHarness(hash);
  target.sandbox.mySearchFocusReady = false;
  target.handler();
  assert.equal(target.input.value, 'old');
  assert.deepEqual(target.replaced, []);
  target.sandbox.mySearchFocusReady = true;
  target.handler();
  for (const callback of target.timers) callback();
  assert.equal(target.input.value, 'ESP32 蓝牙');
  assert.equal(target.input.selectionStart, 6);
});

test('延迟恢复时窗口失焦则保留交接，再次聚焦后恢复并清理', () => {
  const hash = new URL(navigation.buildFocusUrl('chrome-extension://fixture/navigation/navigation.html', { keyword: '蓝牙连接', selectionStart: 2 })).hash;
  const target = targetHarness(hash);
  target.handler();
  target.timers[0]();
  target.sandbox.document.focused = false;
  target.timers[1]();
  assert.equal(target.sandbox.pendingMySearchFocus, true);
  assert.equal(target.sandbox.window.location.hash, hash);
  target.sandbox.document.focused = true;
  target.handler();
  for (const callback of target.timers.slice(2)) callback();
  assert.equal(target.input.selectionStart, 2);
  assert.equal(target.input.selectionEnd, 2);
  assert.equal(target.sandbox.window.location.hash, '');
  assert.match(page, /window\.addEventListener\('focus', function\(\) \{\s*if \(pendingMySearchFocus\) handleMySearchFocusHash\(\);/);
  assert.match(page, /initializeSearchInputEnhancements\(\);\s*mySearchFocusReady = true;/);
});

test('TC-NS-14 生产后台兼容无context旧消息、非法context不创建标签', async () => {
  const creates = [];
  const background = backgroundHarness({ runtime: { getURL: file => `chrome-extension://fixture/${file}` },
    tabs: { async create(properties) { creates.push(properties); return { id: 42 }; } } });
  assert.equal((await background.send({ type: 'OPEN_MYSEARCH_PAGE' })).opened, true);
  assert.equal(new URL(creates[0].url).hash, '#msp-focus-search');
  const response = await background.send({ type: 'OPEN_MYSEARCH_PAGE', searchContext: { keyword: 123, selectionStart: 1 } });
  assert.equal(response.success, false);
  assert.equal(response.reason, 'INVALID_SEARCH_CONTEXT');
  assert.equal(creates.length, 1);
});

test('TC-NS-14 导航API缺失与创建失败不伪造opened响应', async () => {
  const unavailable = backgroundHarness({}, undefined);
  // Explicit null prevents the harness default from substituting the real API.
  const missing = backgroundHarness({}, null);
  assert.equal((await missing.send({ type: 'OPEN_MYSEARCH_PAGE' })).reason, 'MYSEARCH_PAGE_UNAVAILABLE');
  assert.equal((await unavailable.send({ type: 'OPEN_MYSEARCH_PAGE' })).success, false);
  const failed = backgroundHarness({ runtime: { getURL: file => `chrome-extension://fixture/${file}` },
    tabs: { async create() { throw new Error('create denied'); } } });
  const response = await failed.send({ type: 'OPEN_MYSEARCH_PAGE', searchContext: { keyword: 'agi架构', selectionStart: 3 } });
  assert.equal(response.success, false);
  assert.equal(response.reason, 'MYSEARCH_PAGE_OPEN_FAILED');
  assert.equal(response.opened, undefined);
  assert.equal(failed.responses.length, 1);
});

test('TC-NS-14 中文emoji特殊字符与反向选区穿过生产后台后精确恢复', async () => {
  const keyword = '  蓝牙😀 & 参数#?  ';
  const context = { keyword, selectionStart: 2, selectionEnd: 6, selectionDirection: 'backward' };
  let created;
  const background = backgroundHarness({ runtime: { getURL: file => `chrome-extension://fixture/${file}` },
    tabs: { async create(properties) { created = properties; return { id: 43 }; } } });
  const response = await background.send({ type: 'OPEN_MYSEARCH_PAGE', searchContext: context });
  assert.equal(response.success, true);
  const hash = new URL(created.url).hash;
  assert.deepEqual(navigation.parseFocusHash(hash), context);
  const target = targetHarness(hash);
  target.handler(); for (const callback of target.timers) callback();
  assert.equal(target.input.value, keyword);
  assert.equal(target.input.selectionStart, 2);
  assert.equal(target.input.selectionEnd, 6);
  assert.equal(target.input.selectionDirection, 'backward');
});

test('TC-NS-12 交接函数无窗口置顶或定位轮询副作用', () => {
  assert.doesNotMatch(redirectFunction + focusFunction, /windows\.update|window\.focus\(|setInterval\(|requestAnimationFrame\(/);
});

test('TC-NS-11 检测旧后台丢参反例：显式context不能退回空focus片段', async () => {
  const oldBackground = backgroundSource.replace('message.searchContext', 'undefined');
  assert.notEqual(oldBackground, backgroundSource, 'counterexample must really remove forwarding');
  let created;
  const chromeApi = { runtime: { getURL: file => `chrome-extension://fixture/${file}` },
    tabs: { async create(properties) { created = properties; return { id: 42 }; } } };
  const { handleMessage } = loadFunctions(oldBackground, [
    ['handleMessage', '// ============================================\n// 存储变更监听'],
  ], { chrome: chromeApi, MySearchNavigation: navigation, console: { error() {} } });
  await handleMessage({ type: 'OPEN_MYSEARCH_PAGE', searchContext: { keyword: 'agi架构', selectionStart: 3 } }, { tab: { id: 9 } }, () => {});
  const restored = navigation.parseFocusHash(new URL(created.url).hash);
  assert.equal(restored.keyword, '', 'old branch reproduces the empty target symptom');
  assert.notEqual(restored.keyword, 'agi架构', 'the end-to-end assertion above must distinguish this from success');
});

test('TC-NS-11 无sender.tab时仍完整传词，不伪造openerTabId', async () => {
  let created;
  const context = { keyword: '六点半', selectionStart: 2, selectionEnd: 2, selectionDirection: 'none' };
  const background = backgroundHarness({ runtime: { getURL: file => `chrome-extension://fixture/${file}` },
    tabs: { async create(properties) { created = properties; return { id: 44 }; } } });
  assert.equal((await background.send({ type: 'OPEN_MYSEARCH_PAGE', searchContext: context }, {})).opened, true);
  assert.equal(Object.hasOwn(created, 'openerTabId'), false);
  assert.equal(created.active, true);
  assert.deepEqual(navigation.parseFocusHash(new URL(created.url).hash), context);
});
