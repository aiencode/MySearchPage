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
  const BLOCKED_AUTHOR_ATTR = 'data-mysearch-blocked-author';
  const BLOCKED_CARD_ATTR = 'data-mysearch-blocked-card';
  const BLOCKED_CARD_KIND_ATTR = 'data-mysearch-blocked-card-kind';
  const BLOCKED_CARD_VALUE_ATTR = 'data-mysearch-blocked-card-value';
  const BLOCKED_CARD_PLACEHOLDER_CLASS =
    'mysearch-blocked-card-placeholder';
  const NOTICE_ID = 'mysearch-blocking-notice';
  const FEEDBACK_PAUSE_ID = 'mysearch-blocking-feedback-pause';
  const TRANSIENT_FEEDBACK_IMAGE_ID =
    'mysearch-blocking-feedback-image';
  const PERSISTENT_FEEDBACK_IMAGE_ID =
    'mysearch-blocking-page-gate-image';
  const PAGE_GATE_ATTR = 'data-mysearch-page-gate';
  const STYLE_ID = 'mysearch-blocking-style';
  const NAVIGATION_EVENT = 'mysearch-blocking-navigation-attempt';
  const MEDIA_EVENT = 'mysearch-blocking-media-attempt';
  const RULE_REQUEST_TYPE = 'MYSEARCH_BLOCKING_RULE_REQUEST';
  const RULE_RESPONSE_TYPE = 'MYSEARCH_BLOCKING_RULE_RESPONSE';
  const SEARCH_REQUEST_TYPE = 'MYSEARCH_SEARCH_OPEN_REQUEST';
  const SEARCH_RESPONSE_TYPE = 'MYSEARCH_SEARCH_OPEN_RESPONSE';
  const BLOCKING_ENABLED_STORAGE_KEY = 'blockingEnabled';
  const BLOCKING_RUNTIME_ATTR =
    'data-mysearch-blocking-runtime';
  const BLOCKING_RUNTIME_VERSION =
    'explicit-rules-switch-v1';
  // 当前先恢复基础模式：只按明确的关键词/网址/作者规则阻断。
  // 第二套“搜索会话 + 浏览层级”规则待逻辑统一后再重新启用。
  const DEPTH_NAVIGATION_ENFORCEMENT_ENABLED = false;
  const RULE_SCOPES = new Set(['keyword', 'url', 'author', 'both']);
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
        '[data-note-id-str]',
        '.note-item',
        '[class*="note-item"]',
        'a[href*="/explore/"]',
        'a[href*="/discovery/item/"]',
        'a[href*="/user/"]',
      ],
      searchRoots: [
        '.search-page .feeds-container',
        '.search-layout .feeds-container',
        '.feeds-container',
        '.search-result-list',
        '#search-results',
      ],
      details: [
        '.note-detail-mask',
        '.note-detail-container',
        '.note-detail',
        '[class*="note-detail-mask"]',
        '[class*="note-detail-container"]',
        '[class*="noteDetailMask"]',
        '[class*="noteDetailContainer"]',
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
        'a[href*="/user/"]',
      ],
      // 抖音同页详情关闭后，旧的 /video/... 地址可能暂时不变；
      // 这些结果流容器是判断“已经回到搜索结果”的页面证据。
      searchRoots: [
        '[data-e2e="search-result-container"]',
        '[data-e2e="search-results"]',
        '[data-e2e="search-result-list"]',
        '[data-e2e="search-video-list"]',
        '.search-result-list',
        '.search-result-container',
      ],
      details: [
        // 详情根可能先插入，data-aweme-id 稍后才挂载。
        // 不能在这段窗口内把详情视觉容器重新当成搜索结果卡片。
        // 抖音详情采用纵向滑动播放器；预加载的下一个 feed-item
        // 不一定带有 feed-active-video，但仍属于同一个详情播放器。
        '[data-e2e="modal-video-container"]',
        '#slidelist',
        '[data-e2e="slideList"]',
        '[data-e2e="feed-item"]',
        '[data-e2e="feed-active-video"]',
        '[data-e2e="video-detail"]',
        '[data-e2e="modal-video"]',
        '[role="dialog"] video',
        '[aria-modal="true"] video',
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
        'a[href*="/space/"]',
        'a[href*="/channel/"]',
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
        'a[href*="/channel/"]',
        'a[href*="/@"]',
        'a[href*="/c/"]',
        'a[href*="/user/"]',
        'a[href*="/feed/"]',
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
    'input',
    'textarea',
    'select',
    'summary',
    'article',
    'li',
    'img',
    'picture',
    'video',
    'label',
    'span',
    'option',
    '[role="link"]',
    '[role="button"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="tab"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
    '[aria-label]',
    '[aria-description]',
    '[title]',
    '[data-title]',
    '[data-tooltip]',
    '[data-label]',
    '[data-name]',
    '[data-href]',
    '[data-url]',
    '[onclick]',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'p',
    '[class*="title"]',
    '[class*="name"]',
    '[class*="desc"]',
  ].join(',');
  const INTERACTIVE_SELECTOR = [
    'a[href]',
    'area[href]',
    'button',
    'input',
    'textarea',
    'select',
    'summary',
    '[role="link"]',
    '[role="button"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="tab"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
    '[onclick]',
    '[data-href]',
    '[data-url]',
  ].join(',');
  const MEDIA_SELECTOR = [
    'img', 'picture', 'video', 'canvas',
    '[style*="background-image"]',
  ].join(',');
  const DEDUPLICATION_WINDOW_MS = 2000;
  const NEGATIVE_FEEDBACK_ASSETS = Object.freeze([
    'content/feedback-assets/moldy-fruit.png',
    'content/feedback-assets/clogged-drain.png',
    'content/feedback-assets/greasy-pan.png',
    'content/feedback-assets/dirty-wastewater.png',
  ]);
  const FALLBACK_FEEDBACK_IMAGE =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220">' +
    '<rect width="320" height="220" fill="#4f5b52"/>' +
    '<ellipse cx="160" cy="112" rx="112" ry="64" fill="#26302b"/>' +
    '<g fill="#b7c58b"><circle cx="92" cy="92" r="21"/><circle cx="135" cy="136" r="16"/><circle cx="194" cy="88" r="18"/><circle cx="225" cy="132" r="13"/></g>' +
    '<g fill="#71814b"><circle cx="92" cy="92" r="8"/><circle cx="135" cy="136" r="6"/><circle cx="194" cy="88" r="7"/></g>' +
    '<text x="160" y="201" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#fff">已阻断，停止点击</text>' +
    '</svg>';

  let rules = rulesApi.normalizeRules();
  let blockingEnabled = false;
  let rulesLoaded = false;
  let observer = null;
  let queuedNodes = new Set();
  let flushScheduled = false;
  let currentUrlPattern = null;
  let currentTitleKeyword = null;
  let currentSearchMatch = null;
  let pageIsBlocked = false;
  let pageExposureRecorded = new Set();
  let exposureMap = new WeakMap();
  const blockedCards = new Set();
  const blockedCardStates = new WeakMap();
  let recentAttempts = new Map();
  let blockedClickCount = 0;
  let lastFeedbackEventId = null;
  let lastAttemptAt = null;
  let navigationContext = null;
  let lastRejectedContentId = '';
  let syntheticDetailIds = new WeakMap();
  let syntheticDetailSequence = 0;
  let feedbackPauseUntil = 0;
  let feedbackPauseTimer = null;
  let feedbackPauseInterval = null;
  let persistentPageGateMatch = null;
  let activePageViewKey = '';
  let douyinHistoryContext = '';

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
    if (!(await loadBlockingEnabled())) {
      const openedWindow = global.open?.(targetUrl, '_blank');
      return {
        success: Boolean(openedWindow),
        opened: Boolean(openedWindow),
        blocked: false,
        sessionEnabled: false,
        sessionId: '',
        ...(openedWindow ? {} : {
          error: '浏览器阻止了新标签页，请允许弹出窗口后重试',
        }),
      };
    }
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

  function isVisiblePageElement(element) {
    if (!element) return false;
    for (
      let current = element;
      current;
      current = current.parentElement
    ) {
      if (current.hasAttribute?.('hidden') ||
        current.getAttribute?.('aria-hidden') === 'true') {
        return false;
      }
      try {
        const style = global.getComputedStyle?.(current);
        if (style?.display === 'none' || style?.visibility === 'hidden') {
          return false;
        }
      } catch (error) {
        // 页面样式尚未就绪时，继续依靠其他祖先的 hidden/aria-hidden 证据。
      }
    }
    return true;
  }

  function textForElement(element) {
    if (!isElement(element)) return '';
    const attributes = [
      'aria-label',
      'aria-description',
      'title',
      'data-title',
      'data-tooltip',
      'data-label',
      'data-name',
      'name',
      'value',
      'alt',
      'placeholder',
    ].map((name) => element.getAttribute(name) || '');
    return [element.textContent || '', ...attributes].filter(Boolean).join('\n');
  }

  function searchMediaAdapterForDomain() {
    const hostname = domain().toLowerCase().replace(/^www\./, '');
    return Array.isArray(global.SearchMediaAdapters)
      ? global.SearchMediaAdapters.find((entry) => {
        const entryDomain = String(entry?.domain || '')
          .toLowerCase()
          .replace(/^www\./, '');
        return entryDomain && (
          hostname === entryDomain || hostname.endsWith(`.${entryDomain}`)
        );
      })
      : null;
  }

  function detailSelectorForAdapter(
    adapterEntry = depthAdapterEntry()
  ) {
    const selectors = [];

    if (Array.isArray(adapterEntry?.details)) {
      selectors.push(...adapterEntry.details);
    }

    const mediaAdapter = searchMediaAdapterForDomain();
    if (
      typeof mediaAdapter?.details === 'string' &&
      mediaAdapter.details.trim()
    ) {
      selectors.push(mediaAdapter.details);
    }

    return selectors.filter(Boolean).join(',');
  }

  function detailRootForElement(
    element,
    adapterEntry = depthAdapterEntry()
  ) {
    if (!isElement(element)) return null;

    const selector = detailSelectorForAdapter(adapterEntry);
    if (!selector) return null;

    try {
      if (element.matches?.(selector)) return element;
      return element.closest?.(selector) || null;
    } catch (error) {
      return null;
    }
  }

  function resultRuleSelectors(adapterEntry, field, fallback) {
    const adapter = searchMediaAdapterForDomain();
    const selectors = adapter?.[field];
    return Array.isArray(selectors) && selectors.length
      ? selectors
      : fallback;
  }

  function searchMediaCardSelector(adapterEntry = depthAdapterEntry()) {
    const hostname = domain().toLowerCase().replace(/^www\./, '');
    const mediaAdapter = Array.isArray(global.SearchMediaAdapters)
      ? global.SearchMediaAdapters.find((entry) => {
        const entryDomain = String(entry?.domain || '')
          .toLowerCase()
          .replace(/^www\./, '');
        return entryDomain && (
          hostname === entryDomain || hostname.endsWith(`.${entryDomain}`)
        );
      })
      : null;
    const fallbackSelectors = {
      bilibili: [
        '.bili-video-card', '.video-item', '.video-list-item',
        '.bili-user-card', '.user-item', '.live-user-item',
        '.live-room-item', '.bangumi-item', '.media-card',
      ],
      youtube: [
        'ytd-video-renderer', 'ytd-grid-video-renderer',
        'ytd-channel-renderer', 'ytd-playlist-renderer',
        'ytd-radio-renderer', 'ytd-reel-item-renderer',
        'ytd-rich-item-renderer', 'ytm-video-with-context-renderer',
        'ytm-compact-video-renderer', 'ytm-video-card-renderer',
        'ytm-channel-list-item-renderer', 'ytm-playlist-card-renderer',
        'ytm-media-item', 'ytm-shorts-lockup-view-model',
        'yt-lockup-view-model', 'yt-shorts-lockup-view-model',
      ],
      xiaohongshu: [
        'section.note-item', '.note-item', 'section[data-note-id]',
        '.search-user-item',
      ],
      douyin: [
        '[data-e2e="search-result-item"]',
        '[data-e2e="search-video-item"]',
        '[data-e2e="search-video-card"]',
        '[data-e2e="search-card"]',
        '[data-e2e="search-user-item"]',
        '[data-e2e="search-live-item"]',
        '[data-e2e="video-card"]',
        '[data-e2e="search-result-video"]',
        '[data-e2e="search-video-list"] > li',
        '[data-e2e="search-result-list"] > li',
        '[data-e2e="search-results"] > li',
        '[data-e2e="search-result-container"] > li',
        '[data-e2e*="search-result-item"]',
        '[data-e2e*="search-video-item"]',
        '[data-e2e*="search-video-card"]',
        '[data-e2e*="search-card"]',
        '[class*="search-result-item"]',
        '[class*="search-card"]',
        '[class*="video-card"]',
        '[class*="result-item"]',
        '.search-result-card', '.search-card', '.video-card',
      ],
    }[adapterEntry?.name] || [];
    return [mediaAdapter?.cards || '', ...fallbackSelectors]
      .filter(Boolean)
      .join(',');
  }

  function searchMediaRootSelector(adapterEntry = depthAdapterEntry()) {
    const hostname = domain().toLowerCase().replace(/^www\./, '');
    const mediaAdapter = Array.isArray(global.SearchMediaAdapters)
      ? global.SearchMediaAdapters.find((entry) => {
        const entryDomain = String(entry?.domain || '')
          .toLowerCase()
          .replace(/^www\./, '');
        return entryDomain && (
          hostname === entryDomain || hostname.endsWith(`.${entryDomain}`)
        );
      })
      : null;
    return [
      mediaAdapter?.roots || '',
      ...(adapterEntry?.searchRoots || []),
    ].filter(Boolean).join(',');
  }

  function hasResultMedia(element) {
    if (!isElement(element)) return false;
    const mediaSelector = [
      'img', 'picture', 'video', 'canvas', 'svg',
      '[style*="background-image"]',
      '[class*="cover"]', '[class*="poster"]', '[class*="thumb"]',
    ].join(',');
    return Boolean(
      element.matches?.(mediaSelector) ||
      element.querySelector?.(mediaSelector)
    );
  }

  function hasResultLink(element) {
    if (!isElement(element)) return false;
    const linkSelector = [
      'a[href]', '[role="link"]', '[data-href]', '[data-url]',
    ].join(',');
    return Boolean(
      element.matches?.(linkSelector) ||
      element.querySelector?.(linkSelector)
    );
  }

  function resultLinkCount(element) {
    if (!isElement(element)) return 0;
    return element.querySelectorAll?.(
      'a[href], [role="link"], [data-href], [data-url]'
    )?.length || 0;
  }

  function isBlockingFeedbackNode(element) {
    if (!isElement(element)) return false;
    if (element.id && String(element.id).startsWith('mysearch-blocking-')) {
      return true;
    }
    return Boolean(element.closest?.(
      '#mysearch-blocking-notice, #mysearch-blocking-feedback-pause, ' +
      '#mysearch-blocking-feedback-image, #mysearch-blocking-page-gate-image'
    ));
  }

  function directTextForElement(element) {
    if (!isElement(element)) return '';
    return Array.from(element.childNodes || [])
      .filter(node => node?.nodeType === 3)
      .map(node => node.textContent || '')
      .join(' ')
      .trim();
  }

  function isCompactTextComponent(element) {
    if (!isElement(element) || isBlockingFeedbackNode(element)) return false;
    const tagName = String(element.tagName || '').toUpperCase();
    if (!['DIV', 'SPAN', 'LABEL', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']
      .includes(tagName)) {
      return false;
    }
    const text = String(element.textContent || '').trim();
    if (!text || text.length > 600) return false;
    const childCount = element.children?.length || 0;
    if (tagName === 'DIV' && childCount > 3) return false;
    return childCount === 0 || Boolean(
      directTextForElement(element) ||
      element.matches?.(INTERACTIVE_SELECTOR) ||
      element.getAttribute?.('role')
    );
  }

  function isGenericBlockingCandidate(element) {
    if (!isElement(element) || isBlockingFeedbackNode(element)) return false;
    if (element.matches?.(CANDIDATE_SELECTOR)) return true;
    return isCompactTextComponent(element);
  }

  function genericResultCardForElement(element, adapterEntry) {
    if (!isElement(element) || isBlockingFeedbackNode(element)) return null;

    const rootSelector = adapterEntry
      ? searchMediaRootSelector(adapterEntry)
      : '';
    const knownRoot = rootSelector
      ? element.closest?.(rootSelector)
      : null;
    const pageRoot = knownRoot || global.document?.body || null;
    const details = (adapterEntry?.details || []).join(',');
    let current = element;
    let linkFallback = null;
    for (let depth = 0; current && depth < 14; depth += 1) {
      if (!isElement(current)) break;
      if (details && current.closest?.(details)) break;
      if (current.closest?.('header, nav, aside, [role="navigation"]') &&
          !current.matches?.(INTERACTIVE_SELECTOR)) break;
      if (current === pageRoot || current === global.document?.documentElement) {
        break;
      }

      const tagName = String(current.tagName || '').toUpperCase();
      const textLength = String(current.textContent || '').trim().length;
      const hasMedia = hasResultMedia(current);
      const hasLink = hasResultLink(current);
      const links = resultLinkCount(current);
      const semanticCard = tagName === 'ARTICLE' || tagName === 'LI';
      const hasSiblingContent = (current.children?.length || 0) >= 2;
      const isTooBroad = textLength > 1200 || links > 8;
      const isContentComponent = hasMedia || semanticCard ||
        (hasLink && hasSiblingContent && depth > 0);
      const isCardShape = isContentComponent && hasLink && textLength >= 2 &&
        !isTooBroad && (semanticCard || hasSiblingContent || depth > 0);

      // 不依赖平台的控件编号：具备“媒体 + 内容链接 + 少量文字”
      // 的结果组件结构，就认为是可替换的结果卡片。
      if (isCardShape && tagName !== 'A' && tagName !== 'IMG') {
        return current;
      }
      if (isCardShape && !linkFallback) linkFallback = current;
      current = current.parentElement;
    }
    return linkFallback;
  }

  function genericBlockingComponentForElement(element, adapterEntry) {
    if (!isElement(element) || isBlockingFeedbackNode(element)) return null;
    if (element.matches?.(MEDIA_SELECTOR)) return element;
    const card = genericResultCardForElement(element, adapterEntry);
    if (card && card !== global.document?.body &&
        card !== global.document?.documentElement) {
      return card;
    }

    let current = element;
    for (let depth = 0; current && depth < 10; depth += 1) {
      if (!isElement(current) || isBlockingFeedbackNode(current)) break;
      if (current === global.document?.body ||
          current === global.document?.documentElement) break;
      if (current.matches?.(INTERACTIVE_SELECTOR)) return current;

      const tagName = String(current.tagName || '').toUpperCase();
      const semanticComponent = [
        'ARTICLE', 'LI', 'SECTION', 'DETAILS', 'DIALOG',
      ].includes(tagName) || Boolean(current.getAttribute?.('role'));
      const textLength = String(current.textContent || '').trim().length;
      if (depth > 0 && semanticComponent && textLength <= 1200) {
        return current;
      }
      if (depth === 0 && isCompactTextComponent(current)) {
        const interactiveParent = current.parentElement?.closest?.(
          INTERACTIVE_SELECTOR
        );
        return interactiveParent || current;
      }

      const hasComponentContent = hasResultMedia(current) &&
        (hasResultLink(current) || current.matches?.(INTERACTIVE_SELECTOR));
      if (depth > 0 && hasComponentContent && textLength <= 1200) {
        return current;
      }
      current = current.parentElement;
    }
    return isCompactTextComponent(element) ||
      element.matches?.(CANDIDATE_SELECTOR)
      ? element
      : null;
  }

  function fallbackResultCardForElement(element, adapterEntry) {
    const genericCard = genericResultCardForElement(element, adapterEntry);
    if (genericCard) return genericCard;

    const rootSelector = searchMediaRootSelector(adapterEntry);
    if (!rootSelector) return null;
    const root = element.closest?.(rootSelector);
    if (!root || root === element || !isVisiblePageElement(root)) return null;
    const detailSelector = (adapterEntry?.details || []).join(',');
    const mediaSelector = 'img, picture, video, canvas, [style*="background"]';
    let current = element;
    while (current && current !== root) {
      if (!isElement(current)) break;
      const dataE2e = current.getAttribute?.('data-e2e') || '';
      const className = typeof current.className === 'string'
        ? current.className
        : '';
      const namedCard = /search|result|video|card|item|user|live/i.test(
        `${dataE2e} ${className}`
      );
      const semanticCard = /^(ARTICLE|LI)$/.test(current.tagName || '');
      const hasMedia = Boolean(
        current.matches?.(mediaSelector) || current.querySelector?.(mediaSelector)
      );
      const hasLink = Boolean(
        current.matches?.('a[href]') || current.querySelector?.('a[href]')
      );
      const inDetail = detailSelector && current.closest?.(detailSelector);
      const inNavigation = current.closest?.('header, nav, aside, [role="navigation"]');
      if (!inDetail && !inNavigation && hasMedia && hasLink &&
          (semanticCard || namedCard || current.matches?.('a[href]'))) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function resultCardForElement(element, adapterEntry = depthAdapterEntry()) {
    if (
      !isElement(element) ||
      isBlockingFeedbackNode(element) ||
      detailRootForElement(element, adapterEntry)
    ) {
      return null;
    }
    const blockedAncestor = element.closest?.(`[${BLOCKED_CARD_ATTR}]`);
    if (blockedAncestor) return blockedAncestor;
    const cardSelector = adapterEntry
      ? searchMediaCardSelector(adapterEntry)
      : '';
    const card = (cardSelector && element.closest?.(cardSelector)) ||
      (adapterEntry && fallbackResultCardForElement(element, adapterEntry)) ||
      genericBlockingComponentForElement(element, adapterEntry);
    if (!card || !isVisiblePageElement(card)) return null;
    if (detailRootForElement(card, adapterEntry)) return null;
    if (card.closest?.('header, nav, aside, [role="navigation"]') &&
        !card.matches?.(INTERACTIVE_SELECTOR)) return null;
    return card;
  }

  function resultCardsInElement(element, adapterEntry = depthAdapterEntry()) {
    if (!isElement(element) || !adapterEntry) return [];
    const cardSelector = searchMediaCardSelector(adapterEntry);
    if (!cardSelector) return [];
    const cards = [];
    if (element.matches?.(cardSelector)) cards.push(element);
    for (const card of Array.from(
      element.querySelectorAll?.(cardSelector) || []
    )) {
      if (!cards.includes(card)) cards.push(card);
    }
    return cards.filter((card) => resultCardForElement(card, adapterEntry));
  }

  function makeBlockedCardPlaceholder(match) {
    if (!canCreateDocumentNodes()) return null;
    const placeholder = global.document.createElement('div');
    placeholder.className = BLOCKED_CARD_PLACEHOLDER_CLASS;
    placeholder.setAttribute('role', 'status');
    placeholder.setAttribute('aria-label', '内容已屏蔽');
    placeholder.textContent = '已屏蔽';
    placeholder.dataset.mysearchBlockedCardKind = match.kind;
    return placeholder;
  }

  function hideBlockedCard(card, match) {
    if (!isElement(card) || !match) return false;
    const existing = blockedCardStates.get(card);
    if (existing) {
      if (existing.leaf) {
        if (card.parentNode) {
          existing.parent = card.parentNode;
          existing.nextSibling = card.nextSibling;
          existing.parent.replaceChild(existing.placeholder, card);
        }
        if (existing.placeholder?.parentNode === existing.parent) {
          // 已经是占位节点，不重复插入原控件。
        } else if (card.parentNode !== existing.parent && existing.parent) {
          existing.parent.insertBefore(card, existing.nextSibling || null);
        }
        card.setAttribute(BLOCKED_CARD_ATTR, '');
        card.setAttribute(BLOCKED_CARD_KIND_ATTR, match.kind);
        card.setAttribute(BLOCKED_CARD_VALUE_ATTR, match.value);
        return true;
      }
      for (const child of Array.from(card.childNodes || [])) {
        if (child !== existing.placeholder) card.removeChild?.(child);
      }
      if (!existing.placeholder.parentNode) card.appendChild(existing.placeholder);
      card.setAttribute(BLOCKED_CARD_KIND_ATTR, match.kind);
      card.setAttribute(BLOCKED_CARD_VALUE_ATTR, match.value);
      return true;
    }
    const placeholder = makeBlockedCardPlaceholder(match);
    if (!placeholder) return false;
    const isLeafControl = /^(INPUT|TEXTAREA|SELECT|OPTION|IMG|VIDEO|CANVAS)$/.test(
      String(card.tagName || '').toUpperCase()
    );
    if (isLeafControl && card.parentNode) {
      const parent = card.parentNode;
      const nextSibling = card.nextSibling;
      parent.replaceChild(placeholder, card);
      blockedCardStates.set(card, {
        leaf: true,
        parent,
        nextSibling,
        placeholder,
      });
      blockedCards.add(card);
      card.setAttribute(BLOCKED_CARD_ATTR, '');
      card.setAttribute(BLOCKED_CARD_KIND_ATTR, match.kind);
      card.setAttribute(BLOCKED_CARD_VALUE_ATTR, match.value);
      return true;
    }
    const childNodes = Array.from(card.childNodes || []);
    const attributes = new Map();
    for (const name of [
      'aria-label', 'aria-description', 'title', 'data-title',
      'data-tooltip', 'data-label', 'data-name', 'href', 'data-href',
      'data-url', 'onclick', 'tabindex',
    ]) {
      if (card.hasAttribute?.(name)) attributes.set(name, card.getAttribute(name));
      card.removeAttribute?.(name);
    }
    for (const child of childNodes) card.removeChild?.(child);
    card.appendChild(placeholder);
    card.setAttribute(BLOCKED_CARD_ATTR, '');
    card.setAttribute(BLOCKED_CARD_KIND_ATTR, match.kind);
    card.setAttribute(BLOCKED_CARD_VALUE_ATTR, match.value);
    blockedCardStates.set(card, { childNodes, attributes, placeholder });
    blockedCards.add(card);
    return true;
  }

  function restoreBlockedCards() {
    for (const card of blockedCards) {
      const state = blockedCardStates.get(card);
      if (!state) continue;
      if (state.leaf) {
        if (state.placeholder?.parentNode === state.parent) {
          state.parent.replaceChild(card, state.placeholder);
        } else if (state.parent) {
          state.parent.insertBefore(card, state.nextSibling || null);
        }
        card.removeAttribute?.(BLOCKED_CARD_ATTR);
        card.removeAttribute?.(BLOCKED_CARD_KIND_ATTR);
        card.removeAttribute?.(BLOCKED_CARD_VALUE_ATTR);
        blockedCardStates.delete(card);
        continue;
      }
      for (const child of Array.from(card.childNodes || [])) {
        card.removeChild?.(child);
      }
      for (const child of state.childNodes) card.appendChild?.(child);
      for (const [name, value] of state.attributes) {
        card.setAttribute?.(name, value);
      }
      card.removeAttribute?.(BLOCKED_CARD_ATTR);
      card.removeAttribute?.(BLOCKED_CARD_KIND_ATTR);
      card.removeAttribute?.(BLOCKED_CARD_VALUE_ATTR);
      blockedCardStates.delete(card);
    }
    blockedCards.clear();
  }

  function processMatchedElement(element, match) {
    const card = resultCardForElement(element);
    if (card && hideBlockedCard(card, match)) {
      markExposure(card, { ...match, element: card });
      return;
    }
    markExposure(element, match);
  }

  function blockedCardMatch(card) {
    if (!isElement(card) || !card.hasAttribute?.(BLOCKED_CARD_ATTR)) {
      return null;
    }
    return {
      kind: card.getAttribute(BLOCKED_CARD_KIND_ATTR) || 'keyword',
      value: card.getAttribute(BLOCKED_CARD_VALUE_ATTR) || 'blocked-card',
      element: card,
    };
  }

  function isCandidate(element) {
    return isGenericBlockingCandidate(element);
  }

  function blockingCandidatesInElement(element) {
    if (!isElement(element)) return [];
    const candidates = [];
    const add = candidate => {
      const adapter = depthAdapterEntry();
      if (detailRootForElement(candidate, adapter)) return;
      const cardSelector = adapter ? searchMediaCardSelector(adapter) : '';
      if (cardSelector && candidate.closest?.(cardSelector)) return;
      if (isGenericBlockingCandidate(candidate) && !candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    };
    add(element);
    for (const candidate of Array.from(
      element.querySelectorAll?.(CANDIDATE_SELECTOR) || []
    )) {
      add(candidate);
    }
    // 没有语义标签的网页控件经常只是一个短文本 div；只扫描紧凑节点，
    // 不把整个页面的大容器当成一个控件。
    for (const candidate of Array.from(
      element.querySelectorAll?.('div') || []
    )) {
      add(candidate);
    }
    return candidates;
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
      const note = path.match(
        /\/(?:explore|discovery\/item)\/([a-zA-Z0-9]+)/
      )?.[1];
      const user = path.match(
        /\/user\/(?:profile\/)?([^/?#]+)/
      )?.[1];
      value = note || (user ? `user:${user}` : '');
    } else if (adapterEntry.name === 'douyin') {
      value = path.match(/\/video\/(\d+)/)?.[1] || '';
      if (!value) {
        const user = path.match(/\/(?:user|channel)\/([^/?#]+)/)?.[1];
        if (user) value = `user:${user}`;
      }
    } else if (adapterEntry.name === 'bilibili') {
      value = path.match(/\/video\/((?:BV|av)[a-zA-Z0-9]+)/i)?.[1] ||
        path.match(/\/bangumi\/play\/((?:ep|ss)\d+)/i)?.[1] || '';
      if (!value) {
        const channel = path.match(/\/(?:space|channel)\/([^/?#]+)/)?.[1];
        if (channel) value = `channel:${channel}`;
      }
    } else if (adapterEntry.name === 'youtube') {
      value = url.searchParams.get('v') ||
        path.match(/\/(?:shorts|live)\/([^/?#]+)/)?.[1] ||
        (url.hostname === 'youtu.be'
          ? path.slice(1).split('/')[0]
          : '');
      if (!value) {
        const channel = path.match(
          /\/(?:channel|c|user)\/([^/?#]+)/
        )?.[1] || path.match(/\/@([^/?#]+)/)?.[1];
        if (channel) value = `channel:${channel}`;
      }
      if (!value && /^\/feed(?:\/|$)/.test(path)) {
        value = `feed:${path.slice('/feed/'.length) || 'home'}`;
      }
    }
    return value ? `${adapterEntry.name}:${value}` : '';
  }

  function isAdapterDomainUrl(rawUrl, adapterEntry = depthAdapterEntry()) {
    if (!adapterEntry || !rawUrl) return false;
    let url;
    try {
      url = new URL(rawUrl, global.location.href);
    } catch (error) {
      return false;
    }
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    return adapterEntry.domains.some(rule =>
      hostname === rule || hostname.endsWith(`.${rule}`)
    );
  }

  function hasVisibleSearchResultsRoot(adapterEntry = depthAdapterEntry()) {
    if (!adapterEntry?.searchRoots?.length) return false;
    const detailSelector = (adapterEntry.details || []).join(',');
    for (const selector of adapterEntry.searchRoots) {
      for (const root of Array.from(
        global.document?.querySelectorAll?.(selector) || []
      )) {
        if (!isVisiblePageElement(root)) continue;
        if (detailSelector && root.closest?.(detailSelector)) continue;
        return true;
      }
    }
    return false;
  }

  function hasVisibleDetailRoot(adapterEntry = depthAdapterEntry()) {
    if (!adapterEntry?.details?.length) return false;
    for (const selector of adapterEntry.details) {
      for (const root of Array.from(
        global.document?.querySelectorAll?.(selector) || []
      )) {
        if (isVisiblePageElement(root)) return true;
      }
    }
    return false;
  }

  function douyinHistoryViewState(
    currentContext,
    rawUrl,
    hasVisibleDetail,
    adapterEntry = depthAdapterEntry()
  ) {
    if (
      adapterEntry?.name !== 'douyin' ||
      !isAdapterDomainUrl(rawUrl, adapterEntry)
    ) {
      return { context: '', passive: false };
    }

    let url;
    try {
      url = new URL(rawUrl, global.location.href);
    } catch (error) {
      return { context: '', passive: false };
    }

    const isHistoryList =
      /^\/user\/self\/?$/.test(url.pathname) &&
      url.searchParams.get('showTab') === 'record';
    let context = currentContext === 'douyin-history'
      ? currentContext
      : '';
    if (isHistoryList) context = 'douyin-history';

    const remainsInHistoryFlow = isHistoryList || (
      context === 'douyin-history' &&
      /^\/video\/\d+(?:\/|$)/.test(url.pathname)
    );
    if (!remainsInHistoryFlow) {
      return { context: '', passive: false };
    }

    return {
      context,
      passive: hasVisibleDetail !== true,
    };
  }

  function youtubeSearchTextFromUrl(
    rawUrl,
    baseUrl = global.location.href
  ) {
    if (!rawUrl) return '';
    let url;
    try {
      url = new URL(rawUrl, baseUrl);
    } catch (error) {
      return '';
    }
    const hostname = url.hostname.toLowerCase();
    if (
      hostname !== 'youtube.com' &&
      !hostname.endsWith('.youtube.com')
    ) {
      return '';
    }
    if (url.pathname !== '/results') return '';
    return String(url.searchParams.get('search_query') || '').trim();
  }

  function searchTextFromUrl(rawUrl, baseUrl = global.location.href) {
    if (!rawUrl) return '';
    let url;
    try {
      url = new URL(rawUrl, baseUrl);
    } catch (error) {
      return '';
    }
    const hostname = url.hostname.toLowerCase();
    const isDomain = (name) => (
      hostname === name || hostname.endsWith(`.${name}`)
    );
    if (isDomain('youtube.com')) {
      return youtubeSearchTextFromUrl(url.href, baseUrl);
    }
    if (isDomain('douyin.com')) {
      const match = url.pathname.match(
        /^\/(?:jingxuan\/)?search\/([^/?#]+)/
      );
      if (!match) return '';
      try {
        return decodeURIComponent(match[1]).trim();
      } catch (error) {
        return match[1].trim();
      }
    }
    if (isDomain('xiaohongshu.com')) {
      if (!/\/search(?:_result)?(?:\/|$)/.test(url.pathname)) return '';
      return String(
        url.searchParams.get('keyword') ||
        url.searchParams.get('q') ||
        ''
      ).trim();
    }
    if (isDomain('bilibili.com')) {
      if (!/\/search(?:\/|$)/.test(url.pathname) &&
          !/\/v_search(?:\/|$)/.test(url.pathname)) return '';
      return String(
        url.searchParams.get('keyword') ||
        url.searchParams.get('q') ||
        ''
      ).trim();
    }
    return '';
  }

  function findYouTubeSearchKeywordMatch(rawUrl) {
    const searchText = searchTextFromUrl(
      rawUrl,
      global.location.href
    );
    if (!searchText) return null;
    const keyword = rulesApi.findKeyword(
      searchText,
      rules.blockedKeywords
    );
    if (!keyword) return null;
    return {
      kind: 'keyword',
      value: keyword,
      targetUrl: absoluteUrl(rawUrl),
      pageSource: 'search',
    };
  }

  function findYouTubeSearchControlMatch(target) {
    if (
      depthAdapterEntry()?.name !== 'youtube' ||
      !isElement(target)
    ) {
      return null;
    }

    const selector = [
      'input[name="search_query"]',
      'input#search',
      'input[type="search"]',
    ].join(',');
    const container = target.closest?.(
      'form, ytd-searchbox, ytm-searchbox, yt-searchbox'
    );
    const input = target.matches?.(selector)
      ? target
      : target.querySelector?.(selector) ||
        container?.querySelector?.(selector);
    const searchText = String(input?.value || '').trim();
    if (!searchText) return null;

    const keyword = rulesApi.findKeyword(
      searchText,
      rules.blockedKeywords
    );
    if (!keyword) return null;
    return {
      kind: 'keyword',
      value: keyword,
    };
  }

  function findYouTubeSearchEventMatch(event) {
    const path = typeof event?.composedPath === 'function'
      ? event.composedPath()
      : [event?.target];
    for (const target of path) {
      const match = findYouTubeSearchControlMatch(target);
      if (match) return match;
    }
    return null;
  }

  function contentIdFromElement(target) {
    const adapter = depthAdapterEntry();
    if (!adapter || !isElement(target)) return '';
    const selector = adapter.candidates.join(',');
    const elements = [];
    const addElement = (element) => {
      if (element && !elements.includes(element)) elements.push(element);
    };
    addElement(target.closest?.(selector));
    addElement(target.matches?.(selector) ? target : null);
    addElement(target.querySelector?.(selector));

    // 小红书的卡片和详情容器经常把编号放在自定义节点上，点击目标
    // 本身可能只是图片/文字，因此沿祖先链补一次精确的编号查找。
    let ancestor = target;
    for (let depth = 0; ancestor && depth < 12; depth += 1) {
      addElement(ancestor);
      const idElement = ancestor.querySelector?.(
        '[data-note-id], [data-note-id-str], [data-aweme-id], [data-bvid], [data-aid]'
      );
      addElement(idElement);
      ancestor = ancestor.parentElement;
    }

    const attributes = {
      xiaohongshu: ['data-note-id', 'data-note-id-str', 'data-item-id'],
      douyin: ['data-aweme-id'],
      bilibili: ['data-bvid', 'data-aid'],
      youtube: [],
    }[adapter.name];
    for (const element of elements) {
      const isXiaohongshuContainer = adapter.name === 'xiaohongshu' &&
        element.matches?.(
          '.note-item, [class*="note-item"], .note-detail, ' +
          '[class*="note-detail-mask"], [class*="note-detail-container"], ' +
          '[class*="noteDetailMask"], [class*="noteDetailContainer"], ' +
          '[role="dialog"]'
        );
      const elementAttributes = isXiaohongshuContainer
        ? [...attributes, 'data-id']
        : attributes;
      for (const attribute of elementAttributes) {
        const value = element.getAttribute?.(attribute);
        if (value) return `${adapter.name}:${value}`;
      }
    }
    for (const element of elements) {
      const href = element.getAttribute?.('href') ||
        element.getAttribute?.('data-href') ||
        element.getAttribute?.('data-url') ||
        element.querySelector?.('a[href]')?.getAttribute('href') || '';
      const id = contentIdFromUrl(href, adapter);
      if (id) return id;
    }
    return '';
  }

  function syntheticDetailContentId(element) {
    if (!element) return '';
    const existing = syntheticDetailIds.get(element);
    if (existing) return existing;
    syntheticDetailSequence += 1;
    const id = `xiaohongshu:detail:${sessionId}:${syntheticDetailSequence}`;
    syntheticDetailIds.set(element, id);
    return id;
  }

  function isSearchResultsUrl(rawUrl) {
    const adapter = depthAdapterEntry();
    if (!adapter) return false;
    if (!isAdapterDomainUrl(rawUrl, adapter)) return false;
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
      // 抖音当前搜索页实际使用 /jingxuan/search/:keyword 路由，
      // 旧版 /search/:keyword 仍保留兼容。
      return /^\/(?:jingxuan\/)?search(?:\/|$)/.test(url.pathname);
    }
    if (adapter.name === 'bilibili') {
      return /\/(?:s\/video|v_search)(?:\/|$)/.test(url.pathname);
    }
    return adapter.name === 'youtube' && url.pathname === '/results';
  }

  function isSearchResultsView(rawUrl) {
    const adapter = depthAdapterEntry();
    if (!adapter) return false;
    if (isSearchResultsUrl(rawUrl)) return true;
    return hasVisibleSearchResultsRoot(adapter);
  }

  function navigationContentIdFromUrl(rawUrl) {
    const adapter = depthAdapterEntry();
    if (!adapter || !rawUrl || !isAdapterDomainUrl(rawUrl, adapter)) {
      return '';
    }
    const contentId = contentIdFromUrl(rawUrl, adapter);
    if (contentId) return contentId;
    let url;
    try {
      url = new URL(rawUrl, global.location.href);
    } catch (error) {
      return '';
    }
    if (isSearchResultsUrl(rawUrl)) {
      return `${adapter.name}:search`;
    }
    return `${adapter.name}:route:${url.pathname}${url.search}`;
  }

  function currentPageContentId() {
    const adapter = depthAdapterEntry();
    if (!adapter) return '';
    for (const selector of adapter.details) {
      const elements = Array.from(
        global.document?.querySelectorAll?.(selector) || []
      );
      for (const element of elements.reverse()) {
        if (!isVisiblePageElement(element)) continue;
        if (element.hasAttribute?.(DEPTH3_REJECTED_ATTR)) continue;
        const id = contentIdFromElement(element);
        if (id) return id;
        if (adapter.name === 'xiaohongshu') {
          return syntheticDetailContentId(element);
        }
      }
    }
    // 某些 SPA 详情没有固定的详情类名，但会把当前笔记编号挂在
    // note-detail 相关后代节点上；这里仍只查详情容器，不扫描整个页面。
    if (adapter.name === 'xiaohongshu') {
      const detailRoots = Array.from(
        global.document?.querySelectorAll?.(
          '[class*="note-detail-mask"], [class*="note-detail-container"], ' +
          '[class*="noteDetailMask"], [class*="noteDetailContainer"], ' +
          '[role="dialog"][data-note-id], [aria-modal="true"][data-note-id]'
        ) || []
      );
      for (const element of detailRoots.reverse()) {
        if (!isVisiblePageElement(element)) continue;
        const id = contentIdFromElement(element);
        if (id) return id;
        return syntheticDetailContentId(element);
      }
    }
    const urlContentId = contentIdFromUrl(global.location.href, adapter);
    // 同页详情关闭时，地址可能暂时仍是旧的详情地址；只要搜索结果流
    // 已恢复且没有可见详情，就不能让这个旧地址继续占住 depth 2。
    if (hasVisibleSearchResultsRoot(adapter)) {
      return '';
    }
    return urlContentId;
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

  function resetNavigationToSearchResults(resultUrl = '') {
    if (!navigationContext?.enabled) return;
    const normalizedResultUrl = normalizeNavigationUrl(resultUrl);
    updateNavigationContext(1, '', {
      contentUrl: '',
      resultUrl: normalizedResultUrl || navigationContext.resultUrl || '',
      pendingDepth: 1,
      pendingContentId: '',
      pendingContentUrl: '',
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
    // 这是导航层级规则，不是用户配置的 URL 封禁规则；不能把内容编号
    // 写进 urlPattern，否则统计和排查时会误以为命中了用户的黑名单网址。
    return { kind: 'navigation', value: contentId, contentId };
  }

  function blockDepth3(event, match) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    recordDepth3Attempt(match);
  }

  function recordDepth3Attempt(match) {
    const timestamp = recordClick(match);
    if (timestamp == null) return;

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
    showFeedback(match, timestamp);
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
      kind: 'navigation',
      value: contentId,
      contentId,
    });

    const allowedUrl = normalizeNavigationUrl(
      navigationContext.contentUrl
    );
    const currentUrl = normalizeNavigationUrl(global.location.href);
    const adapter = depthAdapterEntry();
    const currentUrlContentId = navigationContentIdFromUrl(
      global.location.href
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
    if (
      blockingEnabled !== true ||
      DEPTH_NAVIGATION_ENFORCEMENT_ENABLED !== true ||
      !navigationContext?.enabled ||
      !depthAdapterEntry()
    ) {
      return false;
    }
    // 小红书关闭详情后可能先隐藏详情层，再稍后恢复网址；在判断下一次
    // 点击前先同步一次，避免把搜索结果误认为是详情里的横向跳转。
    synchronizeDepthFromPage();
    if (!navigationContext?.enabled || !depthAdapterEntry()) return false;
    if (navigationContext.depth === 1 && pageIsBlocked) return false;
    const targetUrl = interactionTargetUrl(event.target);
    const contentId = contentIdFromElement(event.target) ||
      navigationContentIdFromUrl(targetUrl);
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
    if (
      blockingEnabled !== true ||
      DEPTH_NAVIGATION_ENFORCEMENT_ENABLED !== true ||
      !navigationContext?.enabled ||
      !depthAdapterEntry()
    ) {
      clearDepth2Cleanup();
      return;
    }
    const contentId = currentPageContentId();
    if (
      navigationContext.depth === 2 &&
      isSearchResultsView(global.location.href) &&
      !contentId
    ) {
      updateNavigationContext(1, '', {
        contentUrl: '',
        pendingDepth: 1,
        pendingContentId: '',
        pendingContentUrl: '',
      });
      return;
    }
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
    if (navigationContext.depth === 2) {
      const routeContentId = navigationContentIdFromUrl(
        global.location.href
      );
      const blocked = depth3Match(routeContentId);
      if (blocked) {
        rejectCommittedDepth3(routeContentId);
        return;
      }
      applyDepth2Cleanup();
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
      if (match.kind === 'author') node.setAttribute(BLOCKED_AUTHOR_ATTR, match.value);
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
        author: match.kind === 'author' ? match.value : '',
        domain: domain(),
        timestamp: now(),
        sessionId,
      },
    });
  }

  function matchElement(element) {
    if (!isElement(element) || isBlockingFeedbackNode(element)) return null;
    const keyword = rulesApi.findKeyword(textForElement(element), rules.blockedKeywords);
    if (keyword) return { kind: 'keyword', value: keyword, element };
    const target = element.matches(
      'a[href], area[href], [role="link"], [data-href], [data-url]'
    )
      ? element.getAttribute('href') || element.getAttribute('data-href') || element.getAttribute('data-url')
      : '';
    const urlPattern = findUrlMatch(target);
    if (urlPattern) return { kind: 'url', value: urlPattern, element };
    return null;
  }

  function matchResultCard(card, adapterEntry = depthAdapterEntry()) {
    if (!isElement(card) || !adapterEntry) return null;
    const keywordSelectors = resultRuleSelectors(
      adapterEntry,
      'keywordSelectors',
      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', '[data-title]', '[class*="title"]', '[class*="desc"]']
    );
    const authorSelectors = resultRuleSelectors(
      adapterEntry,
      'authorSelectors',
      ['[data-author]', '[data-e2e*="author"]', '[class*="author"]', '[class*="nickname"]', '[class*="user-name"]', 'a[href*="/user/"]', 'a[href*="/channel/"]', 'a[href*="/@"]']
    );
    const urlSelectors = resultRuleSelectors(
      adapterEntry,
      'urlSelectors',
      ['a[href]', '[role="link"]', '[data-href]', '[data-url]']
    );
    const findTextMatch = (selectors, kind, values) => {
      for (const selector of selectors) {
        const nodes = [];
        if (card.matches?.(selector)) nodes.push(card);
        nodes.push(...Array.from(card.querySelectorAll?.(selector) || []));
        for (const node of nodes) {
          const value = rulesApi.findKeyword(textForElement(node), values);
          if (value) return { kind, value, element: node };
        }
      }
      return null;
    };
    const keyword = findTextMatch(
      keywordSelectors,
      'keyword',
      rules.blockedKeywords
    );
    if (keyword) return keyword;
    const author = findTextMatch(
      authorSelectors,
      'author',
      rules.blockedAuthors
    );
    if (author) return author;
    for (const selector of urlSelectors) {
      const nodes = [];
      if (card.matches?.(selector)) nodes.push(card);
      nodes.push(...Array.from(card.querySelectorAll?.(selector) || []));
      for (const node of nodes) {
        const rawUrl = node.getAttribute?.('href') ||
          node.getAttribute?.('data-href') ||
          node.getAttribute?.('data-url') || '';
        const value = findUrlMatch(rawUrl);
        if (value) return { kind: 'url', value, element: node };
      }
    }
    return null;
  }

  function processElement(element) {
    if (blockingEnabled !== true || !isElement(element)) return;
    const adapter = depthAdapterEntry();
    // MutationObserver 可能直接把详情根、video 或 canvas 放入队列。
    // 详情范围只允许原站播放器运行，不执行搜索结果卡替换。
    if (detailRootForElement(element, adapter)) return;
    const cards = resultCardsInElement(element, adapter);
    const containingCard = resultCardForElement(element, adapter);
    if (containingCard && !cards.includes(containingCard)) {
      cards.push(containingCard);
    }
    for (const card of cards) {
      const match = blockedCardMatch(card) || matchResultCard(card, adapter);
      if (match) processMatchedElement(card, match);
    }
    for (const candidate of blockingCandidatesInElement(element)) {
      const match = matchElement(candidate);
      if (match) processMatchedElement(candidate, match);
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
    if (blockingEnabled !== true) return;
    const nextUrlPattern = findUrlMatch(global.location.href);
    const adapter = depthAdapterEntry();
    const onSearchResultsPage = isSearchResultsView(
      global.location.href
    );
    const hasVisibleDetail = hasVisibleDetailRoot(adapter);
    const nextPageViewKey = pageViewKey(adapter, hasVisibleDetail);
    const pageViewChanged = Boolean(
      activePageViewKey &&
      activePageViewKey !== nextPageViewKey
    );
    if (pageViewChanged) {
      clearFeedbackArtifactsForPageChange();
      pageExposureRecorded = new Set();
      exposureMap = new WeakMap();
      recentAttempts.clear();
    }
    activePageViewKey = nextPageViewKey;
    const historyView = douyinHistoryViewState(
      douyinHistoryContext,
      global.location.href,
      hasVisibleDetail,
      adapter
    );
    douyinHistoryContext = historyView.context;
    const onPassiveCollectionPage = (
      onSearchResultsPage ||
      historyView.passive
    ) && !hasVisibleDetail;
    const nextTitleKeyword = onPassiveCollectionPage
      ? null
      : rulesApi.findKeyword(
        global.document.title || '',
        rules.blockedKeywords
      );
    const nextSearchMatch = onPassiveCollectionPage
      ? findYouTubeSearchKeywordMatch(global.location.href)
      : null;
    currentUrlPattern = nextUrlPattern;
    currentTitleKeyword = nextTitleKeyword;
    currentSearchMatch = nextSearchMatch;
    const detectedPageMatch = detectedPageBlockingMatch();
    const hasCurrentContent = hasVisibleDetail || (
      onSearchResultsPage
        ? Boolean(currentPageContentId())
        : false
    );
    if (shouldClearPersistentPageGate(
      persistentPageGateMatch,
      nextPageViewKey,
      detectedPageMatch,
      onPassiveCollectionPage,
      hasCurrentContent
    )) {
      clearPersistentPageGate();
    }
    pageIsBlocked = Boolean(
      persistentPageGateMatch ||
      detectedPageMatch
    );
    recordExposureForPage(currentUrlPattern && { kind: 'url', value: currentUrlPattern });
    recordExposureForPage(currentTitleKeyword && { kind: 'keyword', value: currentTitleKeyword });
    recordExposureForPage(currentSearchMatch);
    renderPageNotice();
    if (rulesLoaded && detectedPageMatch) {
      latchPersistentPageGate(detectedPageMatch, nextPageViewKey);
    }
    if (persistentPageGateMatch) {
      showPersistentPageGateImage();
    }
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

  function visibleDocumentAppendTarget() {
    const target = global.document?.body ||
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
      [${BLOCKED_ATTR}]:not([${BLOCKED_CARD_ATTR}]) {
        outline: 2px solid rgba(180, 30, 30, 0.7) !important;
        outline-offset: -2px !important;
        cursor: not-allowed !important;
        filter: blur(6px) grayscale(1) !important;
        opacity: 0.18 !important;
        user-select: none !important;
      }
      [${BLOCKED_CARD_ATTR}] {
        display: block !important;
        min-height: 42px !important;
        box-sizing: border-box !important;
        filter: none !important;
        opacity: 1 !important;
        outline: 1px solid rgba(90, 90, 90, 0.35) !important;
        background: #f2f2f2 !important;
        background-image: none !important;
        color: #666 !important;
        cursor: not-allowed !important;
        pointer-events: auto !important;
        user-select: none !important;
      }
      .${BLOCKED_CARD_PLACEHOLDER_CLASS} {
        display: flex !important;
        min-height: 42px !important;
        align-items: center !important;
        justify-content: center !important;
        box-sizing: border-box !important;
        padding: 6px 8px !important;
        color: #666 !important;
        background: #f2f2f2 !important;
        font: 14px/1.2 Arial, sans-serif !important;
        pointer-events: none !important;
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
      #${FEEDBACK_PAUSE_ID} {
        position: fixed !important;
        inset: 0 !important;
        z-index: 2147483646 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        box-sizing: border-box !important;
        padding: 24px !important;
        background: rgba(18, 18, 18, 0.94) !important;
        color: #fff !important;
        font: bold clamp(20px, 4vw, 38px)/1.35 Arial, sans-serif !important;
        text-align: center !important;
        white-space: pre-line !important;
        cursor: not-allowed !important;
        user-select: none !important;
        pointer-events: none !important;
      }
      #${FEEDBACK_PAUSE_ID}[hidden] {
        display: none !important;
      }
      html.mysearch-blocking-grayout {
        filter: grayscale(0.85) !important;
      }
      html[${PAGE_GATE_ATTR}] body > *:not(#${NOTICE_ID}):not(#${PERSISTENT_FEEDBACK_IMAGE_ID}):not(#${FEEDBACK_PAUSE_ID}) {
        visibility: hidden !important;
        pointer-events: none !important;
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
      #mysearch-blocking-feedback-image,
      #mysearch-blocking-page-gate-image {
        position: fixed !important;
        display: block !important;
        top: 50% !important;
        left: 50% !important;
        z-index: 2147483647 !important;
        width: min(72vw, 520px) !important;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 12px !important;
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
      #mysearch-blocking-feedback-image.visible,
      #mysearch-blocking-page-gate-image.visible {
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
    const documentRoot = global.document.documentElement;
    if (pageIsBlocked) {
      documentRoot?.setAttribute?.(PAGE_GATE_ATTR, '');
    } else {
      documentRoot?.removeAttribute?.(PAGE_GATE_ATTR);
    }
    if (!pageIsBlocked) {
      global.document.getElementById(NOTICE_ID)?.remove();
      return;
    }
    installStyle();
    let notice = global.document.getElementById(NOTICE_ID);
    if (!notice) {
      const target = visibleDocumentAppendTarget();
      if (!target) return;
      notice = global.document.createElement('div');
      notice.id = NOTICE_ID;
      notice.setAttribute('role', 'status');
      target.appendChild(notice);
    }
    const pageMatch = currentPageBlockingMatch();
    notice.textContent = pageMatch?.pageSource === 'url'
      ? '当前地址已阻断，本次访问已记录。'
      : pageMatch?.pageSource === 'search'
        ? '当前搜索词已阻断，本次访问已记录。'
        : '当前页面标题包含已阻断内容，本次访问已记录。';
  }

  function detectedPageBlockingMatch() {
    const pageUrl = normalizeNavigationUrl(global.location.href);
    if (currentUrlPattern) {
      return {
        kind: 'url',
        value: currentUrlPattern,
        targetUrl: pageUrl,
        pageSource: 'url',
      };
    }
    if (currentTitleKeyword) {
      return {
        kind: 'keyword',
        value: currentTitleKeyword,
        targetUrl: pageUrl,
        pageSource: 'title',
      };
    }
    if (currentSearchMatch) return currentSearchMatch;
    return null;
  }

  function pageViewKey(
    adapterEntry = depthAdapterEntry(),
    hasVisibleDetail = hasVisibleDetailRoot(adapterEntry)
  ) {
    const contentId = hasVisibleDetail
      ? currentPageContentId()
      : '';
    return [
      normalizeNavigationUrl(global.location.href),
      hasVisibleDetail
        ? `detail:${contentId || 'visible'}`
        : 'page',
    ].join('|');
  }

  function ensurePageStateCurrent() {
    if (blockingEnabled !== true) return;
    if (pageViewKey() === activePageViewKey) return;
    updatePageState();
  }

  function shouldClearPersistentPageGate(
    gateMatch,
    currentViewKey,
    detectedMatch,
    onPassiveCollectionPage,
    hasCurrentContent
  ) {
    if (!gateMatch) return false;
    if (gateMatch.pageViewKey) {
      return gateMatch.pageViewKey !== currentViewKey;
    }
    if (!onPassiveCollectionPage || hasCurrentContent) {
      return false;
    }
    return !detectedMatch ||
      detectedMatch.kind !== gateMatch.kind ||
      detectedMatch.value !== gateMatch.value;
  }

  function clearFeedbackArtifactsForPageChange() {
    finishFeedbackPause();
    global.clearTimeout?.(showTemporaryNotice.timer);
    showTemporaryNotice.timer = null;
    global.clearTimeout?.(flashBlockingFeedback.timer);
    flashBlockingFeedback.timer = null;
    global.clearTimeout?.(showBlockingImageFeedback.timer);
    showBlockingImageFeedback.timer = null;
    for (const id of [
      NOTICE_ID,
      TRANSIENT_FEEDBACK_IMAGE_ID,
      PERSISTENT_FEEDBACK_IMAGE_ID,
      FEEDBACK_PAUSE_ID,
    ]) {
      global.document?.getElementById?.(id)?.remove?.();
    }
    global.document?.documentElement?.classList?.remove?.(
      'mysearch-blocking-grayout',
      'mysearch-blocking-feedback-flash'
    );
    global.document?.documentElement?.removeAttribute?.(PAGE_GATE_ATTR);
  }

  function clearPersistentPageGate() {
    if (!persistentPageGateMatch) return false;
    persistentPageGateMatch = null;
    clearFeedbackArtifactsForPageChange();
    return true;
  }

  function currentPageBlockingMatch() {
    ensurePageStateCurrent();
    return persistentPageGateMatch ||
      currentSearchMatch ||
      detectedPageBlockingMatch();
  }

  function pausePageMedia() {
    for (const media of Array.from(
      global.document?.querySelectorAll?.('video, audio') || []
    )) {
      try {
        media.pause?.();
      } catch (error) {
        // 页面可能锁定媒体方法；页面世界 play 钩子仍会阻断后续播放。
      }
      try {
        media.autoplay = false;
        media.removeAttribute?.('autoplay');
      } catch (error) {
        // 无法修改单个媒体属性时继续处理其他媒体。
      }
    }
  }

  function latchPersistentPageGate(
    match,
    currentViewKey = activePageViewKey || pageViewKey()
  ) {
    if (persistentPageGateMatch || !match) return false;
    persistentPageGateMatch = {
      ...match,
      persistentPageGate: true,
      pageViewKey: currentViewKey,
    };
    pageIsBlocked = true;
    if (typeof renderPageNotice === 'function') renderPageNotice();
    showPersistentPageGateImage();
    pausePageMedia();
    const timestamp = recordClick(persistentPageGateMatch);
    if (timestamp != null) {
      showFeedback(persistentPageGateMatch, timestamp);
    }
    return true;
  }

  function getInteractionMatch(target) {
    ensurePageStateCurrent();
    const pageMatch = currentPageBlockingMatch();
    if (pageMatch) return pageMatch;

    const adapter = depthAdapterEntry();
    if (detailRootForElement(target, adapter)) return null;

    const blockedCard = isElement(target)
      ? target.closest?.(`[${BLOCKED_CARD_ATTR}]`)
      : null;
    if (blockedCard) {
      return {
        kind:
          blockedCard.getAttribute(BLOCKED_CARD_KIND_ATTR) ||
          'keyword',
        value:
          blockedCard.getAttribute(BLOCKED_CARD_VALUE_ATTR) ||
          'blocked-card',
        element: blockedCard,
      };
    }

    const adapterSelector = adapter?.candidates?.join(',');
    const adapterCard = adapterSelector && isElement(target)
      ? target.closest?.(adapterSelector)
      : null;
    if (adapterCard) {
      const resultMatch = matchResultCard(adapterCard, adapter);
      if (resultMatch) return resultMatch;
    }

    let element = isElement(target) ? target : target?.parentElement;
    for (let depth = 0; element && depth < 9; depth += 1, element = element.parentElement) {
      const href = element.matches?.('a[href], area[href], [data-href], [data-url]')
        ? element.getAttribute('href') || element.getAttribute('data-href') || element.getAttribute('data-url')
        : '';
      const urlPattern = findUrlMatch(href);
      if (urlPattern) return { kind: 'url', value: urlPattern, element };
      if (isLikelyClickable(element)) {
        const resultCard = resultCardForElement(element, adapter);
        if (resultCard && resultCard !== element) continue;
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
    if (!allowDeduplicatedAttempt(match)) return null;
    blockedClickCount += 1;
    void sendMessage({
      type: 'RECORD_BLOCKING_EVENT',
      event: {
        id: eventId('click'),
        type: 'click',
        keyword: match.kind === 'keyword' ? match.value : '',
        urlPattern: match.kind === 'url' ? match.value : '',
        author: match.kind === 'author' ? match.value : '',
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
      `内容已阻断。本次冲动点击已记录（第 ${blockedClickCount} 次）。\n` +
      '冲动不是命令。停一下，识别它，然后回到原来的任务。'
    );
    flashBlockingFeedback();
    showBehaviorPauseFeedback();
    const feedbackImageAsset = match.persistentPageGate
      ? showPersistentPageGateImage()
      : showBlockingImageFeedback();

    const feedbackType = 'aversive+pause+beep+photo';
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
    lastFeedbackEventId = eventId('feedback');
    void sendMessage({
      type: 'RECORD_BLOCKING_EVENT',
      event: {
        id: lastFeedbackEventId,
        type: 'feedback',
        feedbackType,
        feedbackImageAsset,
        pauseDurationMs: 5000,
        soundProfile: 'short-high-frequency-safe',
        trainingPrompt: '识别冲动，不执行，回到原任务',
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

  function selectBlockingFeedbackImage() {
    return NEGATIVE_FEEDBACK_ASSETS[
      Math.floor(Math.random() * NEGATIVE_FEEDBACK_ASSETS.length)
    ];
  }

  function renderBlockingFeedbackImage(
    imageId,
    feedbackImage,
    onReveal
  ) {
    if (!canCreateDocumentNodes()) return '';
    const target = visibleDocumentAppendTarget();
    if (!target) return '';

    let image = global.document.getElementById(imageId);
    if (!image) {
      image = global.document.createElement('img');
      image.id = imageId;
      image.alt = '厌恶反馈：内容已阻断';
      image.setAttribute('aria-hidden', 'true');
      target.appendChild(image);
    }
    image.setAttribute('data-feedback-asset', feedbackImage);
    let imageUrl = '';
    try {
      imageUrl = global.chrome?.runtime?.getURL?.(feedbackImage) || '';
    } catch (error) {
      imageUrl = '';
    }
    const fallbackImageUrl =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(FALLBACK_FEEDBACK_IMAGE);

    const revealImage = () => {
      target.appendChild(image);
      image.classList.add('visible');
      if (typeof onReveal === 'function') onReveal(image);
    };

    image.onload = revealImage;
    image.onerror = () => {
      image.onerror = null;
      image.src = fallbackImageUrl;
    };
    image.src = imageUrl || fallbackImageUrl;
    if (image.complete && image.naturalWidth > 0) {
      revealImage();
    }
    return feedbackImage;
  }

  function showBlockingImageFeedback() {
    const feedbackImage = selectBlockingFeedbackImage();
    return renderBlockingFeedbackImage(
      TRANSIENT_FEEDBACK_IMAGE_ID,
      feedbackImage,
      (image) => {
        global.clearTimeout(showBlockingImageFeedback.timer);
        showBlockingImageFeedback.timer = global.setTimeout(() => {
          image.classList.remove('visible');
        }, 5000);
      }
    );
  }

  function showPersistentPageGateImage() {
    if (!persistentPageGateMatch) return '';
    const feedbackImage =
      persistentPageGateMatch.feedbackImageAsset ||
      selectBlockingFeedbackImage();
    persistentPageGateMatch.feedbackImageAsset = feedbackImage;

    const existing = global.document?.getElementById?.(
      PERSISTENT_FEEDBACK_IMAGE_ID
    );
    if (
      existing?.getAttribute?.('data-feedback-asset') ===
      feedbackImage
    ) {
      existing.classList?.add('visible');
      return feedbackImage;
    }

    return renderBlockingFeedbackImage(
      PERSISTENT_FEEDBACK_IMAGE_ID,
      feedbackImage
    );
  }

  function playBeep() {
    try {
      // AudioContext 只能在用户当前操作期间创建；拦截页面上的被动事件时
      // 没有这个条件，Chromium 会把创建行为记录为扩展错误。
      const userActivation = global.navigator?.userActivation;
      if (!userActivation || userActivation.isActive !== true) return;
      const AudioContextClass = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextClass) return;
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'square';
      // 这是短促、低音量的高频提示，不把系统音量推到危险范围。
      oscillator.frequency.setValueAtTime(2800, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        1800,
        context.currentTime + 0.12
      );
      gain.gain.setValueAtTime(0.03, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        context.currentTime + 0.14
      );
      oscillator.connect(gain).connect(context.destination);
      const startTone = () => {
        oscillator.start();
        oscillator.stop(context.currentTime + 0.14);
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
      const target = visibleDocumentAppendTarget();
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

  function finishFeedbackPause() {
    feedbackPauseUntil = 0;
    if (feedbackPauseTimer != null) {
      global.clearTimeout(feedbackPauseTimer);
      feedbackPauseTimer = null;
    }
    if (feedbackPauseInterval != null) {
      global.clearInterval(feedbackPauseInterval);
      feedbackPauseInterval = null;
    }
    const pause = global.document?.getElementById?.(FEEDBACK_PAUSE_ID);
    if (pause) {
      pause.hidden = true;
      pause.setAttribute('aria-hidden', 'true');
    }
  }

  function showBehaviorPauseFeedback() {
    if (!canCreateDocumentNodes()) return;
    installStyle();
    const target = visibleDocumentAppendTarget();
    if (!target) return;
    let pause = global.document.getElementById(FEEDBACK_PAUSE_ID);
    if (!pause) {
      pause = global.document.createElement('div');
      pause.id = FEEDBACK_PAUSE_ID;
      pause.setAttribute('role', 'alert');
      pause.setAttribute('aria-live', 'assertive');
      pause.setAttribute('aria-hidden', 'false');
      pause.tabIndex = -1;
      target.appendChild(pause);
    }
    const duration = 5000;
    feedbackPauseUntil = now() + duration;
    pause.hidden = false;
    pause.setAttribute('aria-hidden', 'false');
    const render = () => {
      const remaining = Math.max(0, feedbackPauseUntil - now());
      const seconds = Math.ceil(remaining / 1000);
      pause.textContent = seconds > 0
        ? `先停 ${seconds} 秒\n内容不会打开，点击已记录。`
        : '可以继续工作。';
    };
    render();
    if (feedbackPauseTimer != null) global.clearTimeout(feedbackPauseTimer);
    if (feedbackPauseInterval != null) {
      global.clearInterval(feedbackPauseInterval);
    }
    feedbackPauseInterval = global.setInterval(render, 250);
    feedbackPauseTimer = global.setTimeout(finishFeedbackPause, duration);
  }

  function persistentGateEventNeedsFeedback(event) {
    if (event?.type === 'keydown') {
      return !event.isComposing &&
        ['Enter', ' ', 'Spacebar'].includes(event.key);
    }
    return [
      'pointerdown',
      'click',
      'auxclick',
      'submit',
      NAVIGATION_EVENT,
    ].includes(event?.type);
  }

  function isAllowedDetailDismissal(event) {
    if (event?.type === 'keydown' && event.key === 'Escape') {
      return true;
    }
    if (
      depthAdapterEntry()?.name !== 'douyin' ||
      !isElement(event?.target)
    ) {
      return false;
    }
    return Boolean(event.target.closest?.([
      '[data-e2e="video-close"]',
      '[data-e2e="modal-close"]',
      '[data-e2e*="close"]',
      'button[aria-label*="关闭"]',
      '[role="button"][aria-label*="关闭"]',
      '[title="关闭"]',
    ].join(',')));
  }

  function blockPersistentPageEvent(event) {
    ensurePageStateCurrent();
    if (!persistentPageGateMatch) return false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    try {
      event.target?.pause?.();
    } catch (error) {
      // 页面可能锁定媒体方法；默认动作仍保持阻断。
    }
    if (persistentGateEventNeedsFeedback(event)) {
      const timestamp = recordClick(persistentPageGateMatch);
      if (timestamp != null) {
        showFeedback(persistentPageGateMatch, timestamp);
      }
    }
    return true;
  }

  function blockEvent(event, match) {
    if (!match) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const timestamp = recordClick(match);
    if (timestamp != null) showFeedback(match, timestamp);
  }

  function handleSearchSubmit(event) {
    if (blockingEnabled !== true) return;
    if (blockPersistentPageEvent(event)) return;
    const match = findYouTubeSearchEventMatch(event);
    blockEvent(event, match);
  }

  function handleInteraction(event) {
    if (blockingEnabled !== true) return;
    if (isAllowedDetailDismissal(event)) return;
    if (blockPersistentPageEvent(event)) return;
    if (event.type === 'keydown' && !['Enter', ' ', 'Spacebar'].includes(event.key)) return;
    if (event.type === 'keydown' && event.isComposing) return;
    if (event.type === 'keydown' && event.key === 'Enter') {
      const searchMatch = findYouTubeSearchEventMatch(event);
      if (searchMatch) {
        blockEvent(event, searchMatch);
        return;
      }
    }
    if (
      navigationContext?.depth === 2 &&
      handleDepthInteraction(event)
    ) {
      return;
    }
    const match = getInteractionMatch(event.target);
    if (match) {
      blockEvent(event, match);
      return;
    }
    if (navigationContext?.depth !== 2) {
      handleDepthInteraction(event);
    }
  }

  function handlePageNavigation(event) {
    if (blockingEnabled !== true) return;
    const targetUrl = event.detail?.url || '';
    const searchMatch = findYouTubeSearchKeywordMatch(targetUrl);
    if (searchMatch) {
      blockEvent(event, searchMatch);
      return;
    }
    const targetUrlPattern = findUrlMatch(targetUrl);
    if (targetUrlPattern) {
      blockEvent(event, {
        kind: 'url',
        value: targetUrlPattern,
        targetUrl,
      });
      return;
    }
    const historyTarget = douyinHistoryViewState(
      '',
      targetUrl,
      false
    );
    if (historyTarget.passive) {
      clearPersistentPageGate();
      return;
    }
    if (blockPersistentPageEvent(event)) return;
    const pageMatch = currentPageBlockingMatch();
    if (pageMatch) {
      blockEvent(event, pageMatch);
      return;
    }
    // 基础模式不根据“从第几个结果/详情返回到哪里”做额外阻断。
    if (DEPTH_NAVIGATION_ENFORCEMENT_ENABLED !== true) return;
    // 从视频/笔记详情返回搜索结果是允许的。必须在内容编号比较之前
    // 处理，因为此时 /search 会被 navigationContentIdFromUrl 转成
    // douyin:search，不能把它误当成“详情 A -> 内容 B”。
    if (
      navigationContext?.enabled &&
      depthAdapterEntry() &&
      isSearchResultsUrl(targetUrl)
    ) {
      resetNavigationToSearchResults(targetUrl);
      return;
    }
    if (
      DEPTH_NAVIGATION_ENFORCEMENT_ENABLED === true &&
      navigationContext?.enabled &&
      depthAdapterEntry()
    ) {
      const contentId = navigationContentIdFromUrl(
        targetUrl
      );
      const blocked = depth3Match(contentId);
      if (blocked) {
        blockDepth3(event, blocked);
        return;
      }
      markAllowedContentNavigation(
        contentId,
        event.detail?.navigationKind === 'window.open',
        targetUrl
      );
    }
  }

  function handleMediaAttempt(event) {
    if (blockingEnabled !== true) return;
    if (blockPersistentPageEvent(event)) return;
    if (
      DEPTH_NAVIGATION_ENFORCEMENT_ENABLED === true &&
      navigationContext?.enabled &&
      depthAdapterEntry()
    ) {
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

    // play() 也用于滚动懒加载和自动预览，不能按主动卡片点击处理。
    // 卡片关键词仍由 pointerdown/click/keydown 路径阻断。
    const match = currentPageBlockingMatch();
    if (!match) return;
    blockEvent(event, match);
  }

  function handleNativeMediaPlay(event) {
    if (blockingEnabled !== true) return;
    blockPersistentPageEvent(event);
  }

  function searchSessionIsForeground() {
    if (global.document?.visibilityState === 'hidden') return false;
    if (typeof global.document?.hasFocus === 'function') {
      return global.document.hasFocus();
    }
    return true;
  }

  function reportSearchSessionForeground() {
    if (
      blockingEnabled !== true ||
      DEPTH_NAVIGATION_ENFORCEMENT_ENABLED !== true ||
      !navigationContext?.enabled
    ) return;
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
      'data-label',
      'data-name',
      'aria-description',
      'alt',
      'placeholder',
      'src',
      'value',
      'name',
    ],
    });
  }

  function applyRules(nextRules) {
    restoreBlockedCards();
    rules = rulesApi.normalizeRules(nextRules);
    rulesLoaded = true;
    if (blockingEnabled !== true) return;
    currentUrlPattern = null;
    currentTitleKeyword = null;
    currentSearchMatch = null;
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

  async function loadBlockingEnabled() {
    const response = await sendMessage({
      type: 'GET_BLOCKING_STATUS',
    });
    if (response?.success === true) return response.enabled !== false;
    try {
      const stored = await global.chrome.storage.local.get(
        BLOCKING_ENABLED_STORAGE_KEY
      );
      return stored[BLOCKING_ENABLED_STORAGE_KEY] !== false;
    } catch (error) {
      return true;
    }
  }

  function clearBlockingArtifacts() {
    pageIsBlocked = false;
    currentUrlPattern = null;
    currentTitleKeyword = null;
    currentSearchMatch = null;
    activePageViewKey = '';
    douyinHistoryContext = '';
    lastRejectedContentId = '';
    recentAttempts.clear();
    clearPersistentPageGate();
    finishFeedbackPause();
    global.clearTimeout?.(showTemporaryNotice.timer);
    showTemporaryNotice.timer = null;
    global.document?.getElementById?.(NOTICE_ID)?.remove?.();
    global.document?.getElementById?.(TRANSIENT_FEEDBACK_IMAGE_ID)?.remove?.();
    global.document?.getElementById?.(PERSISTENT_FEEDBACK_IMAGE_ID)?.remove?.();
    global.document?.getElementById?.(FEEDBACK_PAUSE_ID)?.remove?.();
    global.document?.documentElement?.classList?.remove?.(
      'mysearch-blocking-grayout',
      'mysearch-blocking-feedback-flash'
    );
    global.document?.documentElement?.removeAttribute?.(PAGE_GATE_ATTR);
    restoreBlockedCards();
    for (const node of Array.from(
      global.document?.querySelectorAll?.(
        `[${BLOCKED_ATTR}], [${BLOCKED_KEYWORD_ATTR}], ` +
        `[${BLOCKED_AUTHOR_ATTR}], ` +
        `[${BLOCKED_CARD_ATTR}], [${BLOCKED_CARD_KIND_ATTR}], ` +
        `[${BLOCKED_CARD_VALUE_ATTR}]`
      ) || []
    )) {
      node.removeAttribute?.(BLOCKED_ATTR);
      node.removeAttribute?.(BLOCKED_KEYWORD_ATTR);
      node.removeAttribute?.(BLOCKED_AUTHOR_ATTR);
      node.removeAttribute?.(BLOCKED_CARD_ATTR);
      node.removeAttribute?.(BLOCKED_CARD_KIND_ATTR);
      node.removeAttribute?.(BLOCKED_CARD_VALUE_ATTR);
    }
    clearDepth2Cleanup();
  }

  function refreshSearchSessionContext() {
    if (
      blockingEnabled !== true ||
      DEPTH_NAVIGATION_ENFORCEMENT_ENABLED !== true
    ) return;
    void sendMessage({ type: 'GET_SEARCH_SESSION_CONTEXT' }).then(response => {
      navigationContext = response?.enabled ? response : null;
      synchronizeDepthFromPage();
      if (navigationContext) reportSearchSessionForeground();
    });
  }

  function applyBlockingEnabled(enabled) {
    blockingEnabled = enabled !== false;
    if (!blockingEnabled) {
      clearBlockingArtifacts();
      return;
    }
    updatePageState();
    synchronizeDepthFromPage();
    if (global.document.body) processElement(global.document.body);
    refreshSearchSessionContext();
  }

  function refreshBlockingRules() {
    void loadBlockingRules().then((nextRules) => {
      if (nextRules) applyRules(nextRules);
    });
  }

  function markBlockingRuntimeVersion() {
    global.document?.documentElement?.setAttribute?.(
      BLOCKING_RUNTIME_ATTR,
      BLOCKING_RUNTIME_VERSION
    );
  }

  function init() {
    markBlockingRuntimeVersion();
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
      global.addEventListener('submit', handleSearchSubmit, true);
      global.addEventListener(
        'mysearch-blocking-navigation-attempt',
        handlePageNavigation,
        true
      );
      global.addEventListener(MEDIA_EVENT, handleMediaAttempt, true);
      global.addEventListener('play', handleNativeMediaPlay, true);
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
    void loadBlockingEnabled().then(enabled => {
      applyBlockingEnabled(enabled);
    });
    const initialRoot = global.document.body || global.document.documentElement;
    if (initialRoot) processElement(initialRoot);
    updatePageState();
  }

  global.chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes[BLOCKING_ENABLED_STORAGE_KEY]) {
      applyBlockingEnabled(changes[BLOCKING_ENABLED_STORAGE_KEY].newValue !== false);
    }
    if (changes[rulesApi.STORAGE_KEYS.KEYWORDS] ||
      changes[rulesApi.STORAGE_KEYS.URL_PATTERNS] ||
      changes[rulesApi.STORAGE_KEYS.AUTHORS] ||
      changes[rulesApi.STORAGE_KEYS.HIGH_RISK_DOMAINS]) {
      refreshBlockingRules();
    }
  });

  init();
  if (global.document.readyState === 'loading') {
    if (typeof global.document.addEventListener === 'function') {
      global.document.addEventListener('DOMContentLoaded', () => {
        markBlockingRuntimeVersion();
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
