/* Shared storage contract for options and isolated content scripts. */
(function () {
  'use strict';

  const storageKey = 'searchMediaSettings';
  const sites = Object.freeze([
    Object.freeze({ domain: 'bilibili.com', label: '哔哩哔哩' }),
    Object.freeze({ domain: 'douyin.com', label: '抖音' }),
    Object.freeze({ domain: 'youtube.com', label: 'YouTube' }),
    Object.freeze({ domain: 'xiaohongshu.com', label: '小红书' }),
  ]);
  let writes = Promise.resolve();

  function storedObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function normalize(value) {
    const saved = storedObject(value);
    return Object.fromEntries(sites.map(({ domain }) => [domain, saved[domain] !== false]));
  }

  async function read() {
    const data = await chrome.storage.local.get(storageKey);
    return normalize(data[storageKey]);
  }

  function setEnabled(domain, enabled) {
    if (!sites.some((site) => site.domain === domain) || typeof enabled !== 'boolean') {
      return Promise.reject(new TypeError('Invalid search media setting'));
    }
    const operation = writes.catch(() => {}).then(async () => {
      // Read immediately before each write, rather than saving the options page's
      // initial snapshot over choices made for another site in the meantime.
      const data = await chrome.storage.local.get(storageKey);
      const next = { ...storedObject(data[storageKey]), [domain]: enabled };
      await chrome.storage.local.set({ [storageKey]: next });
      return normalize(next);
    });
    writes = operation;
    return operation;
  }

  function subscribe(listener) {
    const onChanged = (changes, area) => {
      if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, storageKey)) {
        listener(normalize(changes[storageKey].newValue));
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }

  globalThis.SearchMediaSettings = Object.freeze({ storageKey, sites, normalize, read, setEnabled, subscribe });
})();
