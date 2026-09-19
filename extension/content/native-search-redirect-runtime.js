/**
 * 将高风险站点的原生搜索组件整体替换为 MySearchPage 自绘入口。
 *
 * 抖音不依赖动态 class：以 searchbar-input 和 searchbar-button
 * 同属的最窄祖先作为原生搜索 owner，整体移除。
 */
(function installNativeSearchRedirect(global) {
  'use strict';

  const BUTTON_ATTR = 'data-msp-native-search-button';
  const ROOT_ATTR = 'data-msp-native-search-root';
  const SOURCE_ATTR = 'data-msp-native-search-source-root';
  const ACTIVE_ATTR = 'data-msp-native-search-active';
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

  const SITE_CONFIGS = Object.freeze({
    'douyin.com': Object.freeze({
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
      inputSelectors: Object.freeze([
        'input[data-testid*="search"]',
        'input[placeholder*="搜索"]',
        '[class*="search"] input',
      ]),
      ownerSelectors: Object.freeze([
        '[data-testid="search-bar"]',
        '[data-testid="searchbox"]',
        '[role="search"]',
      ]),
      popupSelectors: Object.freeze([
        '[class*="search-suggest"]',
        '[class*="search-history"]',
        '[class*="search-hot"]',
      ]),
    }),
  });

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
      !allowedDomains.some(domain =>
        hostMatchesDomain(hostname, domain)
      )
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

  function isDouyinSearchRelatedControl(
    element,
    currentOwner,
    targetSite
  ) {
    if (!element) return true;
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

    const metadata = [
      element.getAttribute?.('data-e2e') || '',
      element.getAttribute?.('aria-label') || '',
      element.getAttribute?.('placeholder') || '',
      typeof element.className === 'string'
        ? element.className
        : element.getAttribute?.('class') || '',
      String(element.textContent || '').slice(0, 120),
    ].join(' ');

    return /search|搜索/i.test(metadata);
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
    let current =
      input.parentElement ||
      input.parentNode ||
      null;

    for (let depth = 0; current && depth < 12; depth += 1) {
      if (safeQuery(current, targetSite.submitSelector)) {
        owner = current;
        break;
      }
      current =
        current.parentElement ||
        current.parentNode ||
        null;
    }

    if (!owner) return null;

    /*
     * 稳定站点 selector 命中更外层搜索 owner 时优先使用。
     * 动态 class 不参与该判断。
     */
    for (const selector of targetSite.ownerSelectors || []) {
      try {
        const configuredOwner = input.closest?.(selector);
        if (
          configuredOwner &&
          configuredOwner.contains?.(owner) &&
          safeQuery(
            configuredOwner,
            targetSite.submitSelector
          )
        ) {
          owner = configuredOwner;
          break;
        }
      } catch (error) {
        // 单个站点 selector 失效时继续使用结构边界。
      }
    }

    /*
     * 外层灰色视觉 shell 通常没有稳定 class。
     * 只跨越搜索专属包装层；遇到无关交互控件或顶部结构边界停止。
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

  function setReplacementRootStyle(root) {
    const declarations = {
      'box-sizing': 'border-box',
      display: 'inline-flex',
      'align-items': 'center',
      'justify-content': 'center',
      width: 'auto',
      'min-width': '104px',
      'min-height': '36px',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'transparent',
      opacity: '1',
      visibility: 'visible',
      'pointer-events': 'auto',
    };

    for (const [name, value] of Object.entries(declarations)) {
      root.style?.setProperty?.(name, value, 'important');
    }
  }

  function setButtonStyle(button) {
    const declarations = {
      'box-sizing': 'border-box',
      display: 'inline-flex',
      'align-items': 'center',
      'justify-content': 'center',
      width: 'auto',
      'min-width': '104px',
      'min-height': '36px',
      padding: '1px 6px',
      border: '1px solid #000',
      'border-radius': '2px',
      background: '#fff',
      color: '#000',
      cursor: 'pointer',
      'font-size': '16px',
      'font-weight': '600',
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
        purgeTrackedDynamicPopups();
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
      ]) {
        documentRef.addEventListener(
          eventType,
          stopOriginalHover,
          true
        );
        documentGuardEntries.push(eventType);
      }
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
      documentGuardsInstalled = false;
    }

    function redirectToMySearchPage(event) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      purgeAllPopups();
      void sendMessage(chromeApi, {
        type: 'OPEN_MYSEARCH_PAGE',
      });
    }

    function existingButton() {
      return documentRef?.querySelector?.(
        `[${BUTTON_ATTR}="true"]`
      ) || null;
    }

    function replaceOwner(owner) {
      if (
        !owner ||
        !owner.parentNode ||
        typeof documentRef?.createElement !== 'function'
      ) {
        return null;
      }

      const currentButton = existingButton();
      if (currentButton) {
        const currentRoot = currentButton.closest?.(
          `[${ROOT_ATTR}="true"]`
        );

        if (currentRoot && owner === currentRoot) {
          for (const selector of targetSite.inputSelectors || []) {
            for (const input of safeQueryAll(
              currentRoot,
              selector
            )) {
              removeElement(input);
            }
          }

          if (targetSite.submitSelector) {
            for (const submit of safeQueryAll(
              currentRoot,
              targetSite.submitSelector
            )) {
              removeElement(submit);
            }
          }

          purgeAllPopups();
          return currentButton;
        }

        if (
          currentRoot &&
          hoistReplacementOutOfOwner(owner, currentRoot)
        ) {
          purgeAllPopups();
          return currentButton;
        }

        if (!currentRoot || owner !== currentRoot) {
          removeElement(owner);
        }
        purgeAllPopups();
        return currentButton;
      }

      const parent = owner.parentNode;
      const replacementRoot = documentRef.createElement('div');
      replacementRoot.className =
        'msp-native-search-entry';
      replacementRoot.setAttribute(ROOT_ATTR, 'true');
      replacementRoot.setAttribute(
        SOURCE_ATTR,
        ownerSource(owner, targetSite)
      );
      setReplacementRootStyle(replacementRoot);

      const button = documentRef.createElement('button');
      button.type = 'button';
      button.textContent = BUTTON_TEXT;
      button.setAttribute(BUTTON_ATTR, 'true');
      button.setAttribute(
        'aria-label',
        '打开 MySearchPage 搜索资料'
      );
      setButtonStyle(button);

      button.addEventListener?.(
        'click',
        redirectToMySearchPage,
        true
      );
      button.addEventListener?.('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          redirectToMySearchPage(event);
        }
      }, true);

      replacementRoot.appendChild(button);
      parent.replaceChild(replacementRoot, owner);
      replacementStates.add({
        owner,
        replacementRoot,
      });

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
      return inputs;
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

        const owner = findSearchOwner(input, targetSite);
        if (!owner?.parentNode) continue;
        if (replaceOwner(owner)) replacements += 1;
      }

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
    SOURCE_ATTR,
    ACTIVE_ATTR,
    BUTTON_TEXT,
    POPUP_SWEEP_HOVER_WINDOW_MS,
    DEFAULT_HIGH_RISK_DOMAINS,
    SITE_CONFIGS,
    getTargetSite,
    hostMatchesDomain,
    findDouyinSearchOwner,
    isLikelyDynamicSearchPopup,
    hoistReplacementOutOfOwner,
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
