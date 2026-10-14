const test = require('node:test');
const assert = require('node:assert/strict');

const navigation = require('../extension/shared/mysearch-navigation.js');

test('使用现有扩展导航页并保留聚焦标记', () => {
  const base = 'chrome-extension://abc123/navigation/navigation.html';
  assert.equal(navigation.isMySearchPageUrl(base, base), true);
  assert.equal(
    navigation.buildFocusUrl(`${base}?from=bilibili#old`),
    'chrome-extension://abc123/navigation/navigation.html?from=bilibili#msp-focus-search'
  );
});

test('点击原生替代按钮后在新标签打开空白搜索页', async () => {
  const creates = [];
  const chromeApi = {
    runtime: {
      getURL(path) {
        return `chrome-extension://abc123/${path}`;
      },
    },
    tabs: {
      async create(properties) {
        creates.push(properties);
        return { id: 42 };
      },
    },
  };

  const result = await navigation.openMySearchPage(chromeApi, {
    id: 9,
  });

  assert.deepEqual(result, { success: true, opened: true, tabId: 42 });
  assert.equal(creates.length, 1);
  assert.equal(creates[0].active, true);
  assert.equal(creates[0].openerTabId, 9);
  const url = new URL(creates[0].url);
  assert.equal(url.pathname, '/navigation/navigation.html');
  assert.equal(url.search, '');
  assert.equal(url.hash, '#msp-focus-search');
});

test('打开搜索页失败时不伪造成功结果', async () => {
  const result = await navigation.openMySearchPage({
    runtime: {
      getURL() { return 'chrome-extension://abc123/navigation/navigation.html'; },
    },
    tabs: {
      async create() { throw new Error('blocked'); },
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'MYSEARCH_PAGE_OPEN_FAILED');
});

test('关键词和 UTF-16 选区在 URL 片段中完整往返', () => {
  const context = { keyword: ' ESP32 蓝牙😀连接 & 参数#? ', selectionStart: 6, selectionEnd: 10, selectionDirection: 'backward' };
  const url = new URL(navigation.buildFocusUrl('chrome-extension://abc123/navigation/navigation.html?from=source', context));
  assert.equal(url.search, '?from=source');
  assert.deepEqual(navigation.parseFocusHash(url.hash), context);
  assert.equal(navigation.parseFocusHash('#unrelated'), null);
  assert.equal(navigation.parseFocusHash('#msp-focus-search?selectionStart=1'), null);
});

test('空关键词和非法光标位置被安全规范化', () => {
  assert.deepEqual(navigation.parseFocusHash('#msp-focus-search'), { keyword: '', selectionStart: 0, selectionEnd: 0, selectionDirection: 'none' });
  assert.deepEqual(navigation.normalizeSearchContext({ keyword: '蓝牙', selectionStart: -20, selectionEnd: 999, selectionDirection: 'bad' }), { keyword: '蓝牙', selectionStart: 0, selectionEnd: 2, selectionDirection: 'none' });
  assert.deepEqual(navigation.normalizeSearchContext({ keyword: '蓝牙', selectionStart: NaN }), { keyword: '蓝牙', selectionStart: 2, selectionEnd: 2, selectionDirection: 'none' });
  assert.equal(navigation.normalizeSearchContext({ keyword: 'x'.repeat(8193) }), null);
});

test('携带关键词仍新建活动标签，并保留 openerTabId', async () => {
  const creates = [];
  const context = { keyword: 'ESP32 蓝牙', selectionStart: 6, selectionEnd: 6, selectionDirection: 'none' };
  const chromeApi = { runtime: { getURL: file => `chrome-extension://abc123/${file}` }, tabs: { async create(properties) { creates.push(properties); return { id: 42 }; } } };
  assert.equal((await navigation.openMySearchPage(chromeApi, { id: 9 }, context)).success, true);
  assert.equal(creates[0].active, true);
  assert.equal(creates[0].openerTabId, 9);
  assert.equal(new URL(creates[0].url).pathname, '/navigation/navigation.html');
  assert.deepEqual(navigation.parseFocusHash(new URL(creates[0].url).hash), context);
  assert.equal((await navigation.openMySearchPage(chromeApi, { id: 9 }, { keyword: 123 })).reason, 'INVALID_SEARCH_CONTEXT');
  assert.equal(creates.length, 1);
});
