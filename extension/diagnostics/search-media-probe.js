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
      return spec.domain === 'douyin.com' && /^\/search(?:\/|$)/.test(url.pathname);
    }
    const url = read('location', () => new URL(location.href));
    if (!url || !matchesSearch(url)) return { skipped: '页面已离开支持的搜索范围', errors };

    function identity(node) {
      return {
        tag: node.tagName,
        class: (node.getAttribute('class') || '').slice(0, 240),
        id: (node.getAttribute('id') || '').slice(0, 120),
        dataE2e: (node.getAttribute('data-e2e') || '').slice(0, 120),
        dataNoteId: (node.getAttribute('data-note-id') || '').slice(0, 120),
      };
    }
    function visibility(node) {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return { display: style.display, visibility: style.visibility, opacity: style.opacity, width: rect.width, height: rect.height };
    }
    function mediaSample(node) {
      const result = { ...identity(node), computed: read('media.computed', () => visibility(node)) };
      if (node.tagName === 'VIDEO') {
        result.playback = read('media.playback', () => ({ paused: node.paused, muted: node.muted, autoplay: node.autoplay }));
      }
      return result;
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
      location: { hostname: url.hostname, pathname: url.pathname },
      readyState: read('document.readyState', () => document.readyState),
      runtimeId: read('chrome.runtime.id', () => chrome.runtime.id),
      globals: {
        settingsPresent: read('global.settings', () => typeof globalThis.SearchMediaSettings !== 'undefined'),
        adaptersPresent: read('global.adapters', () => typeof globalThis.SearchMediaAdapters !== 'undefined'),
      },
      errors,
    };
    try {
      const data = await chrome.storage.local.get(spec.storageKey);
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
          ...(!isSearch ? { skipped: 'path-not-recognized' } : {}),
        });
        if (!isSearch) continue;
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
    output.textContent = JSON.stringify(report, null, 2);
    const sampled = report.tabs.filter((tab) => tab.frames?.some((frame) => frame.result && !frame.result.skipped)).length;
    const issues = report.errors.length + report.tabs.reduce((count, tab) => count + (tab.error ? 1 : 0)
      + (tab.frames || []).reduce((total, frame) => total + (frame.error ? 1 : 0) + (frame.result?.errors?.length || 0), 0), 0);
    status.textContent = `${report.tabs.length} 个搜索标签，${sampled} 个已采样，${issues} 项异常。${saved ? '诊断记录已保存' : '诊断记录保存失败'}`;
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
