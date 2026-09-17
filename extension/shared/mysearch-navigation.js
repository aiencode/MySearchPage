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

  function buildFocusUrl(url) {
    try {
      const result = new URL(url);
      result.hash = FOCUS_HASH;
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

  async function openMySearchPage(chromeApi, senderTab) {
    const baseUrl = getSearchPageUrl(chromeApi);
    if (
      !baseUrl ||
      typeof chromeApi?.tabs?.create !== 'function'
    ) {
      return { success: false, reason: 'MYSEARCH_PAGE_UNAVAILABLE' };
    }

    const createProperties = {
      url: buildFocusUrl(baseUrl),
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
    buildFocusUrl,
    getSearchPageUrl,
    openMySearchPage,
  });

  global.MySearchNavigation = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(globalThis);
