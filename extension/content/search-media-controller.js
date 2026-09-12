/* Media suppression is independent of UA rules and never reloads a tab. */
(function () {
  'use strict';

  const RECONNECT_EVENT = 'mysearch-search-media-reconnect';
  const settingsApi = globalThis.SearchMediaSettings;
  if (!settingsApi) return;
  const STORAGE_KEY = settingsApi.storageKey;
  const adapters = globalThis.SearchMediaAdapters || [];
  const adapter = adapters.find(({ domain }) => (
    location.hostname === domain || location.hostname.endsWith(`.${domain}`)
  ));
  if (!adapter || !globalThis.chrome?.storage?.local) return;
  if (globalThis.__mySearchMediaControllerActive) {
    if (typeof globalThis.Event === 'function') {
      globalThis.dispatchEvent?.(new globalThis.Event(RECONNECT_EVENT));
    }
    return;
  }
  globalThis.__mySearchMediaControllerActive = true;

  const styles = new Map();
  const players = new Map();
  const retainedCards = new WeakSet();
  const mediaSelector = 'img, picture, video, canvas';
  let enabled = false;
  let scheduled = false;
  let currentUrl = location.href;
  let storageRevision = 0;
  let detailOverlayOpen = false;
  let detailReturnPending = false;
  let detailRoutePath = null;
  const RETURN_GUARD_ATTR = 'data-mysearch-media-return-guard';
  const RETURN_CARD_ATTR = 'data-mysearch-media-return-card';
  const RETURN_GUARD_STYLE_ID = 'mysearch-media-return-guard-style';
  const STYLE_LEDGER_ATTR = 'data-mysearch-media-style-ledger';
  const PLAYER_LEDGER_ATTR = 'data-mysearch-media-player-ledger';
  const returnGuardSupported = adapter.domain === 'xiaohongshu.com' &&
    Boolean(adapter.flowRoot && adapter.cardLayout && adapter.rootLayout);
  let returnGuardReleaseFrame = null;
  let returnGuardStableSnapshot = null;

  function query(root, selector) {
    return selector && typeof root?.querySelectorAll === 'function'
      ? Array.from(root.querySelectorAll(selector))
      : [];
  }

  function inDetail(node) {
    return Boolean(node.closest(adapter.details));
  }

  function searchLocation() {
    return adapter.isSearch(new URL(location.href));
  }

  function inResultFlow(card) {
    return Boolean(card.closest(adapter.roots) || (
      adapter.flowRoot && card.closest(adapter.flowRoot)
    ));
  }

  function hasRetainedBackground(cards) {
    return cards.some((card) => (
      retainedCards.has(card) && inResultFlow(card) && !inDetail(card)
    ));
  }

  function returnGuardActive() {
    const root = globalThis.document?.documentElement;
    return Boolean(
      returnGuardSupported &&
      root &&
      typeof root.hasAttribute === 'function' &&
      root.hasAttribute(RETURN_GUARD_ATTR)
    );
  }

  function setReturnGuardAttribute() {
    const root = globalThis.document?.documentElement;
    if (!returnGuardSupported ||
      !root ||
      typeof root.setAttribute !== 'function') return false;
    root.setAttribute(RETURN_GUARD_ATTR, '');
    return true;
  }

  function removeReturnGuardAttribute() {
    const root = globalThis.document?.documentElement;
    if (!root || typeof root.removeAttribute !== 'function') return false;
    root.removeAttribute(RETURN_GUARD_ATTR);
    return true;
  }

  function cssDeclarations(properties) {
    return Object.entries(properties || {})
      .map(([property, value]) => `${property}: ${value} !important;`)
      .join('\n');
  }

  function installReturnGuardStyle() {
    if (!returnGuardSupported || document.getElementById(RETURN_GUARD_STYLE_ID)) return;

    const root = `:is(${adapter.flowRoot})`;
    const card = `:is(${adapter.cards})`;
    const details = `:is(${adapter.details})`;
  const marker = `[${RETURN_CARD_ATTR}]`;
  const rootScope = `html[${RETURN_GUARD_ATTR}] ${root} ${card}`;
  const detachedMarker = [
    `html[${RETURN_GUARD_ATTR}] body > ${marker}:not(${details})`,
    `html[${RETURN_GUARD_ATTR}] body > ${card}:not(${details})`,
  ].join(',\n');
  const guardedRootCard =
    `html[${RETURN_GUARD_ATTR}] ${root} :is(${marker}, ${card})` +
    `:not(${details}):not(${details} :is(${marker}, ${card}))`;
  // Use simple result-root selectors here so newly rebuilt cards are collapsed
  // before marker reconciliation, without relying on the guarded-card selector.
  const guardedRootBox = [
    `html[${RETURN_GUARD_ATTR}] ${root} ${card} :is(${adapter.boxes})`,
    `html[${RETURN_GUARD_ATTR}] ${root} ${marker} :is(${adapter.boxes})`,
    `html[${RETURN_GUARD_ATTR}] ${root} ${card} a.cover`,
    `html[${RETURN_GUARD_ATTR}] ${root} ${marker} a.cover`,
  ].join(',\n');

    const scopeRules = (scope) => `
${scope} {
  ${cssDeclarations(adapter.cardLayout)}
  height: auto !important;
  min-height: 0 !important;
  aspect-ratio: auto !important;
  background-image: none !important;
  view-transition-name: none !important;
}
${scope} * {
  view-transition-name: none !important;
}
${scope} :is(${mediaSelector}) {
  display: none !important;
  view-transition-name: none !important;
}
${scope} :is(${adapter.boxes}) {
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  width: auto !important;
  min-width: 0 !important;
  aspect-ratio: auto !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  background-image: none !important;
}
${scope} :is(${adapter.backgrounds}, [style*="background"]) {
  background-image: none !important;
}
`;

    const style = document.createElement('style');
    style.id = RETURN_GUARD_STYLE_ID;
    style.textContent = `
html[${RETURN_GUARD_ATTR}] {
  view-transition-name: none !important;
}
html[${RETURN_GUARD_ATTR}] ${root} {
  ${cssDeclarations(adapter.rootLayout)}
  view-transition-name: none !important;
}
${scopeRules(rootScope)}
${guardedRootCard} {
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  aspect-ratio: auto !important;
  transform: none !important;
  translate: none !important;
  view-transition-name: none !important;
}
html[${RETURN_GUARD_ATTR}] ${root} ${card} a.cover,
html[${RETURN_GUARD_ATTR}] ${root} ${marker} a.cover {
  display: none !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  width: auto !important;
  min-width: 0 !important;
  aspect-ratio: auto !important;
  padding: 0 !important;
  background: none !important;
  background-image: none !important;
  transform: none !important;
  translate: none !important;
  view-transition-name: none !important;
}
${guardedRootBox} {
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  width: auto !important;
  min-width: 0 !important;
  aspect-ratio: auto !important;
  padding: 0 !important;
  background: none !important;
  background-image: none !important;
  transform: none !important;
  translate: none !important;
  overflow: visible !important;
  view-transition-name: none !important;
}
html[${RETURN_GUARD_ATTR}] ${root} ${card} img,
html[${RETURN_GUARD_ATTR}] ${root} ${card} picture,
html[${RETURN_GUARD_ATTR}] ${root} ${card} video,
html[${RETURN_GUARD_ATTR}] ${root} ${card} canvas,
html[${RETURN_GUARD_ATTR}] ${root} ${marker} img,
html[${RETURN_GUARD_ATTR}] ${root} ${marker} picture,
html[${RETURN_GUARD_ATTR}] ${root} ${marker} video,
html[${RETURN_GUARD_ATTR}] ${root} ${marker} canvas {
  display: none !important;
  view-transition-name: none !important;
}
html[${RETURN_GUARD_ATTR}] ${root} ${details} img,
html[${RETURN_GUARD_ATTR}] ${root} ${details} picture,
html[${RETURN_GUARD_ATTR}] ${root} ${details} video,
html[${RETURN_GUARD_ATTR}] ${root} ${details} canvas {
  display: revert !important;
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
  view-transition-name: revert !important;
}
${detachedMarker} {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
  transform: none !important;
  translate: none !important;
  view-transition-name: none !important;
}
html[${RETURN_GUARD_ATTR}] ${root},
html[${RETURN_GUARD_ATTR}] ${root} *:not(${details}):not(${details} *) {
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}
html[${RETURN_GUARD_ATTR}] ${root} {
  display: flex !important;
  flex-wrap: wrap !important;
  align-items: flex-start !important;
  align-content: flex-start !important;
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}
`;
    (document.head || document.documentElement).appendChild(style);
  }

  function cancelReturnGuardRelease() {
    if (returnGuardReleaseFrame !== null) {
      cancelAnimationFrame(returnGuardReleaseFrame);
      returnGuardReleaseFrame = null;
    }
    returnGuardStableSnapshot = null;
  }

  function markReturnGuardCards() {
    if (!returnGuardSupported) return;
    for (const card of query(document, adapter.cards)) {
      if (!card.isConnected || inDetail(card) ||
          card.closest('header, nav, aside, [role="navigation"]')) continue;
      if (card.closest(adapter.flowRoot)) card.setAttribute(RETURN_CARD_ATTR, '');
    }
  }

  function armReturnGuard() {
    if (!returnGuardSupported || !enabled) return;
    installReturnGuardStyle();
    cancelReturnGuardRelease();
    markReturnGuardCards();
    if (!setReturnGuardAttribute()) return;
  }

  function clearReturnGuard() {
    if (!returnGuardSupported) return;
    cancelReturnGuardRelease();
    removeReturnGuardAttribute();
    for (const card of query(document, `[${RETURN_CARD_ATTR}]`)) {
      card.removeAttribute(RETURN_CARD_ATTR);
    }
  }

  function currentReturnGuardSnapshot() {
    const roots = query(document, adapter.flowRoot)
      .filter((root) => root.isConnected && !inDetail(root));
    const inRoot = (node) => roots.some((root) => root.contains(node));
    const cards = query(document, adapter.cards)
      .filter((card) => card.isConnected && !inDetail(card) && inRoot(card));
    const transients = query(document, `[${RETURN_CARD_ATTR}]`)
      .filter((card) => card.isConnected && !inDetail(card) && !inRoot(card));
    return { roots, cards, transients };
  }

  function sameNodeList(left, right) {
    return left.length === right.length &&
      left.every((node, index) => node === right[index]);
  }

  function sameReturnGuardSnapshot(left, right) {
    return Boolean(left && right) &&
      sameNodeList(left.roots, right.roots) &&
      sameNodeList(left.cards, right.cards) &&
      sameNodeList(left.transients, right.transients);
  }

  function hasRequestedStyles(node, properties) {
    const saved = styles.get(node);
    return Object.entries(properties).every(([property, value]) => (
      saved?.get(property)?.requested === value
    ));
  }

  function returnGuardInlineReady(snapshot) {
    if (!snapshot.roots.length || snapshot.transients.length) return false;
    if (!snapshot.cards.length) return true;
    if (!snapshot.roots.every((root) => hasRequestedStyles(root, adapter.rootLayout))) {
      return false;
    }
    return snapshot.cards.every((card) => (
      hasRequestedStyles(card, adapter.cardLayout) &&
      query(card, mediaSelector).every((media) => (
        styles.get(media)?.get('display')?.requested === 'none'
      ))
    ));
  }

  function scheduleReturnGuardRelease() {
    if (!returnGuardActive() || returnGuardReleaseFrame !== null) return;
    returnGuardStableSnapshot = currentReturnGuardSnapshot();

    returnGuardReleaseFrame = requestAnimationFrame(() => {
      returnGuardReleaseFrame = null;
      if (!returnGuardActive()) return;
      if (!enabled) {
        clearReturnGuard();
        return;
      }
      if (!searchLocation() || hasOpenDetailOverlay()) return;

      const firstFrame = currentReturnGuardSnapshot();
      if (!firstFrame.roots.length || firstFrame.transients.length) {
        returnGuardStableSnapshot = firstFrame;
        return;
      }
      if (!sameReturnGuardSnapshot(returnGuardStableSnapshot, firstFrame) ||
          !returnGuardInlineReady(firstFrame)) {
        returnGuardStableSnapshot = firstFrame;
        schedule();
        return;
      }

      // 这一帧仍保持静态保护，让浏览器至少完成一次受保护绘制。
      returnGuardStableSnapshot = firstFrame;
      returnGuardReleaseFrame = requestAnimationFrame(() => {
        returnGuardReleaseFrame = null;
        if (!returnGuardActive()) return;
        if (!enabled) {
          clearReturnGuard();
          return;
        }
        if (!searchLocation() || hasOpenDetailOverlay()) return;

        const secondFrame = currentReturnGuardSnapshot();
        if (!sameReturnGuardSnapshot(returnGuardStableSnapshot, secondFrame) ||
            !returnGuardInlineReady(secondFrame)) {
          returnGuardStableSnapshot = secondFrame;
          schedule();
          return;
        }
        clearReturnGuard();
      });
    });
  }

  installReturnGuardStyle();

  function hasOpenDetailOverlay() {
    const generic = '[role="dialog"], [aria-modal="true"]';
    const selector = adapter.detailOverlays ? `${generic}, ${adapter.detailOverlays}` : generic;
    return query(document, selector).some((node) => {
      if (node.closest('[hidden], [aria-hidden="true"]')) return false;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      return Boolean(adapter.detailOverlays && node.matches(adapter.detailOverlays)) || Boolean(node.querySelector('video'));
    });
  }

  function isCard(card) {
    if (!card?.isConnected || !card.matches(adapter.cards) || inDetail(card)) return false;
    if (card.closest('header, nav, aside, [role="navigation"]')) return false;
    if (searchLocation()) {
      return Boolean(card.closest(adapter.roots)) || !document.querySelector(adapter.roots);
    }
    // Same-document detail close must keep the old result flow suppressed while
    // the site restores its search URL, including newly-created result cards.
    return (detailOverlayOpen || detailReturnPending) &&
      (retainedCards.has(card) || inResultFlow(card));
  }

  function scopeOf(node) {
    if (!enabled || !node?.isConnected || inDetail(node)) return null;
    const card = node.closest(adapter.cards);
    if (isCard(card)) return card;
    const preview = node.closest(adapter.previews);
    if (preview && (searchLocation() || query(document, adapter.cards).some(isCard))) return preview;
    return null;
  }

  function addStyle(desired, node, properties) {
    let entry = desired.get(node);
    if (!entry) desired.set(node, entry = new Map());
    for (const [property, value] of Object.entries(properties)) entry.set(property, value);
  }

  function hasText(node) {
    return Boolean(node.textContent.replace(/\s+/g, '').length);
  }

  function isDetachedReturnClone(node) {
    return Boolean(
      adapter.flowRoot &&
      node?.nodeType === 1 &&
      node.parentElement === document.body &&
      (
        node.hasAttribute?.(RETURN_CARD_ATTR) ||
        node.matches?.(adapter.cards)
      ) &&
      !node.closest(adapter.flowRoot) &&
      !inDetail(node)
    );
  }

  function collectDetachedReturnClones(desired) {
    const body = globalThis.document?.body;
    if (!returnGuardActive() || !body || !body.children) return;

    for (const node of Array.from(body.children)) {
      if (!isDetachedReturnClone(node)) continue;
      addStyle(desired, node, {
        display: 'none',
        visibility: 'hidden',
        opacity: '0',
        'pointer-events': 'none',
        transform: 'none',
        translate: 'none',
        'view-transition-name': 'none',
      });
    }
  }

  function preserveGuardedResultText(desired) {
    const page = globalThis.document;
    if (!enabled ||
      !returnGuardActive() ||
      typeof page?.querySelectorAll !== 'function') return;
    const rootSelector = adapter.flowRoot || adapter.roots;
    for (const root of query(page, rootSelector)) {
      if (inDetail(root)) continue;
      for (const node of [root, ...query(root, '*')]) {
        if (inDetail(node) || node.matches(mediaSelector) || !hasText(node)) continue;
        const properties = {
          visibility: 'visible',
          opacity: '1',
          'pointer-events': 'auto',
        };
        if (getComputedStyle(node).display === 'none' &&
          (node.matches(adapter.cards) || node.hasAttribute(RETURN_CARD_ATTR))) {
          properties.display = 'block';
        }
        addStyle(desired, node, properties);
      }
    }
  }

  function collapseBox(desired, node) {
    if (!hasText(node)) {
      addStyle(desired, node, { display: 'none' });
      return;
    }
    addStyle(desired, node, {
      height: 'auto',
      'min-height': '0',
      'max-height': 'none',
      width: 'auto',
      'min-width': '0',
      'aspect-ratio': 'auto',
      'padding-top': '0',
      'padding-bottom': '0',
      'background-image': 'none',
      color: 'inherit',
      overflow: 'visible',
    });
    // Text overlays can be positioned by an otherwise unknown site-specific wrapper.
    for (const child of query(node, '*')) {
      if (!hasText(child) || inDetail(child)) continue;
      const computed = getComputedStyle(child);
      if (computed.position === 'absolute' || computed.position === 'fixed' || styles.get(child)?.has('position')) {
        reflowText(desired, child);
      }
    }
  }

  function reflowText(desired, node) {
    if (!hasText(node)) return;
    addStyle(desired, node, {
      position: 'static',
      top: 'auto',
      right: 'auto',
      bottom: 'auto',
      left: 'auto',
      height: 'auto',
      'min-height': '0',
      'max-height': 'none',
      'aspect-ratio': 'auto',
      transform: 'none',
      'background-image': 'none',
      'background-color': 'transparent',
      color: 'inherit',
      'text-shadow': 'none',
      opacity: '1',
      visibility: 'visible',
    });
  }

  function collectScope(desired, desiredPlayers, scope) {
    addStyle(desired, scope, { height: 'auto', 'min-height': '0', 'aspect-ratio': 'auto' });
    if (adapter.cardLayout && scope.matches(adapter.cards)) {
      const root = scope.closest(adapter.flowRoot);
      if (root && !inDetail(root)) {
        addStyle(desired, scope, adapter.cardLayout);
        const gap = innerWidth <= 480 ? '1px' : innerWidth <= 768 ? '2px' : '6px';
        addStyle(desired, root, { ...adapter.rootLayout, 'row-gap': gap, 'column-gap': gap });
      }
    }
    for (const box of query(scope, adapter.boxes)) {
      if (!inDetail(box)) collapseBox(desired, box);
    }
    for (const overlay of query(scope, adapter.overlays)) {
      if (!inDetail(overlay)) reflowText(desired, overlay);
    }
    for (const rule of adapter.layout || []) {
      for (const node of query(scope, rule.selector)) {
        if (!inDetail(node) && (!rule.emptyOnly || !hasText(node))) addStyle(desired, node, rule.styles);
      }
    }
    for (const node of query(scope, `${adapter.backgrounds}, [style*="background"]`)) {
      if (!inDetail(node)) addStyle(desired, node, { 'background-image': 'none' });
    }
    const media = query(scope, mediaSelector);
    if (scope.matches(mediaSelector)) media.unshift(scope);
    for (const node of media) {
      if (inDetail(node)) continue;
      addStyle(desired, node, { display: 'none' });
      if (node.tagName === 'VIDEO') desiredPlayers.add(node);
    }
  }

  function readStyle(node, property) {
    return { value: node.style.getPropertyValue(property), priority: node.style.getPropertyPriority(property) };
  }

  function sameStyle(a, b) {
    return a.value === b.value && a.priority === b.priority;
  }

  function restoreStyle(node, property, state) {
    if (!sameStyle(readStyle(node, property), state.applied)) return;
    if (state.original.value) node.style.setProperty(property, state.original.value, state.original.priority);
    else node.style.removeProperty(property);
  }

  function writeStyleLedger(node, properties) {
    if (!node?.setAttribute || !node?.removeAttribute) return;
    if (!properties.size) {
      node.removeAttribute(STYLE_LEDGER_ATTR);
      return;
    }
    const ledger = {};
    for (const [property, state] of properties) {
      ledger[property] = {
        original: state.original,
        applied: state.applied,
      };
    }
    node.setAttribute(STYLE_LEDGER_ATTR, JSON.stringify(ledger));
  }

  function recoverOrphanedOverrides() {
    for (const node of query(document, `[${STYLE_LEDGER_ATTR}]`)) {
      try {
        const ledger = JSON.parse(
          node.getAttribute(STYLE_LEDGER_ATTR) || '{}'
        );
        for (const [property, state] of Object.entries(ledger)) {
          if (
            state?.original &&
            state?.applied &&
            sameStyle(readStyle(node, property), state.applied)
          ) {
            if (state.original.value) {
              node.style.setProperty(
                property,
                state.original.value,
                state.original.priority || ''
              );
            } else {
              node.style.removeProperty(property);
            }
          }
        }
      } catch (error) {
        // 无法验证来源的旧标记不用于猜测原站样式。
      }
      node.removeAttribute(STYLE_LEDGER_ATTR);
    }

    for (const video of query(
      document,
      `video[${PLAYER_LEDGER_ATTR}]`
    )) {
      try {
        const state = JSON.parse(
          video.getAttribute(PLAYER_LEDGER_ATTR) || '{}'
        );
        if (video.muted === true && typeof state.muted === 'boolean') {
          video.muted = state.muted;
        }
        if (
          video.autoplay === false &&
          typeof state.autoplay === 'boolean'
        ) {
          video.autoplay = state.autoplay;
        }
      } catch (error) {
        // 无效账本只移除，不修改当前站点状态。
      }
      video.removeAttribute(PLAYER_LEDGER_ATTR);
    }
  }

  function applyStyles(desired) {
    for (const [node, properties] of styles) {
      const next = desired.get(node);
      for (const [property, state] of properties) {
        if (!next?.has(property)) {
          restoreStyle(node, property, state);
          properties.delete(property);
        }
      }
      if (!properties.size) styles.delete(node);
      writeStyleLedger(node, properties);
    }
    for (const [node, properties] of desired) {
      let saved = styles.get(node);
      if (!saved) styles.set(node, saved = new Map());
      for (const [property, value] of properties) {
        const current = readStyle(node, property);
        let state = saved.get(property);
        const needsWrite = !state || state.requested !== value || !sameStyle(current, state.applied);
        if (!state) {
          state = { original: current, applied: current, requested: value };
          saved.set(property, state);
        } else if (!sameStyle(current, state.applied)) {
          // Preserve a site's own updates made while a card is suppressed.
          state.original = current;
        }
        if (needsWrite) node.style.setProperty(property, value, 'important');
        // CSSOM normalizes values such as 0 to 0px. Compare with what was actually
        // written so our own updates are never recorded as a site's new original.
        state.applied = readStyle(node, property);
        state.requested = value;
      }
      writeStyleLedger(node, saved);
    }
  }

  function stopPreview(video) {
    let state = players.get(video);
    if (!state) {
      state = { muted: video.muted, autoplay: video.autoplay };
      players.set(video, state);
    } else {
      if (video.muted !== true) state.muted = video.muted;
      if (video.autoplay !== false) state.autoplay = video.autoplay;
    }
    if (!video.muted) video.muted = true;
    if (video.autoplay) video.autoplay = false;
    video.setAttribute?.(PLAYER_LEDGER_ATTR, JSON.stringify({
      muted: state.muted,
      autoplay: state.autoplay,
    }));
    if (!video.paused) video.pause();
  }

  function restorePlayer(video, state) {
    if (video.muted === true) video.muted = state.muted;
    if (video.autoplay === false) video.autoplay = state.autoplay;
    video.removeAttribute?.(PLAYER_LEDGER_ATTR);
    // Let the site's detail player or the user decide when playback starts.
    players.delete(video);
  }

  recoverOrphanedOverrides();

  function reconcile() {
    scheduled = false;
    currentUrl = location.href;
    const searching = searchLocation();
    const detailOpen = hasOpenDetailOverlay();
    const cards = query(document, adapter.cards);
    const retainedBackground = hasRetainedBackground(cards);

    if (detailOpen &&
        (detailOverlayOpen || detailReturnPending || retainedBackground)) {
      armReturnGuard();
    }

    if (searching) {
      detailOverlayOpen = false;
      detailReturnPending = false;
      detailRoutePath = null;
    } else if (detailOpen && (
      detailOverlayOpen || detailReturnPending || retainedBackground
    )) {
      detailOverlayOpen = true;
      detailReturnPending = false;
      detailRoutePath = location.pathname;
    } else if (!detailOpen && detailOverlayOpen) {
      detailOverlayOpen = false;
      detailReturnPending = location.pathname === detailRoutePath;
      if (!detailReturnPending) detailRoutePath = null;
    } else if (
      !detailOpen &&
      detailReturnPending &&
      location.pathname !== detailRoutePath
    ) {
      detailReturnPending = false;
      detailRoutePath = null;
      clearReturnGuard();
    }
    const desired = new Map();
    const desiredPlayers = new Set();
    if (enabled) {
      for (const card of cards) {
        if (!isCard(card)) continue;
        retainedCards.add(card);
        if (returnGuardActive() && inResultFlow(card)) {
          card.setAttribute(RETURN_CARD_ATTR, '');
        }
        collectScope(desired, desiredPlayers, card);
      }
      for (const preview of query(document, adapter.previews)) {
        if (scopeOf(preview)) collectScope(desired, desiredPlayers, preview);
      }
    }
    collectDetachedReturnClones(desired);
    preserveGuardedResultText(desired);
    applyStyles(desired);
    for (const [video, state] of players) {
      if (!desiredPlayers.has(video)) restorePlayer(video, state);
    }
    for (const video of desiredPlayers) stopPreview(video);

    if (returnGuardActive()) {
      if (!enabled ||
          (!searching && !detailOpen && !detailReturnPending)) {
        clearReturnGuard();
      } else if (searching && !detailOpen) {
        scheduleReturnGuardRelease();
      }
    }
  }

  function schedule() {
    cancelReturnGuardRelease();
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(reconcile);
  }

  function installSynchronousReturnRootReplacementHook() {
    if (!adapter.flowRoot) return;
    const prototype = globalThis.Element?.prototype;
    const nativeReplaceWith = prototype?.replaceWith;
    if (typeof nativeReplaceWith !== 'function' ||
      nativeReplaceWith.__mysearchReturnRootReplacementHook) return;

    function replaceWithReturnGuard(...nodes) {
      const replacesGuardedResultRoot = Boolean(
        returnGuardActive() &&
        this.matches?.(adapter.flowRoot)
      );
      const insertsGuardedReturnNode =
        isGuardedReturnFlow(this.parentElement, nodes);
      const result = nativeReplaceWith.apply(this, nodes);

      if (replacesGuardedResultRoot || insertsGuardedReturnNode) {
        cancelReturnGuardRelease();
        reconcile();
      }
      return result;
    }

    Object.defineProperty(
      replaceWithReturnGuard,
      '__mysearchReturnRootReplacementHook',
      { value: true },
    );
    prototype.replaceWith = replaceWithReturnGuard;
  }

  installSynchronousReturnRootReplacementHook();

  function containsReturnCardMarker(node) {
    return Boolean(
      node &&
      (
        (
          node.nodeType === 1 &&
          (
            node.hasAttribute?.(RETURN_CARD_ATTR) ||
            node.matches?.(adapter.cards)
          )
        ) ||
        node.querySelector?.(`[${RETURN_CARD_ATTR}], ${adapter.cards}`)
      )
    );
  }

  function isGuardedReturnFlow(target, insertedNodes = []) {
    if (!adapter.flowRoot ||
      !returnGuardActive() ||
      !target) return false;

    if (target.matches?.(adapter.flowRoot)) return true;
    const body = globalThis.document?.body;
    if (typeof body?.contains !== 'function' ||
      !body.contains(target) ||
      target.closest?.(adapter.flowRoot)) return false;

    return insertedNodes.some(containsReturnCardMarker);
  }

  function reconcileSynchronousReturnFlowInsertion(guardedTarget) {
    if (!guardedTarget) return;
    cancelReturnGuardRelease();
    reconcile();
  }

  function installSynchronousReturnFlowInsertionHooks() {
    if (!adapter.flowRoot) return;

    const elementPrototype = globalThis.Element?.prototype;
    const nodePrototype = globalThis.Node?.prototype;
    if (!elementPrototype || !nodePrototype) return;

    const nativeAppend = elementPrototype.append;
    if (typeof nativeAppend === 'function' &&
      !nativeAppend.__mysearchReturnFlowAppendHook) {
      function appendReturnGuard(...nodes) {
        const guardedTarget = isGuardedReturnFlow(this, nodes);
        const result = nativeAppend.apply(this, nodes);
        reconcileSynchronousReturnFlowInsertion(guardedTarget);
        return result;
      }

      Object.defineProperty(
        appendReturnGuard,
        '__mysearchReturnFlowAppendHook',
        { value: true },
      );
      elementPrototype.append = appendReturnGuard;
    }

    const nativeAppendChild = nodePrototype.appendChild;
    if (typeof nativeAppendChild === 'function' &&
      !nativeAppendChild.__mysearchReturnFlowAppendChildHook) {
      function appendChildReturnGuard(node) {
        const guardedTarget = isGuardedReturnFlow(this, [node]);
        const result = nativeAppendChild.call(this, node);
        reconcileSynchronousReturnFlowInsertion(guardedTarget);
        return result;
      }

      Object.defineProperty(
        appendChildReturnGuard,
        '__mysearchReturnFlowAppendChildHook',
        { value: true },
      );
      nodePrototype.appendChild = appendChildReturnGuard;
    }

    const nativeInsertBefore = nodePrototype.insertBefore;
    if (typeof nativeInsertBefore === 'function' &&
      !nativeInsertBefore.__mysearchReturnFlowInsertBeforeHook) {
      function insertBeforeReturnGuard(node, referenceNode) {
        const guardedTarget = isGuardedReturnFlow(this, [node]);
        const result = nativeInsertBefore.call(this, node, referenceNode);
        reconcileSynchronousReturnFlowInsertion(guardedTarget);
        return result;
      }

      Object.defineProperty(
        insertBeforeReturnGuard,
        '__mysearchReturnFlowInsertBeforeHook',
        { value: true },
      );
      nodePrototype.insertBefore = insertBeforeReturnGuard;
    }
  }

  installSynchronousReturnFlowInsertionHooks();

  const observer = new MutationObserver((mutations) => {
    // Applying an already-equal property does not write, so the follow-up settles.
    if (enabled || styles.size || players.size) {
      if (mutations.some((mutation) => mutation.type !== 'attributes' || mutation.attributeName !== 'style' || !styles.has(mutation.target))) {
        schedule();
        return;
      }
      for (const mutation of mutations) {
        const saved = styles.get(mutation.target);
        if (saved && Array.from(saved).some(([property, state]) => !sameStyle(readStyle(mutation.target, property), state.applied))) {
          schedule();
          return;
        }
      }
    }
  });
  observer.observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'id', 'style', 'src', 'srcset', 'poster', 'href', 'role', 'aria-modal', 'aria-hidden', 'hidden', 'data-e2e', 'data-note-id', 'autoplay'],
  });

  function onPotentialDetailClose(event) {
    if (!returnGuardSupported || !enabled) return;
    if (event.type === 'keydown' &&
        !['Escape', 'Enter', ' '].includes(event.key)) return;
    if (!returnGuardActive() && !detailOverlayOpen && !detailReturnPending) return;
    // 捕获阶段先启用CSS，早于站点自己的关闭、克隆和路由处理器。
    armReturnGuard();
  }
  document.addEventListener('pointerdown', onPotentialDetailClose, true);
  document.addEventListener('keydown', onPotentialDetailClose, true);

  function onMediaEvent(event) {
    const video = event.target;
    if (video?.tagName !== 'VIDEO') return;
    if (scopeOf(video)) stopPreview(video);
    else if (players.has(video)) {
      restorePlayer(video, players.get(video));
      schedule();
    }
  }
  for (const event of ['play', 'playing', 'volumechange', 'loadedmetadata']) {
    document.addEventListener(event, onMediaEvent, true);
  }
  for (const event of ['popstate', 'hashchange', 'pageshow', 'resize', ...adapter.routeEvents]) {
    window.addEventListener(event, schedule, true);
  }
  window.addEventListener(RECONNECT_EVENT, schedule, true);
  document.addEventListener('visibilitychange', schedule);
  // Isolated-world history hooks do not reliably see the page's own pushState calls.
  setInterval(() => {
    if (location.href !== currentUrl) schedule();
  }, 250);

  function applySettings(settings) {
    enabled = settingsApi.normalize(settings)[adapter.domain];
    if (!enabled) clearReturnGuard();
    schedule();
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) return;
    storageRevision += 1;
    applySettings(changes[STORAGE_KEY].newValue);
  });
  const initialRevision = storageRevision;
  settingsApi.read().then((settings) => {
    if (storageRevision === initialRevision) applySettings(settings);
  }).catch(() => {});
})();
