/* Media suppression is independent of UA rules and never reloads a tab. */
(function () {
  'use strict';

  const settingsApi = globalThis.SearchMediaSettings;
  if (!settingsApi) return;
  const STORAGE_KEY = settingsApi.storageKey;
  const adapters = globalThis.SearchMediaAdapters || [];
  const adapter = adapters.find(({ domain }) => (
    location.hostname === domain || location.hostname.endsWith(`.${domain}`)
  ));
  if (!adapter || !globalThis.chrome?.storage?.local) return;

  const styles = new Map();
  const players = new Map();
  const retainedCards = new WeakSet();
  const mediaSelector = 'img, picture, video, canvas';
  let enabled = false;
  let scheduled = false;
  let currentUrl = location.href;
  let storageRevision = 0;

  function query(root, selector) {
    return selector ? Array.from(root.querySelectorAll(selector)) : [];
  }

  function inDetail(node) {
    return Boolean(node.closest(adapter.details));
  }

  function searchLocation() {
    return adapter.isSearch(new URL(location.href));
  }

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
    // Some sites change the URL while keeping search results behind a detail dialog.
    return retainedCards.has(card) && hasOpenDetailOverlay();
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
    if (!video.paused) video.pause();
  }

  function restorePlayer(video, state) {
    if (video.muted === true) video.muted = state.muted;
    if (video.autoplay === false) video.autoplay = state.autoplay;
    // Let the site's detail player or the user decide when playback starts.
    players.delete(video);
  }

  function reconcile() {
    scheduled = false;
    currentUrl = location.href;
    const desired = new Map();
    const desiredPlayers = new Set();
    if (enabled) {
      for (const card of query(document, adapter.cards)) {
        if (!isCard(card)) continue;
        retainedCards.add(card);
        collectScope(desired, desiredPlayers, card);
      }
      for (const preview of query(document, adapter.previews)) {
        if (scopeOf(preview)) collectScope(desired, desiredPlayers, preview);
      }
    }
    applyStyles(desired);
    for (const [video, state] of players) {
      if (!desiredPlayers.has(video)) restorePlayer(video, state);
    }
    for (const video of desiredPlayers) stopPreview(video);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(reconcile);
  }

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
  document.addEventListener('visibilitychange', schedule);
  // Isolated-world history hooks do not reliably see the page's own pushState calls.
  setInterval(() => {
    if (location.href !== currentUrl) schedule();
  }, 250);

  function applySettings(settings) {
    enabled = settingsApi.normalize(settings)[adapter.domain];
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
