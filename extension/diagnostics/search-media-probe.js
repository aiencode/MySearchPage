(function () {
  'use strict';

  const REPORT_KEY = 'searchMediaRuntimeProbe';
  const status = document.getElementById('probe-status');
  const output = document.getElementById('probe-output');
  const runButton = document.getElementById('probe-run');
  const clearButton = document.getElementById('probe-clear');

  function errorRecord(stage, error) {
    const message = String(error?.message || error).replace(/\b(?:https?|chrome-extension):\/\/[^\s"'<>]+/gi, (value) => {
      try { const url = new URL(value); return url.origin + url.pathname; } catch (_) { return '[URL]'; }
    });
    return { stage, name: String(error?.name || 'Error'), message: message.slice(0, 1000) };
  }

  function setBusy(busy) {
    runButton.disabled = busy;
    clearButton.disabled = busy;
  }

  // This function is serialized by executeScript. All helpers and state used by
  // the page sampler are local; selector strings arrive only through its argument.
  async function samplePage(spec) {
    const errors = [];
    function fail(stage, error) {
      const message = String(error?.message || error).replace(/\b(?:https?|chrome-extension):\/\/[^\s"'<>]+/gi, (value) => {
        try { const url = new URL(value); return url.origin + url.pathname; } catch (_) { return '[URL]'; }
      });
      errors.push({ stage, name: String(error?.name || 'Error'), message: message.slice(0, 1000) });
    }
    function read(stage, operation, fallback = null) {
      try { return operation(); } catch (error) { fail(stage, error); return fallback; }
    }
    function matchesSearch(url) {
      if (!['http:', 'https:'].includes(url.protocol)) return false;
      if (url.hostname !== spec.domain && !url.hostname.endsWith('.' + spec.domain)) return false;
      if (spec.domain === 'bilibili.com') return url.hostname === 'search.bilibili.com' || /^\/search(?:\/|$)/.test(url.pathname);
      if (spec.domain === 'youtube.com') return /^\/(?:results|search)(?:\/|$)/.test(url.pathname);
      if (spec.domain === 'xiaohongshu.com') return /^\/(?:search_result|search)(?:\/|$)/.test(url.pathname);
      return spec.domain === 'douyin.com' && /^\/(?:jingxuan\/)?search(?:\/|$)/.test(url.pathname);
    }
    const url = read('location', () => new URL(location.href));
    if (!url || !['http:', 'https:'].includes(url.protocol) ||
        !(url.hostname === spec.domain || url.hostname.endsWith('.' + spec.domain))) {
      return { skipped: '页面已离开目标站点', errors };
    }

    function identity(node) {
      return {
        tag: node.tagName,
        class: (node.getAttribute('class') || '').slice(0, 240),
        id: (node.getAttribute('id') || '').slice(0, 120),
        dataE2e: (node.getAttribute('data-e2e') || '').slice(0, 120),
        dataNoteId: (node.getAttribute('data-note-id') || '').slice(0, 120),
        dataAwemeId: (node.getAttribute('data-aweme-id') || '').slice(0, 120),
        inlineStyle: (node.getAttribute('style') || '').slice(0, 1500),
        extensionAttributes: Object.fromEntries(Array.from(node.attributes)
          .filter(({ name }) => name.startsWith('data-mysearch-') || name.startsWith('data-msp-'))
          .map(({ name, value }) => [name, value.slice(0, 2500)])),
      };
    }
    function visibility(node) {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return { display: style.display, visibility: style.visibility, opacity: style.opacity,
        position: style.position, zIndex: style.zIndex, pointerEvents: style.pointerEvents,
        overflow: style.overflow, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    function mediaSample(node) {
      const result = { ...identity(node), computed: read('media.computed', () => visibility(node)) };
      if (node.tagName === 'VIDEO') {
        result.playback = read('media.playback', () => ({ paused: node.paused, muted: node.muted, autoplay: node.autoplay, currentTime: node.currentTime, readyState: node.readyState }));
      }
      return result;
    }
    function ancestorSample(node) {
      const ancestors = [];
      for (let current = node; current && ancestors.length < 14; current = current.parentElement) {
        ancestors.push({ ...identity(current), computed: read('ancestor.computed', () => visibility(current)),
          hidden: current.hidden, ariaHidden: current.getAttribute('aria-hidden') });
      }
      return ancestors;
    }
    function safeValues(value) {
      const object = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      return Object.fromEntries(spec.domains.map((domain) => {
        const present = Object.prototype.hasOwnProperty.call(object, domain);
        const raw = object[domain];
        return [domain, { present, type: present ? typeof raw : 'missing', value: typeof raw === 'boolean' ? raw : null }];
      }));
    }

    const report = {
      location: { hostname: url.hostname, pathname: url.pathname, isSearch: matchesSearch(url) },
      readyState: read('document.readyState', () => document.readyState),
      runtimeId: read('chrome.runtime.id', () => chrome.runtime.id),
      globals: {
        settingsPresent: read('global.settings', () => typeof globalThis.SearchMediaSettings !== 'undefined'),
        adaptersPresent: read('global.adapters', () => typeof globalThis.SearchMediaAdapters !== 'undefined'),
      },
      errors,
    };
    report.blocking = read('blocking', () => ({
      title: document.title,
      runtime: document.documentElement.getAttribute('data-mysearch-blocking-runtime'),
      activeVersion: globalThis.__mySearchBlockingRuntimeVersion || '',
      rulesApiPresent: typeof globalThis.MySearchBlockingRules !== 'undefined',
      pageGate: document.documentElement.hasAttribute('data-mysearch-page-gate'),
      blockedNodes: Array.from(document.querySelectorAll('[data-mysearch-blocked]')).slice(0, 12).map(node => ({
        ...identity(node),
        text: (node.textContent || '').slice(0, 100),
        computed: visibility(node),
      })),
    }));
    try {
      const data = await chrome.storage.local.get([
        spec.storageKey, 'blockingEnabled', 'blockedKeywords', 'blockedUrlPatterns',
      ]);
      if (report.blocking) Object.assign(report.blocking, {
        enabled: data.blockingEnabled !== false,
        titleMatches: (data.blockedKeywords || []).filter(value => String(document.title || '').includes(value)),
        urlMatches: (data.blockedUrlPatterns || []).filter(value => location.href.includes(value)),
      });
      const stored = data[spec.storageKey];
      report.storage = {
        keyPresent: Object.prototype.hasOwnProperty.call(data, spec.storageKey),
        values: safeValues(stored),
        effectiveCurrentSite: !(stored && typeof stored === 'object' && stored[spec.domain] === false),
      };
    } catch (error) { fail('chrome.storage.local.get', error); }
    if (typeof globalThis.SearchMediaSettings?.read === 'function') {
      try { report.sharedSettingsRead = safeValues(await globalThis.SearchMediaSettings.read()); }
      catch (error) { fail('SearchMediaSettings.read', error); }
    }

    const actual = read('adapter.lookup', () => Array.isArray(globalThis.SearchMediaAdapters)
      ? globalThis.SearchMediaAdapters.find((adapter) => adapter.domain === spec.domain) : null);
    const selectors = {};
    for (const key of ['roots', 'cards', 'details', 'previews']) {
      selectors[key] = typeof actual?.[key] === 'string' ? actual[key] : spec.selectors[key];
    }
    report.adapterSource = actual ? 'target-global' : 'diagnostic-page-fallback';
    report.selectors = selectors;
    const nodes = {};
    report.counts = {};
    for (const key of ['roots', 'cards', 'details', 'previews']) {
      nodes[key] = read('selectors.' + key, () => Array.from(document.querySelectorAll(selectors[key])), []);
      report.counts[key] = nodes[key].length;
    }
    report.cards = nodes.cards.slice(0, 5).map((card, index) => read('card.' + index, () => {
      const images = Array.from(card.querySelectorAll('img'));
      const videos = Array.from(card.querySelectorAll('video'));
      const media = Array.from(card.querySelectorAll('img, video'));
      return {
        ...identity(card),
        inRoot: read('card.' + index + '.root', () => Boolean(card.closest(selectors.roots))),
        inDetail: read('card.' + index + '.detail', () => Boolean(card.closest(selectors.details))),
        inNavigation: Boolean(card.closest('header, nav, aside, [role="navigation"]')),
        computed: read('card.' + index + '.computed', () => visibility(card)),
        images: images.length,
        videos: videos.length,
        media: media.slice(0, 20).map(mediaSample),
        mediaSamplesTruncated: media.length > 20,
      };
    }));
    report.pageState = read('pageState', () => ({
      controllerActive: globalThis.__mySearchMediaControllerActive === true,
      root: identity(document.documentElement),
      body: document.body ? identity(document.body) : null,
      modalId: url.searchParams.get('modal_id'),
    }));
    report.navigation = read('navigation', () => {
      const pathname = value => value == null ? null : new URL(value, location.href).pathname;
      const state = globalThis.history?.state || {};
      return {
        pathname: url.pathname,
        history: { current: pathname(state.current), back: pathname(state.back),
          forward: pathname(state.forward), position: state.position ?? null },
        blocked: (globalThis.__mySearchBlockingNavigationTrace || []).slice(-6),
        notes: spec.domain === 'xiaohongshu.com' ? Array.from(document.querySelectorAll('.note-detail-mask, .note-detail-container')).slice(0, 6).map(node => ({
          title: (node.querySelector('h1, #detail-title')?.textContent || '').slice(0, 100),
          visible: visibility(node).display !== 'none' && visibility(node).height > 0,
        })) : [],
      };
    });
    report.detailSamples = nodes.details.slice(0, 12).map((node) => ({
      ...identity(node), ancestors: ancestorSample(node),
    }));
    report.liveMedia = read('liveMedia', () => Array.from(document.querySelectorAll('video, canvas'))
      .sort((left, right) => Number(right.tagName === 'VIDEO' && !right.paused) - Number(left.tagName === 'VIDEO' && !left.paused))
      .slice(0, 20).map((node) => ({ ...mediaSample(node), ancestors: ancestorSample(node) })), []);
    if (!nodes.cards.length) {
      report.unmatchedMedia = read('unmatchedMedia', () => Array.from(document.querySelectorAll('img, video')).slice(0, 12).map((node) => {
        const ancestors = [];
        for (let parent = node.parentElement; parent && ancestors.length < 5; parent = parent.parentElement) ancestors.push(identity(parent));
        return { ...mediaSample(node), ancestors };
      }), []);
    }
    report.iframes = read('iframes', () => {
      const frames = Array.from(document.querySelectorAll('iframe'));
      return {
        count: frames.length,
        samples: frames.slice(0, 3).map((frame, index) => read('iframe.' + index, () => {
          const raw = frame.getAttribute('src');
          if (!raw) return { source: 'missing' };
          const source = new URL(raw, document.baseURI);
          return ['http:', 'https:'].includes(source.protocol)
            ? { origin: source.origin, pathname: source.pathname }
            : { protocol: source.protocol };
        })),
      };
    });
    return report;
  }

  async function run() {
    setBusy(true);
    status.textContent = '正在采样';
    const report = { createdAt: new Date().toISOString(), totalTabCount: 0, targetTabs: [], incognitoSkippedByDomain: {}, errors: [], tabs: [] };
    try {
      try {
        report.extensionId = chrome.runtime.id;
        report.contentScripts = chrome.runtime.getManifest().content_scripts || [];
      } catch (error) { report.errors.push(errorRecord('manifest', error)); }
      let tabs = [];
      try { tabs = await chrome.tabs.query({}); }
      catch (error) { report.errors.push(errorRecord('chrome.tabs.query', error)); }
      report.totalTabCount = tabs.length;
      const adapters = globalThis.SearchMediaAdapters;
      const settings = globalThis.SearchMediaSettings;
      if (!Array.isArray(adapters) || !settings) throw new Error('诊断页依赖未加载');
      const domains = settings.sites.map((site) => site.domain);
      report.incognitoSkippedByDomain = Object.fromEntries(domains.map((domain) => [domain, 0]));
      for (const tab of tabs) {
        if (!Number.isInteger(tab.id) || !tab.url) continue;
        let url;
        try { url = new URL(tab.url); }
        catch (error) { report.errors.push(errorRecord('tab.url', error)); continue; }
        if (!['http:', 'https:'].includes(url.protocol)) continue;
        const adapter = adapters.find((item) => url.hostname === item.domain || url.hostname.endsWith('.' + item.domain));
        if (!adapter) continue;
        if (tab.incognito) {
          report.incognitoSkippedByDomain[adapter.domain] += 1;
          continue;
        }
        const isSearch = adapter.isSearch(url);
        report.targetTabs.push({
          tabId: tab.id,
          hostname: url.hostname,
          pathname: url.pathname,
          incognito: false,
          discarded: Boolean(tab.discarded),
          status: tab.status || null,
          isSearch,
          ...(tab.discarded ? { skipped: 'discarded' } : {}),
        });
        if (tab.discarded) continue;
        const entry = { tabId: tab.id, domain: adapter.domain, location: { hostname: url.hostname, pathname: url.pathname } };
        report.tabs.push(entry);
        try {
          const selectors = Object.fromEntries(['roots', 'cards', 'details', 'previews'].map((key) => [key, adapter[key]]));
          const frames = await chrome.scripting.executeScript({
            target: { tabId: tab.id, frameIds: [0] },
            world: 'ISOLATED',
            func: samplePage,
            args: [{ domain: adapter.domain, domains, storageKey: settings.storageKey, selectors }],
          });
          entry.frames = frames.map((frame) => ({ frameId: frame.frameId, result: frame.result, ...(frame.error ? { error: errorRecord('frame', frame.error) } : {}) }));
          if (!frames.length) entry.error = { stage: 'executeScript.result', name: 'EmptyResult', message: '注入未返回结果' };
        } catch (error) { entry.error = errorRecord('chrome.scripting.executeScript', error); }
      }
    } catch (error) { report.errors.push(errorRecord('probe', error)); }
    let saved = false;
    try {
      await chrome.storage.local.set({ [REPORT_KEY]: report });
      saved = true;
    } catch (error) { report.errors.push(errorRecord('diagnostic.storage.set', error)); }
    let summary = document.getElementById('probe-media-summary');
    if (!summary) {
      summary = document.createElement('pre');
      summary.id = 'probe-media-summary';
      output.before(summary);
    }
    const mediaSummary = report.tabs.flatMap((tab) => (tab.frames || []).flatMap((frame) => {
      const result = frame.result;
      if (!result?.liveMedia) return [];
      return [{ domain: tab.domain, counts: result.counts, blocking: result.blocking,
        page: result.pageState, settings: result.storage,
        media: result.liveMedia.map((media) => ({
          tag: media.tag, dataE2e: media.dataE2e, playback: media.playback,
          hiddenAncestors: (media.ancestors || []).filter(({ computed, hidden, ariaHidden }) =>
            hidden || ariaHidden === 'true' || computed?.display === 'none' || computed?.visibility === 'hidden' || computed?.opacity === '0' || computed?.height === 0)
            .map(({ tag, id, class: className, dataE2e, inlineStyle, extensionAttributes, computed }) =>
              ({ tag, id, className, dataE2e, inlineStyle, extensionAttributes, computed })),
        })),
      }];
    }));
    summary.textContent = JSON.stringify(mediaSummary, null, 2);
    let blockingSummary = document.getElementById('probe-blocking-summary');
    if (!blockingSummary) {
      blockingSummary = document.createElement('pre');
      blockingSummary.id = 'probe-blocking-summary';
      blockingSummary.setAttribute('role', 'region');
      blockingSummary.setAttribute('aria-label', '阻断诊断');
      summary.before(blockingSummary);
    }
    blockingSummary.replaceChildren(...mediaSummary.map(({ domain, counts, blocking }) => {
      const line = document.createElement('span');
      line.textContent = '阻断诊断：' + JSON.stringify({
        domain, counts, title: blocking?.title, runtime: blocking?.runtime,
        activeVersion: blocking?.activeVersion,
        pageGate: blocking?.pageGate, enabled: blocking?.enabled,
        rulesApiPresent: blocking?.rulesApiPresent,
        titleMatches: blocking?.titleMatches, urlMatches: blocking?.urlMatches,
        blockedNodes: (blocking?.blockedNodes || []).slice(0, 4).map(node => ({
          tag: node.tag, id: node.id,
          reason: node.extensionAttributes?.['data-mysearch-blocked-card-value'] ||
            node.extensionAttributes?.['data-mysearch-blocked-keyword'] || null,
        })),
      }) + '\n';
      return line;
    }));
    let routeSummary = document.getElementById('probe-route-summary');
    if (!routeSummary) {
      routeSummary = document.createElement('pre');
      routeSummary.id = 'probe-route-summary';
      routeSummary.setAttribute('role', 'region');
      routeSummary.setAttribute('aria-label', '路由诊断');
      output.before(routeSummary);
    }
    routeSummary.replaceChildren(...report.tabs.flatMap(tab => (tab.frames || []).map(frame => {
      const line = document.createElement('span');
      line.textContent = '路由诊断：' + JSON.stringify({ domain: tab.domain, ...frame.result?.navigation }) + '\n';
      return line;
    })));
    output.textContent = JSON.stringify(report, null, 2);
    const sampled = report.tabs.filter((tab) => tab.frames?.some((frame) => frame.result && !frame.result.skipped)).length;
    const issues = report.errors.length + report.tabs.reduce((count, tab) => count + (tab.error ? 1 : 0)
      + (tab.frames || []).reduce((total, frame) => total + (frame.error ? 1 : 0) + (frame.result?.errors?.length || 0), 0), 0);
    status.textContent = `${report.tabs.length} 个站点标签，${sampled} 个已采样，${issues} 项异常。${saved ? '诊断记录已保存' : '诊断记录保存失败'}`;
    setBusy(false);
  }

  runButton.addEventListener('click', run);
  clearButton.addEventListener('click', async () => {
    setBusy(true);
    try {
      await chrome.storage.local.remove(REPORT_KEY);
      output.textContent = '';
      status.textContent = '诊断记录已清除';
    } catch (error) {
      status.textContent = '诊断记录清除失败';
      output.textContent = JSON.stringify(errorRecord('diagnostic.storage.remove', error), null, 2);
    } finally { setBusy(false); }
  });
  run();
})();
