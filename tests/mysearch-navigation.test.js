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
