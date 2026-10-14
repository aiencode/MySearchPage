/**
 * MySearchPage 导航页地址与聚焦标记的共享能力。
 *
 * 这个文件同时被 Service Worker 和测试环境加载，因此不依赖页面 DOM。
 */
(function attachMySearchNavigation(global) {
  'use strict';

  const SEARCH_PAGE_PATH = '/navigation/navigation.html';
  const FOCUS_HASH = '#msp-focus-search';

  function normalizePath(pathname) {
    const value = String(pathname || '/');
    return value.length > 1 ? value.replace(/\/+$/, '') : value;
  }

  function isMySearchPageUrl(url, expectedUrl) {
    if (typeof url !== 'string' || !url) return false;

    try {
      const actual = new URL(url);
      const expected = expectedUrl ? new URL(expectedUrl) : null;
      const expectedPath = normalizePath(
        expected?.pathname || SEARCH_PAGE_PATH
      );

      if (normalizePath(actual.pathname) !== expectedPath) return false;
      if (expected) return actual.origin === expected.origin;
      return actual.protocol === 'chrome-extension:';
    } catch (error) {
      return false;
    }
  }

  function normalizeSearchContext(context) {
    if (!context || typeof context.keyword !== 'string' || context.keyword.length > 8192) return null;
    const keyword = context.keyword;
    const position = (value, fallback) => Number.isInteger(value)
      ? Math.max(0, Math.min(keyword.length, value)) : fallback;
    const start = position(context.selectionStart, keyword.length);
    const end = position(context.selectionEnd, start);
    return {
      keyword,
      selectionStart: Math.min(start, end),
      selectionEnd: Math.max(start, end),
      selectionDirection: ['forward', 'backward', 'none'].includes(context.selectionDirection)
        ? context.selectionDirection : 'none',
    };
  }

  function parseFocusHash(hash) {
    if (hash === FOCUS_HASH) return normalizeSearchContext({ keyword: '', selectionStart: 0 });
    if (typeof hash !== 'string' || !hash.startsWith(`${FOCUS_HASH}?`)) return null;
    const params = new URLSearchParams(hash.slice(FOCUS_HASH.length + 1));
    if (!params.has('keyword')) return null;
    const position = name => params.has(name) ? Number(params.get(name)) : undefined;
    return normalizeSearchContext({
      keyword: params.get('keyword'),
      selectionStart: position('selectionStart'),
      selectionEnd: position('selectionEnd'),
      selectionDirection: params.get('selectionDirection'),
    });
  }

  function buildFocusUrl(url, searchContext) {
    try {
      const result = new URL(url);
      result.hash = FOCUS_HASH;
      if (searchContext !== undefined) {
        const context = normalizeSearchContext(searchContext);
        if (!context) return '';
        result.hash = `${FOCUS_HASH}?${new URLSearchParams({
          keyword: context.keyword,
          selectionStart: String(context.selectionStart),
          selectionEnd: String(context.selectionEnd),
          selectionDirection: context.selectionDirection,
        })}`;
      }
      return result.href;
    } catch (error) {
      return '';
    }
  }

  function getSearchPageUrl(chromeApi) {
    try {
      return chromeApi?.runtime?.getURL?.('navigation/navigation.html') || '';
    } catch (error) {
      return '';
    }
  }

  async function openMySearchPage(chromeApi, senderTab, searchContext) {
    const baseUrl = getSearchPageUrl(chromeApi);
    if (
      !baseUrl ||
      typeof chromeApi?.tabs?.create !== 'function'
    ) {
      return { success: false, reason: 'MYSEARCH_PAGE_UNAVAILABLE' };
    }

    const focusUrl = buildFocusUrl(baseUrl, searchContext);
    if (!focusUrl) return { success: false, reason: 'INVALID_SEARCH_CONTEXT' };

    const createProperties = {
      url: focusUrl,
      active: true,
    };
    if (Number.isInteger(senderTab?.id)) {
      createProperties.openerTabId = senderTab.id;
    }

    try {
      const tab = await chromeApi.tabs.create(createProperties);
      return {
        success: true,
        opened: true,
        tabId: tab?.id,
      };
    } catch (error) {
      return {
        success: false,
        reason: 'MYSEARCH_PAGE_OPEN_FAILED',
        error: error?.message || 'MySearchPage 打开失败',
      };
    }
  }

  const api = Object.freeze({
    SEARCH_PAGE_PATH,
    FOCUS_HASH,
    isMySearchPageUrl,
    normalizeSearchContext,
    parseFocusHash,
    buildFocusUrl,
    getSearchPageUrl,
    openMySearchPage,
  });

  global.MySearchNavigation = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(globalThis);
