/**
 * 将高风险站点的原生搜索组件整体替换为 MySearchPage 自绘入口。
 *
 * 抖音不依赖动态 class：以 searchbar-input 和 searchbar-button
 * 同属的最窄搜索专属祖先作为 owner；共同祖先还承载关闭、返回等
 * 原生控件时，只替换 input 所在分支，不移除共享外壳。
 */
(function installNativeSearchRedirect(global) {
  'use strict';

  const BUTTON_ATTR = 'data-msp-native-search-button';
  const ROOT_ATTR = 'data-msp-native-search-root';
  const SOURCE_ATTR = 'data-msp-native-search-source-root';
  const ACTIVE_ATTR = 'data-msp-native-search-active';
  const SHELL_ATTR = 'data-msp-native-search-shell';
  const BUTTON_TEXT = '搜索资料';
  const HIGH_RISK_KEY = 'highRiskDomains';
  const POPUP_SWEEP_INTERVAL_MS = 100;
  const POPUP_SWEEP_HOVER_WINDOW_MS = 6000;

  const DEFAULT_HIGH_RISK_DOMAINS = Object.freeze([
    'xiaohongshu.com',
    'douyin.com',
    'bilibili.com',
    'youtube.com',
  ]);

  const GOOGLE_SEARCH_CONFIG = Object.freeze({
    redirectAlways: true,
    requireVisibleInput: true,
    inputSelectors: Object.freeze(['input[name="q"]', 'textarea[name="q"]']),
    ownerSelectors: Object.freeze(['[role="search"]', 'form[action="/search"]', 'form[action*="/search?"]']),
    popupSelectors: Object.freeze([]),
  });

  const SITE_CONFIGS = Object.freeze({
    'google.com': GOOGLE_SEARCH_CONFIG,
    'google.com.hk': GOOGLE_SEARCH_CONFIG,
    'bing.com': Object.freeze({
      redirectAlways: true,
      requireVisibleInput: true,
      inputSelectors: Object.freeze([
        'input#sb_form_q', 'textarea#sb_form_q',
        'input[name="q"]', 'textarea[name="q"]',
      ]),
      ownerSelectors: Object.freeze([
        '.b_searchboxForm', '.b_searchbox', '#sb_form',
        'form[action="/search"]', 'form[action*="/search?"]',
      ]),
      popupSelectors: Object.freeze(['#sw_as', '#sa_ul']),
    }),
    'douyin.com': Object.freeze({
      requireVisibleOwner: true,
      inputSelectors: Object.freeze([
        'input[data-e2e="searchbar-input"]',
        'input[data-e2e*="search"]',
        'input[type="search"]',
        'input[placeholder*="搜索"]',
        '[data-e2e*="search"] input',
      ]),
      ownerSelectors: Object.freeze([
        '[data-e2e="searchbar-container"]',
        '[data-e2e="searchbar"]',
        '[data-e2e="search-box"]',
        'form[role="search"]',
      ]),
      submitSelector: '[data-e2e="searchbar-button"]',
      popupSelectors: Object.freeze([
        '[data-e2e*="search-history"]',
        '[data-e2e*="search-suggest"]',
        '[data-e2e*="search-hot"]',
        '[data-e2e*="search-trend"]',
        '[data-e2e*="search-recommend"]',
        '[data-e2e*="search"] [class*="history"]',
        '[data-e2e*="search"] [class*="suggest"]',
        '[data-e2e*="search"] [class*="hot"]',
        '[data-e2e*="search"] [class*="trend"]',
        '[class*="search-history"]',
        '[class*="search-suggest"]',
        '[class*="search-hot"]',
        '[class*="search-trend"]',
        '[class*="search-recommend"]',
        '[class*="search-panel"]',
        '[class*="search-popover"]',
        '[class*="search-dropdown"]',
      ]),
    }),
    'bilibili.com': Object.freeze({
      inputSelectors: Object.freeze([
        'input.nav-search-input',
        '.nav-search-content input',
        '#nav-searchform input',
        'input[placeholder*="搜索"]',
      ]),
      ownerSelectors: Object.freeze([
        '.center-search-container',
        '.bili-header__search',
        '.center-search__bar',
        '.nav-search-box',
        '#nav-searchform',
      ]),
      popupSelectors: Object.freeze([
        '.center-search-container .search-panel',
        '.center-search-container .trending',
        '.bili-header .search-panel',
        '[class*="search-panel"]',
        '[class*="search-suggest"]',
        '[class*="search-history"]',
        '[class*="hot-search"]',
      ]),
    }),
    'youtube.com': Object.freeze({
      inputSelectors: Object.freeze([
        'input#search',
        'input[name="search_query"]',
        'form#search-form input',
        'input[placeholder*="搜索"]',
        'input[placeholder*="Search"]',
      ]),
      ownerSelectors: Object.freeze([
        'ytd-searchbox',
        'ytm-searchbox',
        'yt-searchbox',
        'form#search-form',
      ]),
      popupSelectors: Object.freeze([
        'ytd-omnisearch-results',
        'ytd-searchbox [role="listbox"]',
        'ytm-searchbox [role="listbox"]',
      ]),
    }),
    'xiaohongshu.com': Object.freeze({
      preserveOwnerLayout: true,
      inputSelectors: Object.freeze([
        'input[data-testid*="search"]',
        'input[placeholder*="搜索"]',
        '[class*="search"] input',
      ]),
      ownerSelectors: Object.freeze([
        '[data-testid="search-bar"]',
        '[data-testid="searchbox"]',
        '[role="search"]',
        '.input-box',
      ]),
      residualSelectors: Object.freeze([
        'header .input-button',
        '.header-container .input-button',
        'header .min-width-search-icon',
        '.header-container .min-width-search-icon',
      ]),
      popupSelectors: Object.freeze([
        '.sug-pad',
        '[class*="search-suggest"]',
        '[class*="search-history"]',
        '[class*="search-hot"]',
      ]),
    }),
  });

  // 搜索浮层清理不得删除正文详情，也不得删除承载详情的共同外壳。
  const CONTENT_DETAIL_SELECTOR = [
    '.note-detail-mask', '.note-detail-container', '.note-detail', '.note-container',
    '[class*="noteDetailMask"]', '[class*="noteDetailContainer"]',
    '[data-e2e="modal-video-container"]', '[data-e2e="video-detail-modal"]',
    '[data-e2e="video-detail"]', '[data-e2e="detail-video"]',
    '[data-e2e="video-detail-container"]', '[data-e2e="modal-video"]',
    '#slidelist', '[data-e2e="slideList"]', '[data-e2e="feed-item"]',
    '[data-e2e="feed-active-video"]', '.video-detail-modal',
    '#video-page', '.video-detail-container', '.video-container-v1', '.bili-video-modal',
    'ytd-watch-flexy', 'ytd-watch-grid', 'ytm-watch', 'ytm-watch-page', 'ytm-player-page',
  ].join(',');

  const DYNAMIC_POPUP_CANDIDATE_SELECTOR = [
    '[role="listbox"]',
    '[role="dialog"]',
    '[role="menu"]',
    '[aria-modal="true"]',
    '[data-e2e]',
    '[class]',
    '[style]',
  ].join(',');

  const FORBIDDEN_POPUP_TEXT =
    /历史记录|猜你想搜|抖音热点|热榜/;

  const DOUYIN_OWNER_GUARD_SELECTOR = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    'img',
    'video',
    'svg',
    '[onclick]',
    '[data-e2e*="close" i]',
    '[data-e2e*="back" i]',
    '[aria-label*="关闭"]',
    '[aria-label*="返回"]',
    '[aria-label*="close" i]',
    '[aria-label*="back" i]',
    '[title*="关闭"]',
    '[title*="返回"]',
  ].join(',');

  const DOUYIN_OWNER_STOP_TAGS = new Set([
    'HTML',
    'BODY',
    'HEADER',
    'NAV',
    'MAIN',
    'ASIDE',
  ]);

  function normalizeDomain(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^\*\./, '')
      .replace(/^\.+|\.+$/g, '');
  }

  function normalizeDomains(values) {
    return Array.from(new Set(
      (Array.isArray(values) ? values : [])
        .map(normalizeDomain)
        .filter(Boolean)
    ));
  }

  function hostMatchesDomain(hostname, domain) {
    const host = normalizeDomain(hostname);
    const target = normalizeDomain(domain);
    return Boolean(target) &&
      (host === target || host.endsWith(`.${target}`));
  }

  function getTargetSite(
    hostname,
    highRiskDomains = DEFAULT_HIGH_RISK_DOMAINS
  ) {
    const allowedDomains = normalizeDomains(highRiskDomains);
    const configuredDomain = Object.keys(SITE_CONFIGS).find(domain =>
      hostMatchesDomain(hostname, domain)
    );

    if (
      !configuredDomain ||
      (!SITE_CONFIGS[configuredDomain].redirectAlways &&
        !allowedDomains.some(domain => hostMatchesDomain(hostname, domain)))
    ) {
      return null;
    }

    return {
      siteDomain: configuredDomain,
      ...SITE_CONFIGS[configuredDomain],
    };
  }

  function safeMatches(element, selector) {
    try {
      return Boolean(element?.matches?.(selector));
    } catch (error) {
      return false;
    }
  }

  function safeQuery(root, selector) {
    try {
      return root?.querySelector?.(selector) || null;
    } catch (error) {
      return null;
    }
  }

  function safeQueryAll(root, selector) {
    try {
      return Array.from(
        root?.querySelectorAll?.(selector) || []
      );
    } catch (error) {
      return [];
    }
  }

  function removeElement(element) {
    if (!element) return;
    if (typeof element.remove === 'function') {
      element.remove();
      return;
    }
    element.parentNode?.removeChild?.(element);
  }

  function containsContentDetail(element) {
    return Boolean(element?.matches?.(CONTENT_DETAIL_SELECTOR) ||
      element?.querySelector?.(CONTENT_DETAIL_SELECTOR));
  }

  function hasForbiddenPopupText(element) {
    const text = String(element?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    return Boolean(
      text &&
      text.length <= 2000 &&
      FORBIDDEN_POPUP_TEXT.test(text)
    );
  }

  function isLikelyDynamicSearchPopup(
    element,
    replacementRoot,
    windowRef = global
  ) {
    if (
      !element ||
      !replacementRoot ||
      element === replacementRoot ||
      replacementRoot.contains?.(element) ||
      element.contains?.(replacementRoot)
    ) {
      return false;
    }
    if (containsContentDetail(element) || element.closest?.(CONTENT_DETAIL_SELECTOR)) return false;

    if (!hasForbiddenPopupText(element)) return false;

    let style = null;
    try {
      style = windowRef?.getComputedStyle?.(element) || null;
    } catch (error) {
      style = null;
    }

    const role = String(
      element.getAttribute?.('role') || ''
    ).toLowerCase();
    const dataE2e = String(
      element.getAttribute?.('data-e2e') || ''
    );
    const className =
      typeof element.className === 'string'
        ? element.className
        : String(element.getAttribute?.('class') || '');
    const position = String(
      style?.position ||
      element.style?.position ||
      ''
    ).toLowerCase();

    const metadata = `${dataE2e} ${className}`;
    const explicitPopupMetadata =
      /popup|popover|dropdown/i.test(metadata) ||
      /search[-_\s]*(?:history|suggest|hot|trend|recommend)/i
        .test(metadata);

    const overlayLike =
      ['listbox', 'dialog', 'menu'].includes(role) ||
      element.getAttribute?.('aria-modal') === 'true' ||
      ['absolute', 'fixed'].includes(position) ||
      explicitPopupMetadata;

    if (!overlayLike) return false;
    if (
      typeof element.getBoundingClientRect !== 'function' ||
      typeof replacementRoot.getBoundingClientRect !== 'function'
    ) {
      return false;
    }

    let popupRect;
    let rootRect;
    try {
      popupRect = element.getBoundingClientRect();
      rootRect = replacementRoot.getBoundingClientRect();
    } catch (error) {
      return false;
    }

    const values = [
      popupRect.left,
      popupRect.right,
      popupRect.top,
      popupRect.bottom,
      rootRect.left,
      rootRect.right,
      rootRect.top,
      rootRect.bottom,
    ];
    if (!values.every(Number.isFinite)) return false;

    const horizontalOverlap =
      popupRect.right >= rootRect.left - 120 &&
      popupRect.left <= rootRect.right + 120;
    const verticalProximity =
      popupRect.bottom >= rootRect.top - 80 &&
      popupRect.top <= rootRect.bottom + 900;

    return horizontalOverlap && verticalProximity;
  }

  function hoistReplacementOutOfOwner(
    owner,
    replacementRoot
  ) {
    if (
      !owner ||
      !replacementRoot ||
      owner === replacementRoot ||
      !owner.parentNode ||
      !replacementRoot.parentNode ||
      !owner.contains?.(replacementRoot)
    ) {
      return false;
    }

    const parent = owner.parentNode;
    replacementRoot.parentNode.removeChild(replacementRoot);
    parent.replaceChild(replacementRoot, owner);
    return true;
  }

  function relocateReplacementToOwner(
    owner,
    replacementRoot
  ) {
    if (
      !owner ||
      !replacementRoot ||
      owner === replacementRoot ||
      !owner.parentNode ||
      owner.contains?.(replacementRoot) ||
      replacementRoot.contains?.(owner)
    ) {
      return false;
    }

    try {
      owner.parentNode.replaceChild(
        replacementRoot,
        owner
      );
      return true;
    } catch (error) {
      return false;
    }
  }

  function matchesAnySelector(element, selectors) {
    return Array.from(selectors || []).some(selector =>
      safeMatches(element, selector)
    );
  }

  function containsAnySelector(root, selectors) {
    return Array.from(selectors || []).some(selector =>
      safeMatches(root, selector) ||
      Boolean(safeQuery(root, selector))
    );
  }

  function douyinControlMetadata(element) {
    return [
      element?.getAttribute?.('data-e2e') || '',
      element?.getAttribute?.('aria-label') || '',
      element?.getAttribute?.('title') || '',
      element?.getAttribute?.('placeholder') || '',
      typeof element?.className === 'string'
        ? element.className
        : element?.getAttribute?.('class') || '',
      String(element?.textContent || '').slice(0, 120),
    ].join(' ');
  }

  function isDouyinCloseControl(element) {
    return /close|back|关闭|返回|退出/i.test(
      douyinControlMetadata(element)
    );
  }

  function directChildWithin(ancestor, element) {
    if (!ancestor || !element) return null;
    if (ancestor === element) return element;

    let current = element;
    for (
      let depth = 0;
      current && depth < 16;
      depth += 1
    ) {
      const parent =
        current.parentElement ||
        current.parentNode ||
        null;
      if (parent === ancestor) return current;
      current = parent;
    }

    return null;
  }

  function douyinOwnerHasUnrelatedControls(
    owner,
    input,
    submit,
    targetSite
  ) {
    if (!owner) return false;

    return safeQueryAll(
      owner,
      DOUYIN_OWNER_GUARD_SELECTOR
    ).some(element => {
      if (element === input || element === submit) {
        return false;
      }
      if (
        input?.contains?.(element) ||
        submit?.contains?.(element)
      ) {
        return false;
      }
      return !isDouyinSearchRelatedControl(
        element,
        null,
        targetSite
      );
    });
  }

  function narrowDouyinSearchOwner(
    owner,
    input,
    submit,
    targetSite
  ) {
    let candidate = owner;

    for (
      let depth = 0;
      candidate && depth < 16;
      depth += 1
    ) {
      if (!douyinOwnerHasUnrelatedControls(
        candidate,
        input,
        submit,
        targetSite
      )) {
        return candidate;
      }

      const next = directChildWithin(
        candidate,
        input
      );
      if (!next || next === candidate) return input;
      candidate = next;
    }

    return input;
  }

  function isDouyinSearchRelatedControl(
    element,
    currentOwner,
    targetSite
  ) {
    if (!element) return true;
    if (isDouyinCloseControl(element)) return false;
    if (currentOwner?.contains?.(element)) return true;

    if (
      targetSite?.submitSelector &&
      safeMatches(element, targetSite.submitSelector)
    ) {
      return true;
    }

    if (
      matchesAnySelector(
        element,
        targetSite?.inputSelectors
      )
    ) {
      return true;
    }

    return /search|搜索/i.test(
      douyinControlMetadata(element)
    );
  }

  function canExpandDouyinSearchOwner(
    candidate,
    currentOwner,
    targetSite
  ) {
    if (
      !candidate ||
      !currentOwner ||
      !candidate.contains?.(currentOwner)
    ) {
      return false;
    }

    const tagName = String(
      candidate.tagName || ''
    ).toUpperCase();
    if (DOUYIN_OWNER_STOP_TAGS.has(tagName)) {
      return false;
    }

    // Unmarked wrappers may be React portal hosts, even while they contain
    // only search controls. Never detach them based on absent controls alone.
    if (!matchesAnySelector(candidate, targetSite?.ownerSelectors)) {
      return false;
    }

    if (
      !targetSite?.submitSelector ||
      !safeQuery(candidate, targetSite.submitSelector) ||
      !containsAnySelector(
        candidate,
        targetSite.inputSelectors
      )
    ) {
      return false;
    }

    if (
      safeMatches(
        candidate,
        DOUYIN_OWNER_GUARD_SELECTOR
      ) &&
      !isDouyinSearchRelatedControl(
        candidate,
        currentOwner,
        targetSite
      )
    ) {
      return false;
    }

    return safeQueryAll(
      candidate,
      DOUYIN_OWNER_GUARD_SELECTOR
    ).every(element =>
      isDouyinSearchRelatedControl(
        element,
        currentOwner,
        targetSite
      )
    );
  }

  function findDouyinSearchOwner(input, targetSite) {
    if (
      targetSite?.siteDomain !== 'douyin.com' ||
      !input ||
      !targetSite.submitSelector
    ) {
      return null;
    }

    let owner = null;
    let submit = null;
    let current =
      input.parentElement ||
      input.parentNode ||
      null;

    for (let depth = 0; current && depth < 12; depth += 1) {
      const candidateSubmit = safeQuery(
        current,
        targetSite.submitSelector
      );
      if (candidateSubmit) {
        owner = current;
        submit = candidateSubmit;
        break;
      }
      current =
        current.parentElement ||
        current.parentNode ||
        null;
    }

    if (!owner || !submit) return null;

    const safeOwner = narrowDouyinSearchOwner(
      owner,
      input,
      submit,
      targetSite
    );
    if (safeOwner !== owner) return safeOwner;

    /*
     * 稳定站点 selector 命中更外层搜索 owner 时优先使用。
     * 动态 class 不参与该判断。
     */
    for (const selector of targetSite.ownerSelectors || []) {
      try {
        const configuredOwner = input.closest?.(selector);
        const configuredSubmit = configuredOwner
          ? safeQuery(
            configuredOwner,
            targetSite.submitSelector
          )
          : null;
        if (
          configuredOwner &&
          configuredOwner.contains?.(owner) &&
          configuredSubmit &&
          !douyinOwnerHasUnrelatedControls(
            configuredOwner,
            input,
            configuredSubmit,
            targetSite
          )
        ) {
          owner = configuredOwner;
          submit = configuredSubmit;
          break;
        }
      } catch (error) {
        // 单个站点 selector 失效时继续使用结构边界。
      }
    }

    /*
     * 外层包装节点也可能是详情 portal 的长期挂载点。
     * 只有明确标识为搜索区域的包装层允许整体替换；
     * 不以“暂时没有无关控件”作为删除无标识祖先的依据。
     */
    for (let depth = 0; depth < 4; depth += 1) {
      const parent =
        owner.parentElement ||
        owner.parentNode ||
        null;

      if (
        !canExpandDouyinSearchOwner(
          parent,
          owner,
          targetSite
        )
      ) {
        break;
      }

      owner = parent;
    }

    return owner;
  }

  function closestConfiguredOwner(input, targetSite) {
    for (const selector of targetSite?.ownerSelectors || []) {
      try {
        const owner = input?.closest?.(selector);
        if (owner) return owner;
      } catch (error) {
        // 单个选择器失效时继续尝试其余稳定证据。
      }
    }
    return null;
  }

  function isRenderedSearchControl(element, windowRef = global, requireBox = true) {
    if (!element || String(element.getAttribute?.('type') || '').toLowerCase() === 'hidden') return false;
    for (let current = element; current; current = current.parentElement) {
      if (current.hasAttribute?.('hidden') || current.getAttribute?.('aria-hidden') === 'true') return false;
      const style = windowRef.getComputedStyle?.(current);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
    }
    if (requireBox && typeof element.getBoundingClientRect === 'function') {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
    return true;
  }

  function findSearchOwner(input, targetSite) {
    if (!input || !targetSite) return null;

    if (targetSite.siteDomain === 'douyin.com') {
      return findDouyinSearchOwner(input, targetSite);
    }

    return closestConfiguredOwner(input, targetSite) ||
      input.parentElement ||
      input.parentNode ||
      null;
  }

  function ownerSource(owner, targetSite) {
    if (targetSite?.siteDomain === 'douyin.com') {
      return 'douyin-owner-with-submit';
    }

    for (const selector of targetSite?.ownerSelectors || []) {
      if (safeMatches(owner, selector)) return selector;
    }
    return 'fallback-owner';
  }

  function collectObserverBatchPlan(mutations) {
    const roots = new Set();
    const addRoot = root => {
      if (root) roots.add(root);
    };

    for (const mutation of Array.from(mutations || [])) {
      const type = String(mutation?.type || 'unknown');

      if (type === 'childList') {
        for (const node of Array.from(
          mutation.addedNodes || []
        )) {
          addRoot(node);
        }
        addRoot(mutation.target);
      } else if (type === 'attributes') {
        addRoot(
          mutation.target?.parentElement ||
          mutation.target
        );
      } else if (type === 'characterData') {
        addRoot(
          mutation.target?.parentElement ||
          mutation.target?.parentNode ||
          null
        );
      }
    }

    return {
      roots: Array.from(roots),
    };
  }

  function sendMessage(chromeApi, message) {
    return new Promise(resolve => {
      let settled = false;
      const finish = response => {
        if (settled) return;
        settled = true;
        resolve(response || null);
      };

      try {
        const result = chromeApi?.runtime?.sendMessage?.(
          message,
          finish
        );
        if (result && typeof result.then === 'function') {
          result.then(finish).catch(() => finish(null));
        }
      } catch (error) {
        finish(null);
      }
    });
  }

  async function loadHighRiskDomains(chromeApi) {
    const response = await sendMessage(chromeApi, {
      type: 'GET_BLOCKING_RULES',
    });

    if (Array.isArray(response?.rules?.highRiskDomains)) {
      return normalizeDomains([
        ...DEFAULT_HIGH_RISK_DOMAINS,
        ...response.rules.highRiskDomains,
      ]);
    }

    try {
      const stored = await chromeApi?.storage?.local?.get?.(
        HIGH_RISK_KEY
      );
      return normalizeDomains([
        ...DEFAULT_HIGH_RISK_DOMAINS,
        ...(stored?.[HIGH_RISK_KEY] || []),
      ]);
    } catch (error) {
      return [...DEFAULT_HIGH_RISK_DOMAINS];
    }
  }

  function searchKeywordForInput(input, href, siteDomain) {
    if (typeof input?.value === 'string' && input.value) return input.value;
    try {
      const url = new URL(href);
      if (siteDomain === 'douyin.com') {
        const match = url.pathname.match(/^\/(?:jingxuan\/)?search\/([^/]+)/);
        if (match) return decodeURIComponent(match[1]);
      }
      const names = siteDomain?.startsWith('google.') ? ['q'] : ['keyword', 'search_query', 'q'];
      for (const name of names) {
        if (url.searchParams.has(name)) return url.searchParams.get(name);
      }
    } catch (error) {
      // 地址尚未就绪时仍展示空搜索入口。
    }
    return '';
  }

  function applySearchOwnerLayout(root, owner, targetSite, href = '') {
    if (targetSite?.siteDomain?.startsWith('google.')) {
      let home = false;
      try {
        const url = new URL(href);
        home = ['/', '/webhp'].includes(url.pathname) && !url.searchParams.get('q');
      } catch (error) {
        // 地址未就绪时保留普通搜索入口布局。
      }
      if (home) root.setAttribute('data-msp-native-search-layout', 'google-home');
      else if (root.getAttribute?.('data-msp-native-search-layout') === 'google-home') {
        root.removeAttribute('data-msp-native-search-layout');
        root.style?.removeProperty?.('align-self');
        root.style?.removeProperty?.('max-width');
      }
      return;
    }
    if (!targetSite?.preserveOwnerLayout || root === owner || root.contains?.(owner)) return;
    // 保留搜索定位及 Vue 样式作用域，不复制原生事件、其他 data-* 或弹层状态。
    for (const name of ['class', 'id', 'style']) {
      const value = owner.getAttribute?.(name);
      if (value) root.setAttribute(name, value);
      else root.removeAttribute?.(name);
    }
    root.className = `${root.getAttribute?.('class') || ''} msp-native-search-entry`.trim();
    for (const attribute of Array.from(root.attributes || [])) {
      if (attribute.name.startsWith('data-v-')) root.removeAttribute(attribute.name);
    }
    for (const attribute of Array.from(owner.attributes || [])) {
      if (attribute.name.startsWith('data-v-')) root.setAttribute(attribute.name, attribute.value);
    }
    root.setAttribute('data-msp-native-search-layout', 'preserve');
  }

  function createReplacementRoot(documentRef, owner, targetSite, href = '') {
    const root = documentRef.createElement('div');
    root.className = 'msp-native-search-entry';
    applySearchOwnerLayout(root, owner, targetSite, href);
    return root;
  }

  function setReplacementRootStyle(root) {
    const declarations = {
      'box-sizing': 'border-box',
      display: 'inline-flex',
      'align-items': 'center',
      'justify-content': 'center',
      width: 'auto',
      position: 'relative',
      'z-index': '1',
      flex: '0 0 auto',
      'min-width': 'var(--msp-search-min-width, 104px)',
      'min-height': 'var(--msp-search-min-height, 36px)',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'transparent',
      opacity: '1',
      visibility: 'visible',
      'pointer-events': 'auto',
    };

    if (root.getAttribute?.('data-msp-native-search-layout') === 'google-home') {
      Object.assign(declarations, {
        display: 'flex', width: 'fit-content', margin: '0 auto',
        'align-self': 'center', 'max-width': '100%',
      });
    }

    for (const [name, value] of Object.entries(declarations)) {
      if (root.getAttribute?.('data-msp-native-search-layout') === 'preserve' &&
          ['width', 'position', 'flex', 'margin', 'min-width', 'min-height'].includes(name)) continue;
      root.style?.setProperty?.(name, value, 'important');
    }
  }

  function setButtonStyle(button) {
    const declarations = {
      'box-sizing': 'border-box',
      display: 'inline-flex',
      'align-items': 'center',
      'justify-content': 'center',
      width: 'var(--msp-search-width, min(420px, 28vw))',
      'min-width': 'var(--msp-search-min-width, 104px)',
      'min-height': 'var(--msp-search-min-height, 36px)',
      padding: 'var(--msp-search-padding, 10px 40px 10px 6px)',
      border: '1px solid #000',
      'border-radius': '2px',
      background: '#fff',
      color: '#000',
      cursor: 'text',
      'font-size': 'var(--msp-search-font-size, 16px)',
      'font-weight': '400',
      'text-align': 'left',
      'line-height': '1.2',
      opacity: '1',
      visibility: 'visible',
      'pointer-events': 'auto',
    };

    for (const [name, value] of Object.entries(declarations)) {
      button.style?.setProperty?.(name, value, 'important');
    }
  }

  function createController({
    window: windowRef = global,
    document: documentRef = global.document,
    chrome: chromeApi = global.chrome,
  } = {}) {
    let targetSite = null;
    let observer = null;
    let popupSweepTimer = null;
    let popupSweepWindowStopTimer = null;
    let destroyed = false;
    let storageListenerInstalled = false;
    let documentGuardsInstalled = false;

    const replacementStates = new Set();
    const documentGuardEntries = [];
    const dynamicPopupCandidates = new Set();
    const searchShellStates = new Map();
    const douyinSearchSlots = new Map();
    let searchShellStyle = null;

    function restoreSearchShell(shell, state) {
      shell.removeAttribute?.(SHELL_ATTR);
      if (shell.style?.getPropertyValue('display') === 'contents' &&
          shell.style.getPropertyPriority('display') === 'important') {
        if (state.value) shell.style.setProperty('display', state.value, state.priority);
        else shell.style.removeProperty('display');
      }
      searchShellStates.delete(shell);
    }

    function reconcileSearchShells() {
      const eligible = new Set();
      const entry = currentReplacementRoot();
      if (targetSite?.siteDomain === 'douyin.com' && entry) {
        for (let shell = entry.parentElement, depth = 0; shell && depth < 6; shell = shell.parentElement, depth += 1) {
          if (DOUYIN_OWNER_STOP_TAGS.has(shell.tagName) ||
              safeMatches(shell, '[role="navigation"], [role="main"], [role="dialog"], [aria-modal="true"]')) break;
          if (safeQuery(shell, 'video, canvas, [data-e2e="modal-video-container"], [data-e2e="feed-active-video"]')) break;
          if (safeQueryAll(shell, DOUYIN_OWNER_GUARD_SELECTOR).some(control =>
            !entry.contains?.(control) && !isDouyinSearchRelatedControl(control, null, targetSite)
          )) break;
          const style = windowRef.getComputedStyle?.(shell);
          if (shell.hasAttribute?.('hidden') || shell.getAttribute?.('aria-hidden') === 'true' || style?.display === 'none') break;
          const metadata = `${shell.getAttribute?.('data-e2e') || ''} ${shell.getAttribute?.('class') || ''}`;
          const decorated = parseFloat(style?.borderTopWidth) > 0 || parseFloat(style?.borderLeftWidth) > 0 ||
            (style?.backgroundColor && !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.backgroundColor)) ||
            (style?.boxShadow && style.boxShadow !== 'none');
          if (/search/i.test(metadata) || decorated) eligible.add(shell);
        }
      }
      for (const [shell, state] of searchShellStates) {
        if (!eligible.has(shell)) restoreSearchShell(shell, state);
      }
      if (eligible.size && !searchShellStyle && documentRef?.createElement) {
        // Pseudo-elements belong to the native shell, not the replacement button.
        searchShellStyle = documentRef.createElement('style');
        searchShellStyle.textContent = `
          html[${ACTIVE_ATTR}="douyin.com"] [${SHELL_ATTR}="true"]::before,
          html[${ACTIVE_ATTR}="douyin.com"] [${SHELL_ATTR}="true"]::after {
            display: none !important; content: none !important;
          }
        `;
        (documentRef.head || documentRef.documentElement)?.appendChild(searchShellStyle);
      }
      for (const shell of eligible) {
        const value = shell.style?.getPropertyValue('display') || '';
        const priority = shell.style?.getPropertyPriority('display') || '';
        if (!searchShellStates.has(shell) || value !== 'contents' || priority !== 'important') {
          searchShellStates.set(shell, { value, priority });
          shell.style?.setProperty('display', 'contents', 'important');
        }
        if (shell.getAttribute?.(SHELL_ATTR) !== 'true') shell.setAttribute?.(SHELL_ATTR, 'true');
      }
    }


    function setActiveSite(site) {
      const root = documentRef?.documentElement;
      if (!root) return;

      if (site?.siteDomain) {
        root.setAttribute?.(ACTIVE_ATTR, site.siteDomain);
      } else {
        root.removeAttribute?.(ACTIVE_ATTR);
      }
    }

    function popupSelectors() {
      return targetSite?.popupSelectors || [];
    }

    function currentReplacementRoot() {
      return documentRef?.querySelector?.(
        `[${ROOT_ATTR}="true"]`
      ) || null;
    }

    function purgeNativeSearchResidue(root) {
      let removed = 0;
      for (const selector of targetSite?.residualSelectors || []) {
        const nodes = new Set(safeQueryAll(root, selector));
        if (safeMatches(root, selector)) nodes.add(root);
        for (const element of nodes) {
          if (element.closest?.(`[${ROOT_ATTR}="true"]`) &&
              !element.matches?.('.input-button, .min-width-search-icon')) continue;
          removeElement(element);
          removed += 1;
        }
      }
      return removed;
    }

    function purgeXiaohongshuOnReturn() {
      if (targetSite?.siteDomain !== 'xiaohongshu.com' || destroyed) return;
      purgeAllPopups();
    }

    function purgePopupSubtree(root) {
      if (!root || !targetSite) return 0;

      const matches = new Set();
      for (const selector of popupSelectors()) {
        if (safeMatches(root, selector)) {
          matches.add(root);
        }
        for (const element of safeQueryAll(root, selector)) {
          matches.add(element);
        }
      }

      for (const element of matches) {
        const replacementRoot = currentReplacementRoot();
        if (element === replacementRoot || element.contains?.(replacementRoot)) continue;
        if (containsContentDetail(element)) continue;
        removeElement(element);
      }
      return matches.size;
    }

    function considerDynamicPopup(element) {
      const replacementRoot = currentReplacementRoot();
      if (!element || !replacementRoot) return 0;

      if (!hasForbiddenPopupText(element)) {
        dynamicPopupCandidates.delete(element);
        return 0;
      }

      dynamicPopupCandidates.add(element);
      if (!isLikelyDynamicSearchPopup(
        element,
        replacementRoot,
        windowRef
      )) {
        return 0;
      }

      removeElement(element);
      dynamicPopupCandidates.delete(element);
      return 1;
    }

    function purgeDynamicPopupSubtree(root) {
      if (!root || !targetSite) return 0;
      if (!currentReplacementRoot()) return 0;

      const candidates = new Set();
      if (root.nodeType === 1) candidates.add(root);
      for (const element of safeQueryAll(
        root,
        DYNAMIC_POPUP_CANDIDATE_SELECTOR
      )) {
        candidates.add(element);
      }

      let removed = 0;
      for (const element of candidates) {
        removed += considerDynamicPopup(element);
      }
      return removed;
    }

    function purgeTrackedDynamicPopups() {
      if (!currentReplacementRoot()) {
        dynamicPopupCandidates.clear();
        return 0;
      }

      let removed = 0;
      for (const element of Array.from(
        dynamicPopupCandidates
      )) {
        if (!element || element.isConnected === false) {
          dynamicPopupCandidates.delete(element);
          continue;
        }
        removed += considerDynamicPopup(element);
      }
      return removed;
    }

    function purgeAllPopups() {
      return purgePopupSubtree(documentRef) +
        purgeTrackedDynamicPopups() + purgeNativeSearchResidue(documentRef);
    }

    function popupSweepTick() {
      purgeAllPopups();
    }

    function clearPopupSweepWindowStopTimer() {
      if (popupSweepWindowStopTimer == null) return;
      windowRef.clearTimeout?.(
        popupSweepWindowStopTimer
      );
      popupSweepWindowStopTimer = null;
    }

    function stopPopupSweep() {
      clearPopupSweepWindowStopTimer();
      if (popupSweepTimer == null) return false;

      windowRef.clearInterval?.(popupSweepTimer);
      popupSweepTimer = null;
      return true;
    }

    function armPopupSweepWindow() {
      if (popupSweepTimer != null) return false;
      if (
        typeof windowRef?.setInterval !== 'function' ||
        typeof windowRef?.setTimeout !== 'function'
      ) {
        return false;
      }

      popupSweepTimer = windowRef.setInterval(
        popupSweepTick,
        POPUP_SWEEP_INTERVAL_MS
      );
      popupSweepWindowStopTimer =
        windowRef.setTimeout(() => {
          popupSweepWindowStopTimer = null;
          if (popupSweepTimer != null) {
            windowRef.clearInterval?.(popupSweepTimer);
            popupSweepTimer = null;
          }
        }, POPUP_SWEEP_HOVER_WINDOW_MS);

      return true;
    }

    function stopOriginalHover(event) {
      const replacementRoot = event?.target?.closest?.(
        `[${ROOT_ATTR}="true"]`
      );
      if (!replacementRoot) return;

      armPopupSweepWindow();
      purgeAllPopups();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
    }

    function installDocumentGuards() {
      if (
        documentGuardsInstalled ||
        typeof documentRef?.addEventListener !== 'function'
      ) {
        return;
      }

      documentGuardsInstalled = true;
      for (const eventType of [
        'mouseover',
        'mouseenter',
        'mousemove',
        'pointerover',
        'pointerenter',
        'pointermove',
        'focusin',
      ].concat(targetSite?.siteDomain === 'xiaohongshu.com' ? ['pointerdown', 'mousedown', 'focus'] : [])) {
        documentRef.addEventListener(
          eventType,
          stopOriginalHover,
          true
        );
        documentGuardEntries.push(eventType);
      }
      documentRef.addEventListener('visibilitychange', purgeXiaohongshuOnReturn, true);
      windowRef.addEventListener?.('pageshow', purgeXiaohongshuOnReturn, true);
      windowRef.addEventListener?.('focus', purgeXiaohongshuOnReturn, true);
    }

    function removeDocumentGuards() {
      for (const eventType of documentGuardEntries) {
        documentRef?.removeEventListener?.(
          eventType,
          stopOriginalHover,
          true
        );
      }
      documentGuardEntries.length = 0;
      documentRef?.removeEventListener?.('visibilitychange', purgeXiaohongshuOnReturn, true);
      windowRef.removeEventListener?.('pageshow', purgeXiaohongshuOnReturn, true);
      windowRef.removeEventListener?.('focus', purgeXiaohongshuOnReturn, true);
      documentGuardsInstalled = false;
    }

    function redirectToMySearchPage(event) {
      const input = event?.currentTarget;
      if (!input) return;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      // 先让浏览器完成本次点击的原生光标定位，再采集选区。
      // 异步回调只保留控件引用，不读取派发结束后已失效的 currentTarget。
      windowRef.setTimeout(() => {
        const searchContext = {
          keyword: input.value,
          selectionStart: input.selectionStart,
          selectionEnd: input.selectionEnd,
          selectionDirection: input.selectionDirection,
        };
        purgeAllPopups();
        void sendMessage(chromeApi, {
          type: 'OPEN_MYSEARCH_PAGE',
          searchContext,
        });
      }, 0);
    }

    function existingButton() {
      const connected = documentRef?.querySelector?.(`[${BUTTON_ATTR}="true"]`) || null;
      if (connected || targetSite?.siteDomain !== 'douyin.com') return connected;
      // 播放层或头部卸载后仍复用同一入口，保留关键词、选区和监听器。
      return Array.from(replacementStates).reverse()
        .map(state => safeQuery(state.replacementRoot, `[${BUTTON_ATTR}="true"]`))
        .find(Boolean) || null;
    }

    function forgetReplacementRoot(replacementRoot) {
      for (const state of Array.from(
        replacementStates
      )) {
        if (state.replacementRoot === replacementRoot) {
          replacementStates.delete(state);
        }
      }
    }

    function rememberReplacement(
      owner,
      replacementRoot
    ) {
      forgetReplacementRoot(replacementRoot);
      replacementStates.add({
        owner,
        replacementRoot,
      });
    }

    function removeNativeSearchControls(root) {
      for (const selector of targetSite?.inputSelectors || []) {
        for (const input of safeQueryAll(root, selector)) {
          if (input.getAttribute?.(BUTTON_ATTR) !== 'true') removeElement(input);
        }
      }

      if (targetSite?.submitSelector) {
        for (const submit of safeQueryAll(
          root,
          targetSite.submitSelector
        )) {
          removeElement(submit);
        }
      }
    }

    function rememberDouyinSearchSlot(owner, replacementRoot) {
      if (targetSite?.siteDomain !== 'douyin.com' || !documentRef.createComment ||
          !owner?.parentNode || owner === replacementRoot || replacementRoot.contains?.(owner)) return;
      const parent = owner.parentNode;
      const previous = douyinSearchSlots.get(parent);
      if (previous?.owner === owner && previous.anchor.parentNode === parent) {
        previous.replacementRoot = replacementRoot;
        return;
      }
      if (previous) removeElement(previous.anchor);
      const anchor = documentRef.createComment('msp-douyin-search-slot');
      const nextSibling = owner.nextSibling;
      parent.insertBefore(anchor, owner);
      douyinSearchSlots.set(parent, { owner, anchor, nextSibling, replacementRoot });
    }

    function reconcileDouyinSearchEntry() {
      if (targetSite?.siteDomain !== 'douyin.com' || destroyed) return false;
      const entry = currentReplacementRoot() || Array.from(douyinSearchSlots.values())
        .map(slot => slot.replacementRoot).find(root => safeQuery(root, `[${BUTTON_ATTR}="true"]`));
      for (const [parent, slot] of douyinSearchSlots) {
        if (!documentRef.documentElement?.contains?.(parent)) {
          removeElement(slot.anchor);
          douyinSearchSlots.delete(parent);
        }
      }
      if (!entry || (entry.isConnected !== false &&
          isRenderedSearchControl(safeQuery(entry, `[${BUTTON_ATTR}="true"]`), windowRef))) return false;
      for (const [parent, slot] of douyinSearchSlots) {
        // display:contents 外壳没有矩形；这里只检查挂载点祖先的隐藏状态。
        if (!isRenderedSearchControl(parent, windowRef, false)) continue;
        if (slot.anchor.parentNode !== parent) {
          parent.insertBefore(slot.anchor, slot.nextSibling?.parentNode === parent ? slot.nextSibling : null);
        }
        if (slot.anchor.nextSibling === entry) return false;
        parent.insertBefore(entry, slot.anchor.nextSibling);
        rememberReplacement(slot.owner, entry);
        return true;
      }
      return false;
    }

    function replaceOwner(owner, sourceInput) {
      if (
        !owner ||
        !owner.parentNode ||
        typeof documentRef?.createElement !== 'function'
      ) {
        return null;
      }

      let currentButton = existingButton();
      if (currentButton) {
        const currentRoot = currentButton.closest?.(
          `[${ROOT_ATTR}="true"]`
        );

        if (!currentRoot) {
          removeElement(currentButton);
          currentButton = null;
        } else {
          applySearchOwnerLayout(currentRoot, owner, targetSite, windowRef.location?.href);
          setReplacementRootStyle(currentRoot);
          setButtonStyle(currentButton);
          currentButton.value = searchKeywordForInput(sourceInput, windowRef.location?.href, targetSite.siteDomain);
          currentRoot.setAttribute(
            SOURCE_ATTR,
            ownerSource(owner, targetSite)
          );

          if (
            owner === currentRoot ||
            currentRoot.contains?.(owner)
          ) {
            removeNativeSearchControls(currentRoot);
            purgeAllPopups();
            return currentButton;
          }

          rememberDouyinSearchSlot(owner, currentRoot);
          const placed = owner.contains?.(currentRoot)
            ? hoistReplacementOutOfOwner(
              owner,
              currentRoot
            )
            : relocateReplacementToOwner(
              owner,
              currentRoot
            );

          if (placed) {
            rememberReplacement(owner, currentRoot);
            purgeAllPopups();
            return currentButton;
          }

          forgetReplacementRoot(currentRoot);
          removeElement(currentRoot);
        }
      }

      const parent = owner.parentNode;
      const replacementRoot = createReplacementRoot(documentRef, owner, targetSite, windowRef.location?.href);
      replacementRoot.setAttribute(ROOT_ATTR, 'true');
      replacementRoot.setAttribute(
        SOURCE_ATTR,
        ownerSource(owner, targetSite)
      );
      setReplacementRootStyle(replacementRoot);

      const button = documentRef.createElement('input');
      button.type = 'text';
      button.readOnly = true;
      button.autocomplete = 'off';
      button.spellcheck = false;
      button.placeholder = BUTTON_TEXT;
      button.value = searchKeywordForInput(sourceInput, windowRef.location?.href, targetSite.siteDomain);
      button.setAttribute(BUTTON_ATTR, 'true');
      button.setAttribute(
        'aria-label',
        BUTTON_TEXT
      );
      setButtonStyle(button);

      button.addEventListener?.(
        'click',
        redirectToMySearchPage,
        true
      );
      button.addEventListener?.('keydown', event => {
        if (event.key === 'Enter') {
          redirectToMySearchPage(event);
        }
      }, true);

      replacementRoot.appendChild(button);
      rememberDouyinSearchSlot(owner, replacementRoot);
      parent.replaceChild(replacementRoot, owner);
      rememberReplacement(owner, replacementRoot);

      purgeDynamicPopupSubtree(documentRef);
      purgeAllPopups();
      return button;
    }

    function collectSearchInputs(root) {
      const inputs = new Set();
      if (!root || !targetSite) return inputs;

      for (const selector of targetSite.inputSelectors) {
        if (safeMatches(root, selector)) {
          inputs.add(root);
        }
        for (const element of safeQueryAll(root, selector)) {
          inputs.add(element);
        }
      }
      return new Set(Array.from(inputs).filter(input => input.getAttribute?.(BUTTON_ATTR) !== 'true'));
    }

    function scan(root = documentRef, options = {}) {
      if (destroyed || !targetSite || !root) return 0;

      purgePopupSubtree(root);
      purgeDynamicPopupSubtree(root);
      if (
        root !== documentRef &&
        root.nodeType === 1 &&
        !root.parentNode &&
        root.isConnected === false
      ) {
        return 0;
      }

      let replacements = 0;
      for (const input of collectSearchInputs(root)) {
        if (!input?.parentNode) continue;

        if (targetSite.requireVisibleInput && !isRenderedSearchControl(input, windowRef)) continue;
        const owner = findSearchOwner(input, targetSite);
        if (!owner?.parentNode) continue;
        if (targetSite.requireVisibleOwner &&
            !isRenderedSearchControl(owner === input ? owner.parentElement : owner, windowRef, false)) continue;
        if (replaceOwner(owner, input)) replacements += 1;
      }

      reconcileDouyinSearchEntry();
      reconcileSearchShells();
      if (options.skipFinalFullPurge !== true) {
        purgeAllPopups();
      }
      return replacements;
    }

    function installObserver() {
      if (observer || !documentRef?.documentElement) return;

      const Observer =
        windowRef.MutationObserver ||
        global.MutationObserver;
      if (typeof Observer !== 'function') return;

      observer = new Observer(mutations => {
        const plan = collectObserverBatchPlan(mutations);

        try {
          for (const root of plan.roots) {
            scan(root, {
              skipFinalFullPurge: true,
            });
          }
        } finally {
          reconcileDouyinSearchEntry();
          reconcileSearchShells();
          purgeAllPopups();
        }
      });

      observer.observe(documentRef.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
        attributeFilter: [
          'class',
          'style',
          'hidden',
          'aria-hidden',
          'name',
          'type',
          'role',
          'placeholder',
          'aria-label',
          'data-e2e',
        ],
      });
    }

    function activate(site) {
      targetSite = site;
      setActiveSite(site);
      installDocumentGuards();
      installObserver();
      scan(documentRef);
    }

    function restoreReplacements() {
      if (douyinSearchSlots.size) {
        const roots = new Set(Array.from(replacementStates, state => state.replacementRoot));
        for (const [parent, slot] of douyinSearchSlots) {
          roots.add(slot.replacementRoot);
          if (documentRef.documentElement?.contains?.(parent) &&
              !documentRef.documentElement.contains(slot.owner)) {
            const next = slot.anchor.parentNode === parent ? slot.anchor.nextSibling :
              (slot.nextSibling?.parentNode === parent ? slot.nextSibling : null);
            parent.insertBefore(slot.owner, next);
          }
          removeElement(slot.anchor);
        }
        for (const root of roots) removeElement(root);
        douyinSearchSlots.clear();
        replacementStates.clear();
        return;
      }
      for (const state of replacementStates) {
        if (state.replacementRoot?.parentNode) {
          state.replacementRoot.parentNode.replaceChild(
            state.owner,
            state.replacementRoot
          );
        }
      }
      replacementStates.clear();
    }

    function deactivate() {
      observer?.disconnect?.();
      observer = null;
      stopPopupSweep();
      removeDocumentGuards();
      for (const [shell, state] of searchShellStates) restoreSearchShell(shell, state);
      removeElement(searchShellStyle);
      searchShellStyle = null;
      restoreReplacements();
      dynamicPopupCandidates.clear();
      targetSite = null;
      setActiveSite(null);
    }

    async function refreshConfig() {
      const domains = await loadHighRiskDomains(chromeApi);
      const nextSite = getTargetSite(
        windowRef.location?.hostname,
        domains
      );

      if (!nextSite) {
        deactivate();
        return false;
      }

      activate(nextSite);
      return true;
    }

    function handleStorageChange(changes, areaName) {
      if (
        areaName === 'local' &&
        changes?.[HIGH_RISK_KEY]
      ) {
        void refreshConfig();
      }
    }

    function installStorageListener() {
      if (
        storageListenerInstalled ||
        typeof chromeApi?.storage?.onChanged?.addListener !==
          'function'
      ) {
        return;
      }

      chromeApi.storage.onChanged.addListener(
        handleStorageChange
      );
      storageListenerInstalled = true;
    }

    function start() {
      const provisionalSite = getTargetSite(
        windowRef.location?.hostname,
        DEFAULT_HIGH_RISK_DOMAINS
      );
      if (provisionalSite) {
        activate(provisionalSite);
      }

      installStorageListener();
      void refreshConfig();

      documentRef?.addEventListener?.(
        'DOMContentLoaded',
        () => {
          installObserver();
          scan(documentRef);
        },
        { once: true }
      );
    }

    function destroy() {
      destroyed = true;
      deactivate();

      if (storageListenerInstalled) {
        chromeApi?.storage?.onChanged?.removeListener?.(
          handleStorageChange
        );
      }
      storageListenerInstalled = false;
    }

    return {
      start,
      refreshConfig,
      scan,
      destroy,
      purgeAllPopups,
    };
  }

  const api = Object.freeze({
    BUTTON_ATTR,
    ROOT_ATTR,
    applySearchOwnerLayout,
    createReplacementRoot,
    setReplacementRootStyle,
    SOURCE_ATTR,
    ACTIVE_ATTR,
    SHELL_ATTR,
    isRenderedSearchControl,
    BUTTON_TEXT,
    POPUP_SWEEP_HOVER_WINDOW_MS,
    DEFAULT_HIGH_RISK_DOMAINS,
    SITE_CONFIGS,
    searchKeywordForInput,
    getTargetSite,
    hostMatchesDomain,
    findDouyinSearchOwner,
    isLikelyDynamicSearchPopup,
    hoistReplacementOutOfOwner,
    relocateReplacementToOwner,
    collectObserverBatchPlan,
    createController,
  });

  global.MySearchNativeRedirect = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (
    global.document &&
    global.chrome?.runtime &&
    !global.__MYSEARCH_NATIVE_REDIRECT_STARTED__
  ) {
    global.__MYSEARCH_NATIVE_REDIRECT_STARTED__ = true;
    createController().start();
  }
})(globalThis);
