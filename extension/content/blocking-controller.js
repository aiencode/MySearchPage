/**
 * MySearchPage - Phase 1 内容与 URL 阻断控制器
 *
 * 规则只做字面字符串 includes；不做AI、OCR、图片/视频识别或同义词扩展。
 * 动态页面只处理新增节点，不因一次 DOM 变化重扫整个 document。
 */
(function installBlockingController(global) {
  'use strict';

  const rulesApi = global.MySearchBlockingRules;
  if (!rulesApi || !global.chrome?.runtime) return;

  const BLOCKED_ATTR = 'data-mysearch-blocked';
  const BLOCKED_KEYWORD_ATTR = 'data-mysearch-blocked-keyword';
  const NOTICE_ID = 'mysearch-blocking-notice';
  const STYLE_ID = 'mysearch-blocking-style';
  const NAVIGATION_EVENT = 'mysearch-blocking-navigation-attempt';
  const MEDIA_EVENT = 'mysearch-blocking-media-attempt';
  const RULE_REQUEST_TYPE = 'MYSEARCH_BLOCKING_RULE_REQUEST';
  const RULE_RESPONSE_TYPE = 'MYSEARCH_BLOCKING_RULE_RESPONSE';
  const SEARCH_REQUEST_TYPE = 'MYSEARCH_SEARCH_OPEN_REQUEST';
  const SEARCH_RESPONSE_TYPE = 'MYSEARCH_SEARCH_OPEN_RESPONSE';
  const RULE_SCOPES = new Set(['keyword', 'url', 'both']);
  const MAX_RULE_LENGTH = 4096;
  const MAX_SEARCH_URL_LENGTH = 8192;
  const DEPTH2_HIDDEN_ATTR = 'data-mysearch-depth2-hidden';
  const DEPTH3_REJECTED_ATTR = 'data-mysearch-depth3-rejected';
  const NAVIGATION_DEPTH_ATTR = 'data-mysearch-navigation-depth';
  const DEPTH_ADAPTERS = {
    xiaohongshu: {
      domains: ['xiaohongshu.com'],
      candidates: [
        '[data-note-id]',
        'a[href*="/explore/"]',
        'a[href*="/discovery/item/"]',
      ],
      details: [
        '.note-detail-mask [data-note-id]',
        '.note-detail[data-note-id]',
      ],
      cleanup: [
        '.note-detail-mask .recommend-container',
        '.note-detail-mask .recommend-list',
        '.note-detail-mask .related-notes',
        'header a[href="/explore"]',
        'nav a[href="/explore"]',
      ],
    },
    douyin: {
      domains: ['douyin.com'],
      candidates: [
        '[data-aweme-id]',
        'a[href*="/video/"]',
      ],
      details: [
        '[data-e2e="feed-active-video"][data-aweme-id]',
        '[data-e2e="video-detail"][data-aweme-id]',
      ],
      cleanup: [
        '[data-e2e="video-detail-recommend"]',
        '[data-e2e="recommend-list"]',
        '[data-e2e="related-video"]',
        'a[href="/discover"]',
        'a[href="/recommend"]',
      ],
    },
    bilibili: {
      domains: ['bilibili.com'],
      candidates: [
        '[data-aid]',
        '[data-bvid]',
        'a[href*="/video/"]',
        'a[href*="/bangumi/play/"]',
      ],
      details: [],
      cleanup: [
        '#reco_list',
        '.recommend-list-v1',
        '.recommend-list',
        '.rec-list',
        'a[href^="//www.bilibili.com/v/popular"]',
        'a[href^="https://www.bilibili.com/v/popular"]',
      ],
    },
    youtube: {
      domains: ['youtube.com', 'youtu.be'],
      candidates: [
        'a[href*="/watch?"]',
        'a[href*="/shorts/"]',
        'a[href*="/live/"]',
      ],
      details: [],
      cleanup: [
        '#related',
        'ytd-watch-next-secondary-results-renderer',
        'ytm-watch-next-secondary-results-renderer',
        'ytm-item-section-renderer[section-identifier="related-items"]',
        'ytd-guide-entry-renderer a[href="/"]',
        'a[href="/feed/trending"]',
      ],
    },
  };
  const CANDIDATE_SELECTOR = [
    'a[href]',
    'area[href]',
    'button',
    'article',
    'li',
    '[role="link"]',
    '[role="button"]',
    '[tabindex]:not([tabindex="-1"])',
    '[data-href]',
    '[data-url]',
    '[onclick]',
    'h1',
    'h2',
    'h3',
    'h4',
  ].join(',');
  const DEDUPLICATION_WINDOW_MS = 2000;

  let rules = rulesApi.normalizeRules();
  let rulesLoaded = false;
  let observer = null;
  let queuedNodes = new Set();
  let flushScheduled = false;
  let currentUrlPattern = null;
  let currentTitleKeyword = null;
  let pageIsBlocked = false;
  let pageExposureRecorded = new Set();
  let exposureMap = new WeakMap();
  let recentAttempts = new Map();
  let blockedClickCount = 0;
  let lastFeedbackAt = 0;
  let lastFeedbackEventId = null;
  let lastAttemptAt = null;
  let navigationContext = null;
  let lastRejectedContentId = '';

  const sessionId = global.crypto?.randomUUID?.() || (
    `page-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        global.chrome.runtime.sendMessage(message, (response) => {
          void global.chrome.runtime.lastError;
          resolve(response || null);
        });
      } catch (error) {
        resolve(null);
      }
    });
  }

  async function addBlockingRule(value, scope) {
    const response = await sendMessage({
      type: 'ADD_BLOCKING_RULE',
      value,
      scope,
    });
    if (!rulesApi.isUnknownAddRuleResponse(response)) return response;

    try {
      const nextRules = await rulesApi.addRuleToStorage(value, scope);
      return { success: true, rules: nextRules };
    } catch (error) {
      return {
        success: false,
        error: error?.message || '阻断规则保存失败',
      };
    }
  }

  function postRuleResponse(requestId, success, error, origin) {
    if (typeof global.postMessage !== 'function') return;
    const targetOrigin = origin === 'null' ? '*' : origin;
    global.postMessage({
      type: RULE_RESPONSE_TYPE,
      requestId,
      success,
      error: error || '',
    }, targetOrigin);
  }

  function postSearchResponse(requestId, response, error, origin) {
    if (typeof global.postMessage !== 'function') return;
    const targetOrigin = origin === 'null' ? '*' : origin;
    global.postMessage({
      type: SEARCH_RESPONSE_TYPE,
      requestId,
      success: response?.success === true,
      opened: response?.opened === true,
      blocked: response?.blocked === true,
      match: response?.match || null,
      sessionEnabled: response?.sessionEnabled === true,
      error: error || response?.error || '',
    }, targetOrigin);
  }

  function isMySearchPage() {
    return /(?:^|\/)mysearch\.html$/.test(
      global.location?.pathname || ''
    );
  }

  async function openSearchResultWithLegacyBackground(
    keyword,
    targetUrl
  ) {
    const storedRules = await rulesApi.getRulesFromStorage();
    const blockedKeyword = rulesApi.findKeyword(
      keyword,
      storedRules.blockedKeywords
    );
    if (blockedKeyword) {
      return {
        success: true,
        opened: false,
        blocked: true,
        match: {
          kind: 'keyword',
          value: blockedKeyword,
        },
      };
    }

    const blockedUrlPattern = rulesApi.findUrlPattern(
      targetUrl,
      storedRules.blockedUrlPatterns
    );
    if (blockedUrlPattern) {
      return {
        success: true,
        opened: false,
        blocked: true,
        match: {
          kind: 'url',
          value: blockedUrlPattern,
        },
      };
    }

    const session = await sendMessage({
      type: 'START_SEARCH_SESSION',
      targetUrl,
    });
    const openedWindow = global.open?.(targetUrl, '_blank');
    if (!openedWindow) {
      return {
        success: false,
        opened: false,
        blocked: false,
        error: '浏览器阻止了新标签页，请允许弹出窗口后重试',
      };
    }

    return {
      success: true,
      opened: true,
      blocked: false,
      sessionEnabled: session?.enabled === true,
      sessionId: session?.sessionId || '',
    };
  }

  function handleSearchOpenRequest(event) {
    if (
      !isMySearchPage() ||
      event.source !== global ||
      event.origin !== global.location?.origin
    ) {
      return;
    }

    const data = event.data;
    if (
      !data ||
      data.type !== SEARCH_REQUEST_TYPE ||
      typeof data.requestId !== 'string' ||
      data.requestId.length < 1 ||
      data.requestId.length > 200 ||
      typeof data.keyword !== 'string' ||
      data.keyword.length > MAX_RULE_LENGTH ||
      typeof data.targetUrl !== 'string' ||
      !data.targetUrl ||
      data.targetUrl.length > MAX_SEARCH_URL_LENGTH
    ) {
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(data.targetUrl);
    } catch (error) {
      postSearchResponse(
        data.requestId,
        null,
        '搜索地址无效',
        event.origin
      );
      return;
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      postSearchResponse(
        data.requestId,
        null,
        '搜索地址协议无效',
        event.origin
      );
      return;
    }

    void sendMessage({
      type: 'OPEN_SEARCH_RESULT',
      keyword: data.keyword.trim(),
      targetUrl: parsedUrl.href,
    }).then((response) => {
      if (
        rulesApi.isUnknownMessageResponse(
          response,
          'OPEN_SEARCH_RESULT'
        )
      ) {
        return openSearchResultWithLegacyBackground(
          data.keyword.trim(),
          parsedUrl.href
        ).then((legacyResponse) => {
          postSearchResponse(
            data.requestId,
            legacyResponse,
            '',
            event.origin
          );
        });
      }

      postSearchResponse(data.requestId, response, '', event.origin);
    }).catch((error) => {
      postSearchResponse(
        data.requestId,
        null,
        error?.message || '搜索请求失败',
        event.origin
      );
    });
  }

  function handleBlockingRuleRequest(event) {
    if (
      event.source !== global ||
      event.origin !== global.location?.origin
    ) {
      return;
    }

    const data = event.data;
    if (
      !data ||
      data.type !== RULE_REQUEST_TYPE ||
      typeof data.requestId !== 'string' ||
      data.requestId.length < 1 ||
      data.requestId.length > 200
    ) {
      return;
    }

    const value = typeof data.value === 'string' ? data.value.trim() : '';
    const scope = data.scope;
    if (
      !value ||
      value.length > MAX_RULE_LENGTH ||
      !RULE_SCOPES.has(scope)
    ) {
      postRuleResponse(
        data.requestId,
        false,
        '阻断规则参数无效',
        event.origin
      );
      return;
    }

    void addBlockingRule(value, scope).then((response) => {
      if (!response?.success) {
        postRuleResponse(
          data.requestId,
          false,
          response?.error || '阻断规则保存失败',
          event.origin
        );
        return;
      }
      postRuleResponse(data.requestId, true, '', event.origin);
    }).catch(() => {
      postRuleResponse(
        data.requestId,
        false,
        '阻断规则保存失败',
        event.origin
      );
    });
  }

  function domain() {
    return global.location?.hostname || '';
  }

  function now() {
    return Date.now();
  }

  function eventId(prefix) {
    return `${prefix}-${sessionId}-${now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function isElement(value) {
    return typeof global.Element === 'function' &&
      value instanceof global.Element;
  }

  function textForElement(element) {
    if (!isElement(element)) return '';
    const attributes = [
      'aria-label',
      'title',
      'data-title',
      'data-tooltip',
      'alt',
      'placeholder',
    ].map((name) => element.getAttribute(name) || '');
    return [element.textContent || '', ...attributes].filter(Boolean).join('\n');
  }

  function isCandidate(element) {
    return isElement(element) && element.matches(CANDIDATE_SELECTOR);
  }

  function isLikelyClickable(element) {
    if (!isElement(element)) return false;
    if (isCandidate(element)) return true;
    if (element.hasAttribute('onclick') || element.hasAttribute('data-href') ||
      element.hasAttribute('data-url')) return true;
    try {
      return global.getComputedStyle(element).cursor === 'pointer';
    } catch (error) {
      return false;
    }
  }

  function absoluteUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl) return '';
    try {
      return new URL(rawUrl, global.location.href).href;
    } catch (error) {
      return rawUrl;
    }
  }

  function depthAdapterEntry() {
    const hostname = domain().toLowerCase().replace(/^www\./, '');
    for (const [name, adapter] of Object.entries(DEPTH_ADAPTERS)) {
      if (adapter.domains.some(rule =>
        hostname === rule || hostname.endsWith(`.${rule}`)
      )) {
        return { name, ...adapter };
      }
    }
    return null;
  }

  function contentIdFromUrl(rawUrl, adapterEntry = depthAdapterEntry()) {
    if (!adapterEntry || !rawUrl) return '';
    let url;
    try {
      url = new URL(rawUrl, global.location.href);
    } catch (error) {
      return '';
    }
    const path = url.pathname;
    let value = '';
    if (adapterEntry.name === 'xiaohongshu') {
      value = path.match(
        /\/(?:explore|discovery\/item)\/([a-zA-Z0-9]+)/
      )?.[1] || '';
    } else if (adapterEntry.name === 'douyin') {
      value = path.match(/\/video\/(\d+)/)?.[1] || '';
    } else if (adapterEntry.name === 'bilibili') {
      value = path.match(/\/video\/((?:BV|av)[a-zA-Z0-9]+)/i)?.[1] ||
        path.match(/\/bangumi\/play\/((?:ep|ss)\d+)/i)?.[1] || '';
    } else if (adapterEntry.name === 'youtube') {
      value = url.searchParams.get('v') ||
        path.match(/\/(?:shorts|live)\/([^/?#]+)/)?.[1] ||
        (url.hostname === 'youtu.be'
          ? path.slice(1).split('/')[0]
          : '');
    }
    return value ? `${adapterEntry.name}:${value}` : '';
  }

  function contentIdFromElement(target) {
    const adapter = depthAdapterEntry();
    if (!adapter || !isElement(target)) return '';
    const selector = adapter.candidates.join(',');
    const element = target.closest?.(selector) ||
      target.querySelector?.(selector);
    if (!element) return '';
    const attributes = {
      xiaohongshu: ['data-note-id'],
      douyin: ['data-aweme-id'],
      bilibili: ['data-bvid', 'data-aid'],
      youtube: [],
    }[adapter.name];
    for (const attribute of attributes) {
      const value = element.getAttribute?.(attribute);
      if (value) return `${adapter.name}:${value}`;
    }
    const href = element.getAttribute?.('href') ||
      element.querySelector?.('a[href]')?.getAttribute('href') || '';
    return contentIdFromUrl(href, adapter);
  }

  function isSearchResultsUrl(rawUrl) {
    const adapter = depthAdapterEntry();
    if (!adapter) return false;
    let url;
    try {
      url = new URL(rawUrl, global.location.href);
    } catch (error) {
      return false;
    }
    if (adapter.name === 'xiaohongshu') {
      return /\/search_result(?:\/|$)/.test(url.pathname);
    }
    if (adapter.name === 'douyin') {
      return /\/search(?:\/|$)/.test(url.pathname);
    }
    if (adapter.name === 'bilibili') {
      return /\/(?:s\/video|v_search)(?:\/|$)/.test(url.pathname);
    }
    return adapter.name === 'youtube' && url.pathname === '/results';
  }

  function currentPageContentId() {
    const adapter = depthAdapterEntry();
    if (!adapter) return '';
    for (const selector of adapter.details) {
      const elements = Array.from(
        global.document?.querySelectorAll?.(selector) || []
      );
      for (const element of elements.reverse()) {
        if (element.hasAttribute?.(DEPTH3_REJECTED_ATTR)) continue;
        const id = contentIdFromElement(element);
        if (id) return id;
      }
    }
    return contentIdFromUrl(global.location.href, adapter);
  }

  function updateNavigationContext(depth, contentId, extra = {}) {
    if (!navigationContext?.enabled) return;
    navigationContext = {
      ...navigationContext,
      depth,
      contentId: depth === 2 ? contentId : '',
      ...extra,
    };
    void sendMessage({
      type: 'UPDATE_SEARCH_SESSION_CONTEXT',
      depth: navigationContext.depth,
      contentId: navigationContext.contentId,
      contentUrl: navigationContext.contentUrl || '',
      resultUrl: navigationContext.resultUrl || '',
      pendingDepth: navigationContext.pendingDepth || depth,
      pendingContentId: navigationContext.pendingContentId || '',
      pendingContentUrl: navigationContext.pendingContentUrl || '',
    });
    applyDepth2Cleanup();
  }

  function clearDepth2Cleanup() {
    const page = global.document;
    for (const node of Array.from(
      page?.querySelectorAll?.(`[${DEPTH2_HIDDEN_ATTR}]`) || []
    )) {
      node.removeAttribute(DEPTH2_HIDDEN_ATTR);
    }
    page?.documentElement?.removeAttribute?.(NAVIGATION_DEPTH_ATTR);
  }

  function applyDepth2Cleanup() {
    clearDepth2Cleanup();
    const adapter = depthAdapterEntry();
    const root = global.document?.documentElement;
    if (
      !adapter ||
      navigationContext?.depth !== 2 ||
      !navigationContext.contentId
    ) {
      return;
    }
    root?.setAttribute?.(NAVIGATION_DEPTH_ATTR, '2');
    for (const selector of adapter.cleanup || []) {
      for (const node of Array.from(
        global.document?.querySelectorAll?.(selector) || []
      )) {
        node.setAttribute(DEPTH2_HIDDEN_ATTR, '');
      }
    }
  }

  function normalizeNavigationUrl(rawUrl) {
    try {
      return new URL(rawUrl, global.location.href).href;
    } catch (error) {
      return '';
    }
  }

  function markAllowedContentNavigation(
    contentId,
    opensNewContext,
    targetUrl
  ) {
    if (
      !navigationContext?.enabled ||
      navigationContext.depth !== 1 ||
      !contentId
    ) {
      return;
    }
    if (opensNewContext) {
      updateNavigationContext(1, '', {
        pendingDepth: 2,
        pendingContentId: contentId,
        pendingContentUrl: normalizeNavigationUrl(targetUrl),
      });
      return;
    }
    updateNavigationContext(2, contentId, {
      contentUrl:
        normalizeNavigationUrl(targetUrl) || global.location.href,
      resultUrl: navigationContext.resultUrl || global.location.href,
      pendingDepth: 2,
      pendingContentId: contentId,
      pendingContentUrl:
        normalizeNavigationUrl(targetUrl) || global.location.href,
    });
  }

  function isDepth3ContentTransition(context, contentId) {
    return Boolean(
      context?.enabled &&
      context.depth === 2 &&
      context.contentId &&
      contentId &&
      context.contentId !== contentId
    );
  }

  function depth3Match(contentId) {
    if (!isDepth3ContentTransition(navigationContext, contentId)) {
      return null;
    }
    return { kind: 'url', value: contentId, contentId };
  }

  function blockDepth3(event, match) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    recordDepth3Attempt(match);
  }

  function recordDepth3Attempt(match) {
    void sendMessage({
      type: 'RECORD_BLOCKING_EVENT',
      event: {
        id: eventId('depth3'),
        type: 'attemptedDepth3Navigation',
        domain: domain(),
        timestamp: now(),
        sessionId: navigationContext.sessionId || sessionId,
        fromContentId: navigationContext.contentId,
        toContentId: match.contentId,
      },
    });
    const timestamp = recordClick(match);
    if (timestamp) showFeedback(match, timestamp);
  }

  function shouldRestoreCommittedDepth3Url(
    currentUrlContentId,
    rejectedContentId,
    allowedUrl,
    currentUrl
  ) {
    return Boolean(
      currentUrlContentId &&
      currentUrlContentId === rejectedContentId &&
      allowedUrl &&
      currentUrl !== allowedUrl
    );
  }

  function rejectCommittedDepth3(contentId) {
    if (
      !contentId ||
      contentId === lastRejectedContentId ||
      !navigationContext?.contentId
    ) {
      return;
    }

    lastRejectedContentId = contentId;
    recordDepth3Attempt({
      kind: 'url',
      value: contentId,
      contentId,
    });

    const allowedUrl = normalizeNavigationUrl(
      navigationContext.contentUrl
    );
    const currentUrl = normalizeNavigationUrl(global.location.href);
    const adapter = depthAdapterEntry();
    const currentUrlContentId = contentIdFromUrl(
      global.location.href,
      adapter
    );
    if (
      shouldRestoreCommittedDepth3Url(
        currentUrlContentId,
        contentId,
        allowedUrl,
        currentUrl
      ) &&
      typeof global.location?.replace === 'function'
    ) {
      global.location.replace(allowedUrl);
      return;
    }

    for (const selector of adapter?.details || []) {
      for (const node of Array.from(
        global.document?.querySelectorAll?.(selector) || []
      )) {
        if (contentIdFromElement(node) !== contentId) continue;
        node.setAttribute?.(DEPTH3_REJECTED_ATTR, '');
        node.setAttribute?.('aria-hidden', 'true');
        node.style?.setProperty?.('display', 'none', 'important');
      }
    }
  }

  function interactionTargetUrl(target) {
    if (!isElement(target)) return '';
    const element = target.closest?.(
      'a[href], area[href], [data-href], [data-url]'
    );
    return element?.getAttribute?.('href') ||
      element?.getAttribute?.('data-href') ||
      element?.getAttribute?.('data-url') ||
      '';
  }

  function interactionOpensNewContext(event) {
    if (event.type === 'auxclick' || event.ctrlKey || event.metaKey) {
      return true;
    }
    const element = isElement(event.target)
      ? event.target.closest?.('a[href]')
      : null;
    return element?.target === '_blank';
  }

  function handleDepthInteraction(event) {
    if (!navigationContext?.enabled || !depthAdapterEntry()) return false;
    const contentId = contentIdFromElement(event.target);
    if (!contentId) return false;
    const blocked = depth3Match(contentId);
    if (blocked) {
      blockDepth3(event, blocked);
      return true;
    }
    markAllowedContentNavigation(
      contentId,
      interactionOpensNewContext(event),
      interactionTargetUrl(event.target)
    );
    return false;
  }

  function synchronizeDepthFromPage() {
    if (!navigationContext?.enabled || !depthAdapterEntry()) {
      clearDepth2Cleanup();
      return;
    }
    const contentId = currentPageContentId();
    if (contentId) {
      if (navigationContext.depth === 1) {
        markAllowedContentNavigation(
          contentId,
          false,
          global.location.href
        );
      } else {
        const blocked = depth3Match(contentId);
        if (blocked) {
          rejectCommittedDepth3(contentId);
          return;
        }
        lastRejectedContentId = '';
      }
      applyDepth2Cleanup();
      return;
    }
    if (
      navigationContext.depth === 2 &&
      isSearchResultsUrl(global.location.href)
    ) {
      updateNavigationContext(1, '', {
        contentUrl: '',
        pendingDepth: 1,
        pendingContentId: '',
        pendingContentUrl: '',
      });
      return;
    }
    applyDepth2Cleanup();
  }

  function findUrlMatch(rawUrl) {
    const direct = rulesApi.findUrlPattern(rawUrl, rules.blockedUrlPatterns);
    if (direct) return direct;
    const absolute = absoluteUrl(rawUrl);
    return rulesApi.findUrlPattern(absolute, rules.blockedUrlPatterns);
  }

  function markExposure(node, match) {
    const key = `${match.kind}:${match.value}`;
    if (node) {
      const seen = exposureMap.get(node) || new Set();
      if (seen.has(key)) return;
      seen.add(key);
      exposureMap.set(node, seen);
      node.setAttribute(BLOCKED_ATTR, '');
      if (match.kind === 'keyword') node.setAttribute(BLOCKED_KEYWORD_ATTR, match.value);
    } else {
      if (pageExposureRecorded.has(key)) return;
      pageExposureRecorded.add(key);
    }
    void sendMessage({
      type: 'RECORD_BLOCKING_EVENT',
      event: {
        id: eventId('exposure'),
        type: 'exposure',
        keyword: match.kind === 'keyword' ? match.value : '',
        urlPattern: match.kind === 'url' ? match.value : '',
        domain: domain(),
        timestamp: now(),
        sessionId,
      },
    });
  }

  function matchElement(element) {
    if (!isElement(element)) return null;
    const keyword = rulesApi.findKeyword(textForElement(element), rules.blockedKeywords);
    if (keyword) return { kind: 'keyword', value: keyword, element };
    const target = element.matches('a[href], area[href], [data-href], [data-url]')
      ? element.getAttribute('href') || element.getAttribute('data-href') || element.getAttribute('data-url')
      : '';
    const urlPattern = findUrlMatch(target);
    if (urlPattern) return { kind: 'url', value: urlPattern, element };
    return null;
  }

  function processElement(element) {
    if (!isElement(element)) return;
    if (isCandidate(element)) {
      const match = matchElement(element);
      if (match) markExposure(element, match);
    }
    for (const candidate of Array.from(element.querySelectorAll(CANDIDATE_SELECTOR))) {
      const match = matchElement(candidate);
      if (match) markExposure(candidate, match);
    }
  }

  function queueNode(node) {
    if (node?.nodeType === Node.ELEMENT_NODE) queuedNodes.add(node);
    else if (node?.parentElement) queuedNodes.add(node.parentElement);
  }

  function flushQueue() {
    flushScheduled = false;
    const nodes = Array.from(queuedNodes);
    queuedNodes.clear();
    for (const node of nodes) processElement(node);
    updatePageState();
    synchronizeDepthFromPage();
  }

  function scheduleNode(node) {
    queueNode(node);
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(flushQueue);
  }

  function recordExposureForPage(match) {
    if (match) markExposure(null, match);
  }

  function updatePageState() {
    const nextUrlPattern = findUrlMatch(global.location.href);
    const nextTitleKeyword = rulesApi.findKeyword(global.document.title || '', rules.blockedKeywords);
    currentUrlPattern = nextUrlPattern;
    currentTitleKeyword = nextTitleKeyword;
    pageIsBlocked = Boolean(currentUrlPattern || currentTitleKeyword);
    recordExposureForPage(currentUrlPattern && { kind: 'url', value: currentUrlPattern });
    recordExposureForPage(currentTitleKeyword && { kind: 'keyword', value: currentTitleKeyword });
    renderPageNotice();
    synchronizeDepthFromPage();
  }

  function canCreateDocumentNodes() {
    return typeof global.document?.getElementById === 'function' &&
      typeof global.document?.createElement === 'function';
  }

  function documentAppendTarget() {
    const target = global.document?.head ||
      global.document?.body ||
      global.document?.documentElement;
    return target && typeof target.appendChild === 'function' ? target : null;
  }

  function installStyle() {
    if (!canCreateDocumentNodes()) return;
    if (global.document.getElementById(STYLE_ID)) return;
    const target = documentAppendTarget();
    if (!target) return;
    const style = global.document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [${BLOCKED_ATTR}] {
        outline: 2px solid rgba(180, 30, 30, 0.7) !important;
        outline-offset: -2px !important;
        cursor: not-allowed !important;
        filter: blur(6px) grayscale(1) !important;
        opacity: 0.18 !important;
        user-select: none !important;
      }
      #${NOTICE_ID} {
        position: fixed !important;
        top: 6px !important;
        right: 8px !important;
        z-index: 2147483646 !important;
        max-width: min(360px, calc(100vw - 16px)) !important;
        padding: 6px 8px !important;
        border: 1px solid #000 !important;
        background: #fff !important;
        color: #111 !important;
        font: 14px/1.2 Arial, sans-serif !important;
        pointer-events: none !important;
      }
      #${NOTICE_ID}.feedback {
        top: 18px !important;
        right: 18px !important;
        max-width: min(460px, calc(100vw - 36px)) !important;
        padding: 12px 16px !important;
        border: 3px solid #8b0000 !important;
        border-radius: 6px !important;
        background: #fff1f1 !important;
        color: #8b0000 !important;
        font: bold 16px/1.35 Arial, sans-serif !important;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.38) !important;
      }
      html.mysearch-blocking-grayout {
        filter: grayscale(0.85) !important;
      }
      html.mysearch-blocking-feedback-flash::before {
        content: "已阻断" !important;
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483645 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-sizing: border-box !important;
        border: 12px solid rgba(150, 0, 0, 0.82) !important;
        background:
          repeating-linear-gradient(
            -45deg,
            rgba(150, 0, 0, 0.13) 0,
            rgba(150, 0, 0, 0.13) 18px,
            rgba(255, 255, 255, 0.08) 18px,
            rgba(255, 255, 255, 0.08) 36px
          ) !important;
        color: rgba(120, 0, 0, 0.9) !important;
        font: bold min(11vw, 72px)/1 Arial, sans-serif !important;
        pointer-events: none !important;
      }
      #mysearch-blocking-feedback-image {
        position: fixed !important;
        top: 50% !important;
        left: 50% !important;
        z-index: 2147483647 !important;
        width: min(42vw, 220px) !important;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 22px !important;
        background: transparent !important;
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.42) !important;
        opacity: 0 !important;
        visibility: hidden !important;
        transform: translate(-50%, -50%) scale(0.92) !important;
        transition:
          opacity 90ms ease-out,
          transform 90ms ease-out !important;
        pointer-events: none !important;
      }
      #mysearch-blocking-feedback-image.visible {
        opacity: 1 !important;
        visibility: visible !important;
        transform: translate(-50%, -50%) scale(1) !important;
      }
      [${DEPTH2_HIDDEN_ATTR}] {
        display: none !important;
        visibility: hidden !important;
        pointer-events: none !important;
      }
    `;
    target.appendChild(style);
  }

  function renderPageNotice() {
    if (!canCreateDocumentNodes()) return;
    if (!pageIsBlocked) {
      global.document.getElementById(NOTICE_ID)?.remove();
      return;
    }
    installStyle();
    let notice = global.document.getElementById(NOTICE_ID);
    if (!notice) {
      const target = documentAppendTarget();
      if (!target) return;
      notice = global.document.createElement('div');
      notice.id = NOTICE_ID;
      notice.setAttribute('role', 'status');
      target.appendChild(notice);
    }
    notice.textContent = currentUrlPattern
      ? '当前地址已阻断，本次访问已记录。'
      : '当前页面标题包含已阻断内容，本次访问已记录。';
  }

  function getInteractionMatch(target) {
    if (currentUrlPattern) return { kind: 'url', value: currentUrlPattern };
    if (currentTitleKeyword) return { kind: 'keyword', value: currentTitleKeyword };

    const adapter = depthAdapterEntry();
    const adapterSelector = adapter?.candidates?.join(',');
    const adapterCard = adapterSelector && isElement(target)
      ? target.closest?.(adapterSelector)
      : null;
    if (adapterCard) {
      const keyword = rulesApi.findKeyword(
        textForElement(adapterCard),
        rules.blockedKeywords
      );
      if (keyword) {
        return {
          kind: 'keyword',
          value: keyword,
          element: adapterCard,
        };
      }
    }

    let element = isElement(target) ? target : target?.parentElement;
    for (let depth = 0; element && depth < 9; depth += 1, element = element.parentElement) {
      const href = element.matches?.('a[href], area[href], [data-href], [data-url]')
        ? element.getAttribute('href') || element.getAttribute('data-href') || element.getAttribute('data-url')
        : '';
      const urlPattern = findUrlMatch(href);
      if (urlPattern) return { kind: 'url', value: urlPattern, element };
      if (isLikelyClickable(element)) {
        const keyword = rulesApi.findKeyword(textForElement(element), rules.blockedKeywords);
        if (keyword) return { kind: 'keyword', value: keyword, element };
      }
    }
    return null;
  }

  function allowDeduplicatedAttempt(match) {
    const key = `${match.kind}:${match.value}`;
    const previous = recentAttempts.get(key) || 0;
    const current = now();
    if (current - previous < DEDUPLICATION_WINDOW_MS) return false;
    recentAttempts.set(key, current);
    if (recentAttempts.size > 100) {
      for (const [oldKey, timestamp] of recentAttempts) {
        if (current - timestamp >= DEDUPLICATION_WINDOW_MS) recentAttempts.delete(oldKey);
      }
    }
    return true;
  }

  function recordClick(match) {
    const timestamp = now();
    if (!allowDeduplicatedAttempt(match)) return timestamp;
    blockedClickCount += 1;
    void sendMessage({
      type: 'RECORD_BLOCKING_EVENT',
      event: {
        id: eventId('click'),
        type: 'click',
        keyword: match.kind === 'keyword' ? match.value : '',
        urlPattern: match.kind === 'url' ? match.value : '',
        domain: domain(),
        timestamp,
        sessionId,
      },
    });
    return timestamp;
  }

  function showFeedback(match, timestamp) {
    const current = timestamp || now();
    showTemporaryNotice(
      `警告：内容已阻断，本次尝试已记录（第 ${blockedClickCount} 次）。`
    );
    flashBlockingFeedback();
    showBlockingImageFeedback();

    if (current - lastFeedbackAt < 300) return;

    const feedbackType = 'warning+beep+flash+image';
    const interval = lastAttemptAt == null ? null : current - lastAttemptAt;
    if (lastFeedbackEventId && interval != null) {
      void sendMessage({
        type: 'UPDATE_FEEDBACK_OUTCOME',
        eventId: lastFeedbackEventId,
        nextBlockedAttemptInterval: interval,
        whetherRetriedWithin10Minutes: interval <= 10 * 60 * 1000,
      });
    }
    lastAttemptAt = current;
    lastFeedbackAt = current;
    lastFeedbackEventId = eventId('feedback');
    void sendMessage({
      type: 'RECORD_BLOCKING_EVENT',
      event: {
        id: lastFeedbackEventId,
        type: 'feedback',
        feedbackType,
        keyword: match.kind === 'keyword' ? match.value : '',
        urlPattern: match.kind === 'url' ? match.value : '',
        timestamp: current,
        nextBlockedAttemptInterval: null,
        whetherRetriedWithin10Minutes: null,
        sessionId,
      },
    });

    playBeep();
  }

  function flashBlockingFeedback() {
    const root = global.document?.documentElement;
    if (!root?.classList) return;
    root.classList.add('mysearch-blocking-feedback-flash');
    global.clearTimeout(flashBlockingFeedback.timer);
    flashBlockingFeedback.timer = global.setTimeout(() => {
      root.classList.remove('mysearch-blocking-feedback-flash');
    }, 650);
  }

  function showBlockingImageFeedback() {
    if (!canCreateDocumentNodes()) return;
    const target = documentAppendTarget();
    if (!target) return;

    let image = global.document.getElementById(
      'mysearch-blocking-feedback-image'
    );
    if (!image) {
      image = global.document.createElement('img');
      image.id = 'mysearch-blocking-feedback-image';
      image.alt = '停止：内容已阻断';
      image.setAttribute('aria-hidden', 'true');
      image.src =
        'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">' +
          '<rect width="240" height="240" rx="24" fill="#fff"/>' +
          '<path d="M78 18h84l60 60v84l-60 60H78l-60-60V78z" ' +
          'fill="#c62828" stroke="#700000" stroke-width="8"/>' +
          '<rect x="58" y="96" width="124" height="48" rx="12" fill="#fff"/>' +
          '<text x="120" y="129" text-anchor="middle" ' +
          'font-family="Arial,sans-serif" font-size="28" font-weight="700" ' +
          'fill="#900000">STOP</text>' +
          '<text x="120" y="184" text-anchor="middle" ' +
          'font-family="sans-serif" font-size="22" font-weight="700" ' +
          'fill="#fff">已阻断</text>' +
          '</svg>'
        );
      target.appendChild(image);
    }

    image.classList.add('visible');
    global.clearTimeout(showBlockingImageFeedback.timer);
    showBlockingImageFeedback.timer = global.setTimeout(() => {
      image.classList.remove('visible');
    }, 1200);
  }

  function playBeep() {
    try {
      const AudioContextClass = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = 220;
      gain.gain.setValueAtTime(0.035, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        context.currentTime + 0.12
      );
      oscillator.connect(gain).connect(context.destination);
      const startTone = () => {
        oscillator.start();
        oscillator.stop(context.currentTime + 0.12);
      };
      if (context.state === 'suspended' &&
        typeof context.resume === 'function') {
        void context.resume().then(startTone).catch(() => {
          context.close?.().catch?.(() => {});
        });
      } else {
        startTone();
      }
      oscillator.addEventListener?.('ended', () => {
        context.close?.().catch?.(() => {});
      }, { once: true });
    } catch (error) {
      // 浏览器拒绝音频时，文字反馈仍然生效。
    }
  }

  function showTemporaryNotice(message) {
    if (!canCreateDocumentNodes()) return;
    installStyle();
    let notice = global.document.getElementById(NOTICE_ID);
    if (!notice) {
      const target = documentAppendTarget();
      if (!target) return;
      notice = global.document.createElement('div');
      notice.id = NOTICE_ID;
      notice.setAttribute('role', 'alert');
      target.appendChild(notice);
    }
    notice.classList.add('feedback');
    notice.textContent = message;
    global.clearTimeout(showTemporaryNotice.timer);
    showTemporaryNotice.timer = global.setTimeout(() => {
      notice.classList.remove('feedback');
      renderPageNotice();
    }, 1800);
  }

  function blockEvent(event, match) {
    if (!match) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const timestamp = recordClick(match);
    if (timestamp) showFeedback(match, timestamp);
  }

  function handleInteraction(event) {
    if (event.type === 'keydown' && !['Enter', ' ', 'Spacebar'].includes(event.key)) return;
    if (handleDepthInteraction(event)) return;
    const match = getInteractionMatch(event.target);
    blockEvent(event, match);
  }

  function handlePageNavigation(event) {
    if (navigationContext?.enabled && depthAdapterEntry()) {
      const contentId = contentIdFromUrl(event.detail?.url || '');
      const blocked = depth3Match(contentId);
      if (blocked) {
        blockDepth3(event, blocked);
        return;
      }
      markAllowedContentNavigation(
        contentId,
        event.detail?.navigationKind === 'window.open',
        event.detail?.url || ''
      );
    }
    const urlPattern = findUrlMatch(event.detail?.url || '');
    if (urlPattern) {
      event.preventDefault();
      const match = { kind: 'url', value: urlPattern };
      const timestamp = recordClick(match);
      if (timestamp) showFeedback(match, timestamp);
    }
  }

  function handleMediaAttempt(event) {
    if (navigationContext?.enabled && depthAdapterEntry()) {
      const contentId = currentPageContentId();
      const blocked = depth3Match(contentId);
      if (blocked) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        rejectCommittedDepth3(contentId);
        return;
      }
    }

    const match = getInteractionMatch(event.target);
    if (!match && !pageIsBlocked) return;
    blockEvent(event, match || {
      kind: currentUrlPattern ? 'url' : 'keyword',
      value: currentUrlPattern || currentTitleKeyword,
    });
  }

  function searchSessionIsForeground() {
    if (global.document?.visibilityState === 'hidden') return false;
    if (typeof global.document?.hasFocus === 'function') {
      return global.document.hasFocus();
    }
    return true;
  }

  function reportSearchSessionForeground() {
    if (!navigationContext?.enabled) return;
    void sendMessage({
      type: 'SET_SEARCH_SESSION_FOREGROUND',
      visible: searchSessionIsForeground(),
    }).then(response => {
      if (response?.enabled === false) {
        navigationContext = null;
        clearDepth2Cleanup();
      }
    });
  }

  function installObserver() {
    if (observer ||
      !global.document?.documentElement ||
      typeof global.MutationObserver !== 'function') return;
    observer = new global.MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) scheduleNode(node);
        if (mutation.removedNodes?.length) {
          scheduleNode(mutation.target);
        }
        if (mutation.type === 'characterData') scheduleNode(mutation.target);
      }
    });
    observer.observe(global.document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'href',
        'data-href',
        'data-url',
        'title',
        'aria-label',
        'data-title',
        'data-tooltip',
        'alt',
        'placeholder',
        'src',
      ],
    });
  }

  function applyRules(nextRules) {
    rules = rulesApi.normalizeRules(nextRules);
    rulesLoaded = true;
    currentUrlPattern = null;
    currentTitleKeyword = null;
    pageExposureRecorded = new Set();
    exposureMap = new WeakMap();
    updatePageState();
    if (global.document.body) processElement(global.document.body);
  }

  async function loadBlockingRules() {
    const response = await sendMessage({
      type: 'GET_BLOCKING_RULES',
    });
    if (response?.success === true && response.rules) {
      return response.rules;
    }
    if (
      rulesApi.isUnknownMessageResponse(
        response,
        'GET_BLOCKING_RULES'
      )
    ) {
      try {
        return await rulesApi.getRulesFromStorage();
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  function refreshBlockingRules() {
    void loadBlockingRules().then((nextRules) => {
      if (nextRules) applyRules(nextRules);
    });
  }

  function init() {
    installStyle();
    installObserver();
    if (typeof global.addEventListener === 'function') {
      for (const eventType of [
        'pointerdown',
        'click',
        'auxclick',
        'keydown',
      ]) {
        global.addEventListener(eventType, handleInteraction, true);
      }
      global.addEventListener(
        'mysearch-blocking-navigation-attempt',
        handlePageNavigation,
        true
      );
      global.addEventListener(MEDIA_EVENT, handleMediaAttempt, true);
      global.addEventListener('popstate', () => {
        updatePageState();
        synchronizeDepthFromPage();
      }, true);
      global.addEventListener('hashchange', () => {
        updatePageState();
        synchronizeDepthFromPage();
      }, true);
      global.addEventListener('pageshow', () => {
        updatePageState();
        synchronizeDepthFromPage();
      }, true);
      global.addEventListener('message', handleBlockingRuleRequest, false);
      global.addEventListener('message', handleSearchOpenRequest, false);
    }
    refreshBlockingRules();
    void sendMessage({ type: 'GET_SEARCH_SESSION_CONTEXT' }).then(response => {
      navigationContext = response?.enabled ? response : null;
      synchronizeDepthFromPage();
      if (navigationContext) {
        reportSearchSessionForeground();
      }
    });
    const initialRoot = global.document.body || global.document.documentElement;
    if (initialRoot) processElement(initialRoot);
    updatePageState();
  }

  global.chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[rulesApi.STORAGE_KEYS.KEYWORDS] ||
      changes[rulesApi.STORAGE_KEYS.URL_PATTERNS] ||
      changes[rulesApi.STORAGE_KEYS.HIGH_RISK_DOMAINS]) {
      refreshBlockingRules();
    }
  });

  init();
  if (global.document.readyState === 'loading') {
    if (typeof global.document.addEventListener === 'function') {
      global.document.addEventListener('DOMContentLoaded', () => {
        processElement(global.document.body || global.document.documentElement);
        updatePageState();
      }, { once: true });
    }
  }
  if (typeof global.document?.addEventListener === 'function') {
    global.document.addEventListener(
      'visibilitychange',
      reportSearchSessionForeground
    );
  }
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('focus', reportSearchSessionForeground, true);
    global.addEventListener('blur', reportSearchSessionForeground, true);
  }
})(globalThis);
