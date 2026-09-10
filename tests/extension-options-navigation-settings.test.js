'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const settle = () => new Promise((resolve) => setImmediate(resolve));

class MiniElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.attributes = {};
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = String(value); } };
    this.className = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.files = [];
    this._innerHTML = '';
    this._textContent = '';
    this.classList = {
      contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => name && !names.includes(name)).join(' '); },
      toggle: (name) => { const next = !this.classList.contains(name); next ? this.classList.add(name) : this.classList.remove(name); return next; },
    };
  }
  set id(value) { this._id = value; if (value) this.ownerDocument.ids.set(value, this); }
  get id() { return this._id || ''; }
  set textContent(value) { this._textContent = String(value); }
  get textContent() { return this._textContent || this.children.map((child) => child.textContent).join(''); }
  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
    if (value && this.tagName === 'TR') this._parseTableCells(String(value));
  }
  get innerHTML() { return this._innerHTML || this._textContent; }
  _parseTableCells(html) {
    for (const match of html.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)) {
      const cell = this.ownerDocument.createElement('td');
      const cellClass = /class=["']([^"']+)["']/.exec(match[1]);
      if (cellClass) cell.className = cellClass[1];
      cell.textContent = match[2].replace(/<[^>]+>/g, '').trim();
      for (const inputMatch of match[2].matchAll(/<input\b([^>]*)>/gi)) {
        const input = this.ownerDocument.createElement('input');
        for (const attribute of inputMatch[1].matchAll(/([\w-]+)(?:=["']([^"']*)["'])?/g)) {
          input.setAttribute(attribute[1], attribute[2] ?? '');
        }
        const value = /\bvalue=["']([^"']*)["']/.exec(inputMatch[1]);
        if (value) input.value = value[1];
        if (/\bchecked\b/i.test(inputMatch[1])) input.checked = true;
        cell.appendChild(input);
      }
      for (const selectMatch of match[2].matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
        const select = this.ownerDocument.createElement('select');
        const selected = /<option\b[^>]*value=["']([^"']*)["'][^>]*selected/i.exec(selectMatch[2]) ||
          /<option\b[^>]*value=["']([^"']*)["']/i.exec(selectMatch[2]);
        if (selected) select.value = selected[1];
        cell.appendChild(select);
      }
      for (const buttonMatch of match[2].matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
        const button = this.ownerDocument.createElement('button');
        button.textContent = buttonMatch[2].replace(/<[^>]+>/g, '').trim();
        for (const attribute of buttonMatch[1].matchAll(/([\w-]+)=["']([^"']*)["']/g)) button.setAttribute(attribute[1], attribute[2]);
        cell.appendChild(button);
      }
      this.appendChild(cell);
    }
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'id') this.id = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'type') this.type = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_m, letter) => letter.toUpperCase())] = String(value);
  }
  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name === 'type') return this.type || null;
    return this.attributes[name] ?? null;
  }
  hasAttribute(name) { return this.getAttribute(name) != null; }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentNode = null; return child; }
  remove() { this.parentNode?.removeChild(this); }
  insertBefore(child, reference) {
    child.remove();
    const index = reference ? this.children.indexOf(reference) : -1;
    child.parentNode = this;
    index < 0 ? this.children.push(child) : this.children.splice(index, 0, child);
    return child;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  async dispatchEvent(event) {
    event.type ||= '';
    event.target ||= this;
    event.currentTarget = this;
    event.preventDefault ||= () => { event.defaultPrevented = true; };
    event.stopPropagation ||= () => { event.stopped = true; };
    for (const listener of this.listeners.get(event.type) || []) await listener.call(this, event);
    if (event.bubbles && !event.stopped && this.parentNode) await this.parentNode.dispatchEvent(event);
    return !event.defaultPrevented;
  }
  async click() {
    if (this.tagName === 'A') this.ownerDocument.downloads.push({ download: this.download, href: this.href });
    if (this.tagName === 'INPUT' && this.type === 'checkbox') this.checked = !this.checked;
    const result = await this.dispatchEvent({ type: 'click', bubbles: true });
    if (this.tagName === 'INPUT' && this.type === 'checkbox') await this.dispatchEvent({ type: 'change', bubbles: true });
    return result;
  }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  scrollIntoView() {}
  get parentElement() { return this.parentNode; }
  get offsetWidth() { return Number.parseFloat(this.style.width) || 100; }
  getBoundingClientRect() {
    const width = this.offsetWidth;
    return { width, height: 20, left: 0, right: width, top: 0, bottom: 20 };
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  matches(selector) {
    return selector.split(',').some((part) => {
      let value = part.trim().split(/\s+/).pop();
      const nth = /:nth-child\((\d+)\)/.exec(value);
      if (nth) {
        if (!this.parentNode || this.parentNode.children.indexOf(this) !== Number(nth[1]) - 1) return false;
        value = value.replace(nth[0], '');
      }
      for (const attribute of value.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
        const actual = this.getAttribute(attribute[1]);
        if (actual == null || (attribute[2] != null && actual !== attribute[2])) return false;
      }
      value = value.replace(/\[[^\]]+\]/g, '');
      const id = /#([\w-]+)/.exec(value);
      if (id && this.id !== id[1]) return false;
      if ([...value.matchAll(/\.([\w-]+)/g)].some((match) => !this.classList.contains(match[1]))) return false;
      const tag = /^([a-z][\w-]*)/i.exec(value);
      return !tag || this.tagName === tag[1].toUpperCase();
    });
  }
  closest(selector) { for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node; return null; }
  contains(candidate) { for (let node = candidate; node; node = node.parentNode) if (node === this) return true; return false; }
  querySelectorAll(selector) {
    const nth = /^(\w+):nth-child\((\d+)\)\s+(.+)$/.exec(selector.trim());
    if (nth) return this.querySelectorAll(`${nth[1]}:nth-child(${nth[2]})`).flatMap((parent) => parent.querySelectorAll(nth[3]));
    const descendant = /^(\S+)\s+(.+)$/.exec(selector.trim());
    if (descendant) return this.querySelectorAll(descendant[1]).flatMap((parent) => parent.querySelectorAll(descendant[2]));
    const result = [];
    const visit = (node) => { for (const child of node.children) { if (child.matches(selector)) result.push(child); visit(child); } };
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

class MiniDocument extends MiniElement {
  constructor(html) {
    super('#document', null);
    this.ownerDocument = this;
    this.ids = new Map();
    this.downloads = [];
    this.body = new MiniElement('body', this);
    this.head = new MiniElement('head', this);
    this.documentElement = this.body;
    this.children = [this.head, this.body];
    this.readyState = 'loading';
    this.activeElement = this.body;
    for (const match of html.matchAll(/<(input|button|select|textarea|div|table|tbody|colgroup|h[1-6])\b([^>]*)\bid=["']([^"']+)["'][^>]*>/gi)) {
      const element = this.createElement(match[1]);
      element.id = match[3];
      const type = /\btype=["']([^"']+)/i.exec(match[2]);
      if (type) element.setAttribute('type', type[1]);
      this.body.appendChild(element);
    }
    const siteBody = this.getElementById('sites-table-body');
    const siteTable = this.getElementById('sites-table');
    if (siteBody && siteTable) { siteBody.remove(); siteTable.appendChild(siteBody); }
    if (siteTable) {
      for (const _match of html.matchAll(/<th\b[^>]*>[\s\S]*?<div\b[^>]*class=["'][^"']*column-resizer[^"']*["'][^>]*>/gi)) {
        const header = this.createElement('th');
        const handle = this.createElement('div');
        handle.className = 'column-resizer';
        header.appendChild(handle);
        siteTable.appendChild(header);
      }
    }
    const ruleModal = this.getElementById('rule-modal');
    if (ruleModal) {
      for (const id of ['modal-title', 'rule-domain', 'rule-ua-mode', 'rule-preset', 'rule-custom-ua', 'rule-ui-transform', 'btn-modal-cancel', 'btn-modal-save']) {
        const element = this.getElementById(id);
        if (element) { element.remove(); ruleModal.appendChild(element); }
      }
    }
  }
  createElement(tagName) { return new MiniElement(tagName, this); }
  getElementById(id) { return this.ids.get(id) || null; }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  querySelector(selector) { return this.body.querySelector(selector); }
}

function makeStorage(initial = {}) {
  const state = clone(initial);
  const listeners = [];
  const writes = [];
  return {
    state,
    area: {
      async get(keys, callback) {
        const result = typeof keys === 'string' ? { [keys]: state[keys] } : clone(state);
        callback?.(clone(result)); return clone(result);
      },
      async set(patch, callback) {
        writes.push(clone(patch));
        const changes = {};
        for (const [key, value] of Object.entries(patch)) {
          changes[key] = { oldValue: clone(state[key]), newValue: clone(value) };
          state[key] = clone(value);
        }
        for (const listener of listeners) listener(changes, 'local');
        callback?.();
      },
    },
    writes, listeners,
    onChanged: { addListener(listener) { listeners.push(listener); } },
  };
}

function makeIndexedDB(initialConfig) {
  const records = new Map();
  if (initialConfig) records.set('main', { id: 'main', type: 'siteConfig', data: clone(initialConfig) });
  const stores = new Set(initialConfig ? ['siteConfig'] : []);
  const later = (operation) => {
    const request = { result: undefined, error: null };
    setImmediate(() => { try { request.result = operation(); request.onsuccess?.({ target: request }); } catch (error) { request.error = error; request.onerror?.({ target: request }); } });
    return request;
  };
  const store = {
    createIndex() {},
    get(key) { return later(() => records.has(key) ? clone(records.get(key)) : undefined); },
    put(value) { return later(() => { records.set(value.id, clone(value)); return value.id; }); },
    delete(key) { return later(() => records.delete(key)); },
  };
  const db = {
    objectStoreNames: { contains(name) { return stores.has(name); } },
    createObjectStore(name) { stores.add(name); return store; },
    transaction() { return { objectStore() { return store; } }; },
  };
  const opens = [];
  return {
    records, opens,
    api: { open(name, version) {
      opens.push({ name, version });
      const request = { result: db, error: null };
      setImmediate(() => { if (!stores.size) request.onupgradeneeded?.({ target: request }); request.onsuccess?.({ target: request }); });
      return request;
    } },
  };
}

function sampleConfig() {
  return {
    siteUrls: { 'bilibili-history': 'https://www.bilibili.com/history', bilibili: 'https://search.bilibili.com/all?keyword=' },
    buttonConfig: [
      { name: '哔哩历史', dataSite: 'bilibili-history', isSmall: true },
      { name: '哔哩哔哩', dataSite: 'bilibili', isSmall: false },
    ],
    siteFlags: {
      'bilibili-history': { rightClick: true, mode: 2, allowBlank: false, requireKeyword: false, desktopMode: true },
      bilibili: { rightClick: false, mode: 0, allowBlank: false, requireKeyword: true, desktopMode: true },
    },
  };
}

const DEFAULT_UA_RULES = {
  'bilibili.com': { enabled: true, uaMode: 'desktop', presetKey: 'chrome_windows', customUA: null, uiTransform: true },
  'douyin.com': { enabled: true, uaMode: 'desktop', presetKey: 'chrome_windows', customUA: null, uiTransform: true },
  'youtube.com': { enabled: true, uaMode: 'mobile', presetKey: 'android_chrome', customUA: null, uiTransform: false },
  'google.com': { enabled: true, uaMode: 'desktop', presetKey: 'chrome_windows', customUA: null, uiTransform: false },
  'xiaohongshu.com': { enabled: true, uaMode: 'mobile', presetKey: 'iphone_safari', customUA: null, uiTransform: false },
};

async function startOptions({ config = sampleConfig(), uaRules, persistent } = {}) {
  const html = read('extension/options/options.html');
  const document = new MiniDocument(html);
  const idb = persistent?.idb || makeIndexedDB(config);
  const storage = persistent?.storage || makeStorage({ globalEnabled: true, uaRules: uaRules || {
    'bilibili.com': { enabled: true, uaMode: 'desktop', presetKey: 'chrome_windows', customUA: null, uiTransform: true },
  } });
  const messages = [];
  const blobUrls = new Map();
  let blobSequence = 0;
  class HarnessURL extends URL {
    static createObjectURL(blob) {
      const url = `blob:test-${++blobSequence}`;
      blobUrls.set(url, blob);
      return url;
    }
    static revokeObjectURL() {}
  }
  const runtimeListeners = persistent?.runtimeListeners || [];
  const chrome = {
    runtime: {
      getURL(value) { return value; },
      onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
      sendMessage(message, callback) {
        messages.push(clone(message));
        let response = { success: true };
        if (message.type === 'GET_STATUS') response = { globalEnabled: storage.state.globalEnabled !== false, rules: clone(storage.state.uaRules || {}) };
        if (message.type === 'EXPORT_RULES') response = { globalEnabled: storage.state.globalEnabled !== false, uaRules: clone(storage.state.uaRules || {}) };
        if (message.type === 'UPDATE_RULE') {
          storage.state.uaRules ||= {};
          storage.state.uaRules[message.domain] = { ...(storage.state.uaRules[message.domain] || {}), ...clone(message.rule) };
        }
        if (message.type === 'DELETE_RULE') {
          storage.state.uaRules ||= {};
          delete storage.state.uaRules[message.domain];
        }
        if (message.type === 'IMPORT_RULES') {
          storage.state.uaRules = { ...(storage.state.uaRules || {}), ...clone(message.rules || {}) };
          response = { success: true, rules: clone(storage.state.uaRules) };
        }
        if (message.type === 'RESET_RULES') {
          storage.state.uaRules = clone(DEFAULT_UA_RULES);
          storage.state.globalEnabled = true;
        }
        for (const listener of runtimeListeners) listener(clone(message), {}, () => {});
        callback?.(clone(response)); return Promise.resolve(clone(response));
      },
    },
    storage: { local: storage.area, onChanged: storage.onChanged },
  };
  const localValues = persistent?.localValues || new Map();
  const localStorage = {
    getItem(key) { return localValues.has(key) ? localValues.get(key) : null; },
    setItem(key, value) { localValues.set(key, String(value)); },
    removeItem(key) { localValues.delete(key); },
  };
  const sandbox = {
    document, chrome, indexedDB: idb.api, localStorage, window: null, globalThis: null,
    console: { log() {}, warn() {}, error() {} }, navigator: { userAgent: 'test' },
    fetch: async () => ({ ok: true, json: async () => clone(config) }), alert() {}, confirm: () => true,
    Blob, URL: HarnessURL, JSON, Promise, Date, setTimeout, clearTimeout, setImmediate,
    FileReader: class { readAsText(file) { Promise.resolve(file.text()).then((result) => this.onload?.({ target: { result } }), () => this.onerror?.()); } },
    getComputedStyle: (element) => ({ display: element.style.display || 'block', width: element.style.width || '100px' }),
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const scripts = [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map((match) => match[1]);
  for (const script of scripts) {
    const relative = path.posix.normalize(path.posix.join('extension/options', script));
    vm.runInContext(read(relative), sandbox, { filename: relative });
  }
  document.readyState = 'complete';
  await document.dispatchEvent({ type: 'DOMContentLoaded' });
  for (let index = 0; index < 6; index += 1) await settle();
  return { document, messages, idb, storage, localValues, runtimeListeners, blobUrls };
}

function extractListenerRegistrations(source) {
  const markers = ['chrome.runtime.onMessage.addListener', 'chrome.storage.onChanged.addListener'];
  const registrations = [];
  for (const marker of markers) {
    let cursor = 0;
    while ((cursor = source.indexOf(marker, cursor)) >= 0) {
      const open = source.indexOf('(', cursor + marker.length);
      if (open < 0) break;
      let depth = 0;
      let quote = '';
      let escaped = false;
      let end = -1;
      for (let index = open; index < source.length; index += 1) {
        const char = source[index];
        if (quote) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === quote) quote = '';
          continue;
        }
        if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
        if (char === '(') depth += 1;
        if (char === ')' && --depth === 0) { end = index + 1; break; }
      }
      if (end > open) registrations.push(source.slice(cursor, end));
      cursor = end > cursor ? end : cursor + marker.length;
    }
  }
  return registrations;
}

function readMainConfig(idb) {
  return new Promise((resolve, reject) => {
    const request = idb.api.open('MySiteConfigDB', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const get = request.result.transaction('siteConfig', 'readonly').objectStore('siteConfig').get('main');
      get.onerror = () => reject(get.error);
      get.onsuccess = () => resolve(clone(get.result?.data));
    };
  });
}

async function startNavigationConsumer(persistent) {
  const source = read('extension/navigation/navigation.js');
  const html = read('extension/navigation/navigation.html');
  const document = new MiniDocument(html);
  const group = document.createElement('div');
  group.className = 'btn-group';
  document.body.appendChild(group);
  let reloadCount = 0;
  const loadSiteConfig = async () => {
    const config = await readMainConfig(persistent.idb);
    group.innerHTML = '';
    for (const entry of config?.buttonConfig || []) {
      const button = document.createElement('button');
      button.textContent = entry.name;
      button.setAttribute('data-site', entry.dataSite);
      button.setAttribute('data-url', config.siteUrls?.[entry.dataSite] || '');
      group.appendChild(button);
    }
    reloadCount += 1;
  };
  const chrome = {
    runtime: { onMessage: { addListener(listener) { persistent.runtimeListeners.push(listener); } } },
    storage: { onChanged: persistent.storage.onChanged },
  };
  const sandbox = { chrome, loadSiteConfig, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  const consumers = extractListenerRegistrations(source).filter((registration) => /loadSiteConfig\s*\(/.test(registration));
  for (const registration of consumers) vm.runInContext(`${registration};`, sandbox, { filename: 'navigation-config-consumer.js' });
  await loadSiteConfig();
  return {
    document,
    consumerCount: consumers.length,
    get reloadCount() { return reloadCount; },
    buttons() {
      return group.querySelectorAll('button').map((button) => ({
        site: button.getAttribute('data-site'),
        url: button.getAttribute('data-url'),
      }));
    },
  };
}

function rowValues(document) {
  return document.querySelectorAll('#sites-table-body tr').map((row) => ({
    row,
    dataSite: row.querySelector('td:nth-child(2) input')?.value,
  }));
}

function modePresentation(row) {
  const control = row.querySelector('td:nth-child(5) input');
  return {
    state: Number(control?.getAttribute('data-state')),
    symbol: control?.value || control?.textContent,
  };
}

function presentsDesktop(row) {
  const control = row.querySelector('td:nth-child(6) input');
  const state = control?.getAttribute('data-desktop');
  if (state != null) return state === '1';
  if (control?.value) return control.value === 'desktop';
  return control?.checked === true;
}

function uaRulesSent(messages) {
  const rules = {};
  for (const message of messages) {
    if (message.type === 'UPDATE_RULE' && message.domain) {
      rules[message.domain] = { ...(rules[message.domain] || {}), ...(message.rule || {}) };
    }
    if (message.type === 'IMPORT_RULES') {
      Object.assign(rules, clone(message.rules || {}));
    }
  }
  return rules;
}

async function startRealNavigationButtons(config) {
  const html = read('extension/navigation/navigation.html');
  const document = new MiniDocument(html);
  for (const className of ['btn-group', 'control-buttons', 'clear-input', 'fixed-header', 'scrollable-content', 'history-title']) {
    const element = document.createElement('div');
    element.className = className;
    document.body.appendChild(element);
  }
  const idb = makeIndexedDB(config);
  const runtimeListeners = [];
  const storageListeners = [];
  const localValues = new Map();
  const localStorage = {
    getItem(key) { return localValues.has(key) ? localValues.get(key) : null; },
    setItem(key, value) { localValues.set(key, String(value)); },
    removeItem(key) { localValues.delete(key); },
  };
  const windowListeners = new Map();
  const sandbox = {
    document,
    indexedDB: idb.api,
    localStorage,
    chrome: {
      runtime: {
        getURL(value) { return value; },
        openOptionsPage() { return Promise.resolve(); },
        onMessage: { addListener(listener) { runtimeListeners.push(listener); } },
      },
      storage: { onChanged: { addListener(listener) { storageListeners.push(listener); } } },
    },
    SearchHistoryPersistence: {
      create() {
        return {
          async load() { return []; }, async getAll() { return []; }, async add() {}, async rename() {},
          async remove() {}, async import() { return []; }, async restore() {},
        };
      },
    },
    window: null,
    navigator: { clipboard: { writeText() { return Promise.resolve(); } } },
    screen: { width: 1280, height: 720 },
    location: { href: 'chrome-extension://test/navigation/navigation.html' },
    history: { pushState() {}, replaceState() {} },
    alert() {}, confirm: () => true,
    fetch: async () => ({ ok: true, json: async () => clone(config) }),
    getComputedStyle: (element) => ({ display: element.style.display || 'block' }),
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    URL, Blob, JSON, Promise, Date, Math, encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame(callback) { return setTimeout(callback, 0); },
    cancelAnimationFrame: clearTimeout,
    console: { log() {}, warn() {}, error() {} },
  };
  sandbox.window = {
    document,
    location: sandbox.location,
    innerWidth: 1280,
    innerHeight: 720,
    open() {},
    addEventListener(type, listener) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(listener);
    },
    removeEventListener() {},
    getComputedStyle: sandbox.getComputedStyle,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('extension/navigation/navigation.js'), sandbox, { filename: 'extension/navigation/navigation.js' });
  await vm.runInContext('loadSiteConfig()', sandbox);
  for (let index = 0; index < 5; index += 1) await settle();
  return { document, buttons: document.querySelectorAll('.btn-group button[data-site]') };
}

test('TC-OPTIONS-001 complete non-Gitee settings surface lives in options', () => {
  const html = read('extension/options/options.html');
  for (const id of ['settings-search', 'add-site-row', 'delete-selected-rows', 'save-settings', 'toggle-context', 'toggle-require', 'export-config', 'import-config', 'config-file-input', 'sites-table', 'sites-table-body']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  for (const header of ['按钮名称', 'Data-site', 'Site Urls', '右键', '单开', '桌面/手机', '操作']) assert.ok(html.includes(header));
  assert.doesNotMatch(html + read('extension/options/options.js'), /gitee|码云/i);
});

test('TC-OPTIONS-002 shared IndexedDB loads ordered rows and saves isSmall/flags', async () => {
  const app = await startOptions();
  assert.deepEqual(app.idb.opens, [{ name: 'MySiteConfigDB', version: 1 }]);
  const rows = rowValues(app.document);
  assert.deepEqual(rows.map((item) => item.dataSite), ['bilibili-history', 'bilibili']);
  assert.equal(rows[0].row.dataset.isSmall === 'true' || rows[0].row.getAttribute('data-is-small') === 'true', true);
  await app.document.getElementById('save-settings').click();
  for (let index = 0; index < 4; index += 1) await settle();
  const stored = app.idb.records.get('main');
  assert.equal(stored.type, 'siteConfig');
  assert.equal(stored.data.buttonConfig[0].isSmall, true);
  assert.equal(stored.data.siteFlags['bilibili-history'].mode, 2);
  assert.equal(stored.data.siteFlags['bilibili-history'].rightClick, true);
});

test('TC-CONTRACT-001 single-open states render, cycle, and persist with the navigation contract', async () => {
  const config = {
    siteUrls: {
      forbidden: 'https://forbidden.example/search?q=',
      both: 'https://both.example/search?q=',
      blankOnly: 'https://blank.example/',
    },
    buttonConfig: [
      { name: '禁止单开', dataSite: 'forbidden' },
      { name: '都允许', dataSite: 'both' },
      { name: '只能单开', dataSite: 'blankOnly' },
    ],
    siteFlags: {
      forbidden: { mode: 0, allowBlank: false, requireKeyword: true },
      both: { mode: 1, allowBlank: true, requireKeyword: false },
      blankOnly: { mode: 2, allowBlank: false, requireKeyword: false },
    },
  };
  const app = await startOptions({ config, uaRules: {} });
  const rows = rowValues(app.document).map((item) => item.row);
  assert.deepEqual(rows.map(modePresentation), [
    { state: 0, symbol: '☒' },
    { state: 1, symbol: '☑' },
    { state: 2, symbol: '●' },
  ], '0/1/2 must mean NO_BLANK/BOTH/BLANK_ONLY in the options table');

  for (const row of rows) await row.querySelector('td:nth-child(5) input').click();
  assert.deepEqual(rows.map(modePresentation), [
    { state: 1, symbol: '☑' },
    { state: 2, symbol: '●' },
    { state: 0, symbol: '☒' },
  ], 'a click must advance through the same 0→1→2 state order as navigation');

  await app.document.getElementById('save-settings').click();
  for (let index = 0; index < 5; index += 1) await settle();
  const flags = app.idb.records.get('main').data.siteFlags;
  assert.deepEqual(flags.forbidden, {
    rightClick: false, mode: 1, desktopMode: true, allowBlank: true, requireKeyword: false,
  });
  assert.deepEqual(flags.both, {
    rightClick: false, mode: 2, desktopMode: true, allowBlank: false, requireKeyword: false,
  });
  assert.deepEqual(flags.blankOnly, {
    rightClick: false, mode: 0, desktopMode: true, allowBlank: false, requireKeyword: true,
  });
});

test('TC-CONTRACT-002 original navigation config imports without siteFlags and receives safe defaults', async () => {
  const app = await startOptions();
  const imported = {
    siteUrls: {
      alpha: 'https://alpha.example/search?q=',
      beta: 'https://beta.example/',
    },
    buttonConfig: [
      { name: 'Alpha', dataSite: 'alpha', isSmall: false },
      { name: 'Beta', dataSite: 'beta', isSmall: true },
    ],
  };
  const input = app.document.getElementById('config-file-input');
  input.files = [{ text: async () => JSON.stringify(imported) }];
  await input.dispatchEvent({ type: 'change', target: input });
  for (let index = 0; index < 8; index += 1) await settle();

  assert.deepEqual(rowValues(app.document).map((item) => item.dataSite), ['alpha', 'beta']);
  const stored = app.idb.records.get('main').data;
  assert.deepEqual(stored.buttonConfig, imported.buttonConfig);
  for (const site of ['alpha', 'beta']) {
    assert.deepEqual(stored.siteFlags[site], {
      rightClick: false, mode: 0, desktopMode: true, allowBlank: false, requireKeyword: true,
    });
  }
});

test('TC-OPTIONS-003 filter supports pinyin, multi-term AND, and all fields', async () => {
  const app = await startOptions();
  const input = app.document.getElementById('settings-search');
  assert.ok(input, 'options must provide the live settings search input');
  const visible = () => rowValues(app.document).filter(({ row }) => row.style.display !== 'none').map((item) => item.dataSite);
  for (const [query, expected] of [['blls', ['bilibili-history']], ['bl history', ['bilibili-history']], ['哔哩哔哩', ['bilibili']], ['bl missing', []]]) {
    input.value = query; await input.dispatchEvent({ type: 'input', bubbles: true });
    assert.deepEqual(visible(), expected, `filter result for ${query}`);
  }
});

test('TC-OPTIONS-004 real add/select/delete/batch toggles and drag reorder mutate rows', async () => {
  const app = await startOptions();
  const body = app.document.getElementById('sites-table-body');
  const add = app.document.getElementById('add-site-row');
  assert.ok(body && add, 'options must initialize the site table and add control');
  await add.click();
  assert.equal(body.querySelectorAll('tr').length, 3);
  let rows = body.querySelectorAll('tr');
  await rows[0].dispatchEvent({ type: 'click', bubbles: true });
  assert.equal(rows[0].classList.contains('selected'), true);
  const right = rows[0].querySelector('td:nth-child(4) input');
  assert.ok(right, 'rendered site row must expose its right-click control');
  const beforeRight = right.checked || right.getAttribute('data-checked') === '1';
  await app.document.getElementById('toggle-context').click();
  assert.notEqual(right.checked || right.getAttribute('data-checked') === '1', beforeRight);
  const mode = rows[0].querySelector('td:nth-child(5) input');
  assert.ok(mode, 'rendered site row must expose its three-state single-open control');
  const toggleRequire = app.document.getElementById('toggle-require');
  assert.ok(toggleRequire, 'options must expose the batch single-open control');
  const modes = [];
  for (let index = 0; index < 4; index += 1) {
    await toggleRequire.click();
    modes.push(Number(mode.getAttribute('data-state')));
  }
  assert.deepEqual(modes, [0, 1, 2, 0], 'batch control must follow navigation mode order 0→1→2→0');
  const transferred = new Map();
  const dataTransfer = {
    setData(type, value) { transferred.set(type, String(value)); },
    getData(type) { return transferred.get(type) || ''; },
    effectAllowed: '',
    dropEffect: '',
  };
  const firstSite = rowValues(app.document)[0].dataSite;
  await rows[0].dispatchEvent({ type: 'dragstart', dataTransfer });
  await rows[1].dispatchEvent({ type: 'dragover', dataTransfer });
  await rows[1].dispatchEvent({ type: 'drop', dataTransfer });
  assert.notEqual(rowValues(app.document)[0].dataSite, firstSite);
  rows = body.querySelectorAll('tr'); rows.at(-1).classList.add('selected');
  await app.document.getElementById('delete-selected-rows').click();
  assert.equal(body.querySelectorAll('tr').length, 2);
  await app.document.getElementById('save-settings').click();
  for (let index = 0; index < 4; index += 1) await settle();
  assert.deepEqual(
    app.idb.records.get('main').data.buttonConfig.map((item) => item.dataSite),
    rowValues(app.document).map((item) => item.dataSite),
    'saving after a drop must persist the live row order',
  );
  assert.deepEqual(app.idb.records.get('main').data.siteFlags['bilibili-history'], {
    rightClick: false,
    mode: 0,
    desktopMode: true,
    allowBlank: false,
    requireKeyword: true,
  }, 'batch right-click and mode changes must persist the complete navigation flags');
});

test('TC-OPTIONS-005 site import/export run through real controls', async () => {
  const app = await startOptions();
  const exportButton = app.document.getElementById('export-config');
  const input = app.document.getElementById('config-file-input');
  assert.ok(exportButton && input, 'options must expose live site import/export controls');
  await exportButton.click();
  for (let index = 0; index < 3; index += 1) await settle();
  const download = app.document.downloads.find((item) => item.download === 'SiteUrls.json');
  assert.ok(download);
  const exportedBlob = app.blobUrls.get(download.href);
  assert.ok(exportedBlob, 'site export download must reference the generated JSON blob');
  const exported = JSON.parse(await exportedBlob.text());
  assert.deepEqual(exported.buttonConfig.map((item) => item.dataSite), ['bilibili-history', 'bilibili']);
  assert.equal(exported.buttonConfig[0].isSmall, true);
  assert.equal(exported.siteFlags['bilibili-history'].rightClick, true);
  assert.equal(exported.siteFlags['bilibili-history'].mode, 2);
  assert.equal(exported.siteFlags['bilibili-history'].desktopMode, true);
  const imported = sampleConfig(); imported.buttonConfig.reverse();
  input.files = [{ text: async () => JSON.stringify(imported) }];
  await input.dispatchEvent({ type: 'change', target: input });
  for (let index = 0; index < 6; index += 1) await settle();
  assert.deepEqual(rowValues(app.document).map((item) => item.dataSite), ['bilibili', 'bilibili-history']);
  assert.deepEqual(app.idb.records.get('main').data.buttonConfig.map((item) => item.dataSite), ['bilibili', 'bilibili-history']);
});

test('TC-OPTIONS-006 desktop/mobile event synchronizes domain, persists, and preserves UA fields', async () => {
  for (const uiTransform of [true, false]) {
    const config = sampleConfig();
    config.siteFlags['bilibili-history'].desktopMode = true;
    config.siteFlags.bilibili.desktopMode = false;
    const app = await startOptions({ config, uaRules: { 'bilibili.com': { enabled: false, uaMode: 'desktop', presetKey: 'chrome_mac', customUA: 'keep', uiTransform } } });
    const rows = rowValues(app.document);
    assert.equal(rows.length, 2, 'options must render both rows from the shared configuration');
    const mobile = rows[1].row.querySelector('td:nth-child(6) input');
    assert.ok(mobile, 'rendered site row must expose its desktop/mobile control');
    const peer = rows[0].row.querySelector('td:nth-child(6) input');
    assert.ok(peer, 'the same-domain peer row must expose its desktop/mobile control');
    const presentsMobile = (control) => {
      const desktop = control.getAttribute('data-desktop');
      if (desktop != null) return desktop === '0';
      if (control.value) return control.value === 'mobile';
      return control.checked === false;
    };
    assert.equal(presentsMobile(mobile), false, 'clicked row must initially present desktop mode');
    assert.equal(presentsMobile(peer), false, 'same-domain peer must initially present desktop mode');
    const updatesBeforeClick = app.messages.filter((message) => message.type === 'UPDATE_RULE' && message.domain === 'bilibili.com').length;
    await mobile.click();
    for (let index = 0; index < 2; index += 1) await settle();
    const immediateUpdates = app.messages.filter((message) => message.type === 'UPDATE_RULE' && message.domain === 'bilibili.com').slice(updatesBeforeClick);
    assert.equal(immediateUpdates.length, 1, 'one base-domain toggle must apply one coherent live UA rule');
    const update = immediateUpdates[0];
    assert.ok(update, 'desktop/mobile control must update the live UA rule without waiting for settings save');
    assert.equal(update.rule.uaMode, 'mobile');
    assert.equal(update.rule.presetKey, 'android_chrome');
    assert.equal(presentsMobile(mobile), true);
    assert.equal(presentsMobile(peer), true, 'rows sharing one base domain must immediately present the same mobile state');
    assert.equal(update.rule.enabled, false);
    assert.equal(update.rule.customUA, 'keep');
    assert.equal(update.rule.uiTransform, uiTransform);
    await app.document.getElementById('save-settings').click();
    for (let index = 0; index < 5; index += 1) await settle();
    const stored = app.idb.records.get('main').data;
    assert.equal(stored.siteFlags.bilibili.desktopMode, false);
    assert.equal(stored.siteFlags['bilibili-history'].desktopMode, false);
    assert.deepEqual(app.storage.state.uaRules['bilibili.com'], {
      enabled: false,
      uaMode: 'mobile',
      presetKey: 'android_chrome',
      customUA: 'keep',
      uiTransform,
    });
  }
});

test('TC-CONTRACT-003 switching a site back to desktop sends the real chrome_windows preset', async () => {
  const app = await startOptions();
  const control = rowValues(app.document)[0].row.querySelector('td:nth-child(6) input');
  await control.click();
  await control.click();
  for (let index = 0; index < 3; index += 1) await settle();
  const updates = app.messages.filter((message) => message.type === 'UPDATE_RULE' && message.domain === 'bilibili.com');
  assert.equal(updates.at(-1)?.rule.uaMode, 'desktop');
  assert.equal(updates.at(-1)?.rule.presetKey, 'chrome_windows',
    'desktop mode must name an existing preset instead of relying on a background fallback');
});

test('TC-CONTRACT-004 site rows follow live UA rules at initialization and after UA edit/import/reset', async (t) => {
  await t.test('initial status overrides stale per-row desktop flags for every same-domain row', async () => {
    const app = await startOptions({ uaRules: {
      'bilibili.com': { enabled: true, uaMode: 'mobile', presetKey: 'android_chrome', uiTransform: false },
    } });
    assert.deepEqual(rowValues(app.document).map(({ row }) => presentsDesktop(row)), [false, false]);
  });

  await t.test('editing a UA rule updates the corresponding site rows', async () => {
    const config = sampleConfig();
    for (const flags of Object.values(config.siteFlags)) flags.desktopMode = false;
    const app = await startOptions({ config, uaRules: {
      'bilibili.com': { enabled: true, uaMode: 'mobile', presetKey: 'android_chrome', uiTransform: false },
    } });
    const edit = app.document.querySelector('[data-action="edit"]');
    assert.ok(edit, 'the live UA row must expose its edit action');
    await edit.click();
    app.document.getElementById('rule-ua-mode').value = 'desktop';
    app.document.getElementById('rule-preset').value = 'chrome_windows';
    await app.document.getElementById('btn-modal-save').click();
    assert.deepEqual(rowValues(app.document).map(({ row }) => presentsDesktop(row)), [true, true]);
  });

  await t.test('UA file import updates site rows', async () => {
    const app = await startOptions();
    const input = app.document.getElementById('file-import');
    input.files = [{ text: async () => JSON.stringify({ uaRules: {
      'bilibili.com': { enabled: true, uaMode: 'mobile', presetKey: 'android_chrome', uiTransform: false },
    } }) }];
    await input.dispatchEvent({ type: 'change', target: input });
    for (let index = 0; index < 5; index += 1) await settle();
    assert.deepEqual(rowValues(app.document).map(({ row }) => presentsDesktop(row)), [false, false]);
  });

  await t.test('resetting UA rules updates site rows to defaults', async () => {
    const config = sampleConfig();
    for (const flags of Object.values(config.siteFlags)) flags.desktopMode = false;
    const app = await startOptions({ config, uaRules: {
      'bilibili.com': { enabled: true, uaMode: 'mobile', presetKey: 'android_chrome', uiTransform: false },
    } });
    await app.document.getElementById('btn-reset-rules').click();
    for (let index = 0; index < 5; index += 1) await settle();
    assert.deepEqual(rowValues(app.document).map(({ row }) => presentsDesktop(row)), [true, true]);
  });
});

test('TC-CONTRACT-005 save and import normalize site UA by base domain and apply live rules', async (t) => {
  const config = {
    siteUrls: {
      biliSearch: 'https://search.bilibili.com/all?keyword=',
      biliHistory: 'https://www.bilibili.com/history',
    },
    buttonConfig: [
      { name: 'Bili', dataSite: 'biliSearch' },
      { name: 'History', dataSite: 'biliHistory' },
    ],
    siteFlags: {
      biliSearch: { mode: 0, desktopMode: false },
      biliHistory: { mode: 0, desktopMode: true },
    },
  };
  const preservedRule = {
    enabled: false,
    uaMode: 'desktop',
    presetKey: 'chrome_mac',
    customUA: 'preserve-this-UA-field',
    uiTransform: true,
  };
  const setPresentedDesktop = (row, isDesktop) => {
    const control = row.querySelector('td:nth-child(6) input');
    control.checked = isDesktop;
    control.value = isDesktop ? 'desktop' : 'mobile';
    control.setAttribute('data-desktop', isDesktop ? '1' : '0');
  };
  const assertNormalizedResult = (app, updates) => {
    assert.equal(updates.length, 1, 'two rows sharing a base domain must emit exactly one domain update');
    const update = updates[0];
    assert.equal(update.domain, 'bilibili.com');
    const finalRule = app.storage.state.uaRules['bilibili.com'];
    assert.equal(finalRule.enabled, false);
    assert.equal(finalRule.customUA, 'preserve-this-UA-field');
    assert.equal(finalRule.uiTransform, true);
    const expectedDesktop = finalRule.uaMode === 'desktop';
    assert.ok(finalRule.uaMode === 'desktop' || finalRule.uaMode === 'mobile');
    assert.equal(finalRule.presetKey, expectedDesktop ? 'chrome_windows' : 'android_chrome');
    assert.deepEqual(rowValues(app.document).map(({ row }) => presentsDesktop(row)), [expectedDesktop, expectedDesktop]);
    const stored = app.idb.records.get('main').data.siteFlags;
    assert.deepEqual([stored.biliSearch.desktopMode, stored.biliHistory.desktopMode], [expectedDesktop, expectedDesktop]);
  };

  await t.test('save applies one coherent live mode per base domain', async () => {
    const app = await startOptions({ config, uaRules: { 'bilibili.com': preservedRule } });
    const rows = rowValues(app.document).map(({ row }) => row);
    setPresentedDesktop(rows[0], false);
    setPresentedDesktop(rows[1], true);
    const before = app.messages.length;
    await app.document.getElementById('save-settings').click();
    for (let index = 0; index < 5; index += 1) await settle();
    const updates = app.messages.slice(before).filter((message) => message.type === 'UPDATE_RULE');
    assertNormalizedResult(app, updates);
  });

  await t.test('site-config import applies and presents the normalized live modes', async () => {
    const app = await startOptions({ uaRules: { 'bilibili.com': preservedRule } });
    const input = app.document.getElementById('config-file-input');
    const before = app.messages.length;
    input.files = [{ text: async () => JSON.stringify(config) }];
    await input.dispatchEvent({ type: 'change', target: input });
    for (let index = 0; index < 8; index += 1) await settle();
    const updates = app.messages.slice(before).filter((message) => message.type === 'UPDATE_RULE');
    assertNormalizedResult(app, updates);
  });
});

test('TC-CONTRACT-006 navigation-import action converts the loaded navigation config into UA rules', async () => {
  const config = sampleConfig();
  for (const flags of Object.values(config.siteFlags)) flags.desktopMode = false;
  const app = await startOptions({ config, uaRules: {} });
  const before = app.messages.length;
  await app.document.getElementById('btn-import-msp').click();
  for (let index = 0; index < 5; index += 1) await settle();
  const rules = uaRulesSent(app.messages.slice(before));
  assert.equal(rules['bilibili.com']?.uaMode, 'mobile');
  assert.equal(rules['bilibili.com']?.presetKey, 'android_chrome');
});

test('TC-OPTIONS-007 column drag changes width and reopened options restores it', async () => {
  const persistent = { idb: makeIndexedDB(sampleConfig()), storage: makeStorage(), localValues: new Map(), runtimeListeners: [] };
  const first = await startOptions({ persistent });
  const handle = first.document.querySelector('.column-resizer');
  assert.ok(handle);
  const column = handle.parentNode;
  const before = column.style.width || column.getAttribute('width') || '';
  await handle.dispatchEvent({ type: 'mousedown', clientX: 100 });
  await first.document.dispatchEvent({ type: 'mousemove', clientX: 140 });
  await first.document.dispatchEvent({ type: 'mouseup', clientX: 140 });
  const changed = column.style.width || column.getAttribute('width') || '';
  assert.notEqual(changed, before);
  const second = await startOptions({ persistent });
  const restored = second.document.querySelector('.column-resizer').parentNode;
  assert.equal(restored.style.width || restored.getAttribute('width') || '', changed);
});

test('TC-CONTRACT-007 dropping a site row auto-persists the order and notifies an open navigation page', async () => {
  const persistent = {
    idb: makeIndexedDB(sampleConfig()),
    storage: makeStorage({ globalEnabled: true, uaRules: {} }),
    localValues: new Map(),
    runtimeListeners: [],
  };
  const navigation = await startNavigationConsumer(persistent);
  const app = await startOptions({ persistent });
  const rows = rowValues(app.document);
  const dataTransfer = {
    values: new Map(),
    setData(type, value) { this.values.set(type, String(value)); },
    getData(type) { return this.values.get(type) || ''; },
    effectAllowed: '',
    dropEffect: '',
  };
  await rows[0].row.dispatchEvent({ type: 'dragstart', dataTransfer });
  await rows[1].row.dispatchEvent({ type: 'drop', dataTransfer });
  await rows[0].row.dispatchEvent({ type: 'dragend', dataTransfer });
  for (let index = 0; index < 8; index += 1) await settle();

  assert.deepEqual(app.idb.records.get('main').data.buttonConfig.map((item) => item.dataSite),
    ['bilibili', 'bilibili-history'], 'drop must persist the new row order without an extra Save click');
  assert.deepEqual(navigation.buttons().map((item) => item.site), ['bilibili', 'bilibili-history'],
    'the already-open navigation consumer must render the dropped order without an extra Save click');
});

test('TC-OPTIONS-008 real keydown drives focus, filter, navigation, save, and Escape', async () => {
  const app = await startOptions();
  const search = app.document.getElementById('settings-search');
  assert.ok(search, 'options must provide the settings search input for keyboard control');
  await app.document.dispatchEvent({ type: 'keydown', key: 'F8' });
  assert.equal(app.document.activeElement, search);
  await app.document.dispatchEvent({ type: 'keydown', key: '哔' });
  assert.ok(search.value.includes('哔'));
  for (const key of ['ArrowDown', 'ArrowRight', 'Tab']) {
    const before = app.document.activeElement; await app.document.dispatchEvent({ type: 'keydown', key });
    assert.notEqual(app.document.activeElement, before, `${key} must move focus`);
  }
  const firstName = rowValues(app.document)[0]?.row.querySelector('td:nth-child(1) input');
  assert.ok(firstName, 'keyboard save must operate on a real rendered setting value');
  firstName.value = '键盘保存后的名称';
  await app.document.dispatchEvent({ type: 'keydown', key: 'Enter' });
  for (let index = 0; index < 4; index += 1) await settle();
  assert.equal(app.idb.records.get('main').data.buttonConfig[0].name, '键盘保存后的名称');
  search.value = 'bili'; search.focus();
  await app.document.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(search.value, '');
});

test('TC-CONTRACT-008 text editing keeps horizontal arrows, and an open UA modal traps Tab', async (t) => {
  await t.test('horizontal arrows remain native inside text input', async () => {
    const app = await startOptions();
    const textInput = rowValues(app.document)[0].row.querySelector('td:nth-child(1) input');
    const outcomes = [];
    for (const key of ['ArrowLeft', 'ArrowRight']) {
      textInput.focus();
      const event = { type: 'keydown', key, target: textInput };
      await app.document.dispatchEvent(event);
      outcomes.push({ key, focusUnchanged: app.document.activeElement === textInput, defaultPrevented: event.defaultPrevented === true });
    }
    assert.deepEqual(outcomes, [
      { key: 'ArrowLeft', focusUnchanged: true, defaultPrevented: false },
      { key: 'ArrowRight', focusUnchanged: true, defaultPrevented: false },
    ], 'horizontal arrows in text input must remain native caret movement');
  });

  await t.test('Tab remains inside an open UA modal', async () => {
    const app = await startOptions();
    await app.document.getElementById('btn-add-rule').click();
    const modalControls = [
      app.document.getElementById('rule-domain'),
      app.document.getElementById('rule-ua-mode'),
      app.document.getElementById('rule-preset'),
      app.document.getElementById('rule-custom-ua'),
      app.document.getElementById('rule-ui-transform'),
      app.document.getElementById('btn-modal-cancel'),
      app.document.getElementById('btn-modal-save'),
    ].filter(Boolean);
    const first = modalControls[0];
    const last = modalControls.at(-1);
    first.focus();
    const backwards = { type: 'keydown', key: 'Tab', shiftKey: true, target: first };
    await app.document.dispatchEvent(backwards);
    const backwardOutcome = { wrapped: app.document.activeElement === last, defaultPrevented: backwards.defaultPrevented === true };
    last.focus();
    const forwards = { type: 'keydown', key: 'Tab', shiftKey: false, target: last };
    await app.document.dispatchEvent(forwards);
    const forwardOutcome = { wrapped: app.document.activeElement === first, defaultPrevented: forwards.defaultPrevented === true };
    assert.deepEqual({ backwardOutcome, forwardOutcome }, {
      backwardOutcome: { wrapped: true, defaultPrevented: true },
      forwardOutcome: { wrapped: true, defaultPrevented: true },
    }, 'the modal must trap and wrap Tab/Shift+Tab at both ends');
  });
});

test('TC-OPTIONS-009 existing UA controls execute real message/download workflows', async () => {
  const app = await startOptions();
  const global = app.document.getElementById('opt-global-toggle'); global.checked = false;
  await global.dispatchEvent({ type: 'change' });
  assert.ok(app.messages.some((message) => message.type === 'TOGGLE_GLOBAL' && message.enabled === false));
  await app.document.getElementById('btn-add-rule').click();
  app.document.getElementById('rule-domain').value = 'example.com';
  app.document.getElementById('rule-ua-mode').value = 'mobile';
  app.document.getElementById('rule-preset').value = 'android_chrome';
  app.document.getElementById('rule-ui-transform').checked = false;
  await app.document.getElementById('btn-modal-save').click();
  assert.ok(app.messages.some((message) => message.type === 'UPDATE_RULE' && message.domain === 'example.com'));
  await app.document.getElementById('btn-reset-rules').click();
  assert.ok(app.messages.some((message) => message.type === 'RESET_RULES'));
  const input = app.document.getElementById('file-import');
  input.files = [{ text: async () => JSON.stringify({ uaRules: { 'example.com': { enabled: true } } }) }];
  await input.dispatchEvent({ type: 'change', target: input });
  assert.ok(app.messages.some((message) => message.type === 'IMPORT_RULES'));
  await app.document.getElementById('btn-export-file').click();
  assert.ok(app.messages.some((message) => message.type === 'EXPORT_RULES'));
  assert.ok(app.document.downloads.some((item) => item.download === 'ua-rules.json'));
  const deleteButton = app.document.querySelector('[data-action="delete"]');
  assert.ok(deleteButton); await deleteButton.click();
  assert.ok(app.messages.some((message) => message.type === 'DELETE_RULE'));
});

test('TC-OPTIONS-010 navigation removes modal and real settings binding opens options', () => {
  const html = read('extension/navigation/navigation.html');
  const source = read('extension/navigation/navigation.js');
  assert.doesNotMatch(html, /id=["']settings-modal["']/);
  assert.doesNotMatch(source, /getElementById\s*\(\s*["']settings-modal["']/);
  assert.match(source, /settingsBtn[\s\S]{0,500}addEventListener\s*\(\s*["']click["'][\s\S]{0,500}openOptionsPage\s*\(/);
  for (const id of ['search-input', 'quick-search-input', 'history-list']) assert.match(html, new RegExp(`id=["']${id}["']`));
});

test('TC-CONTRACT-009 navigation respects each real button right-click switch', async () => {
  const outcomes = [];
  for (const rightClick of [false, true]) {
    const config = sampleConfig();
    config.buttonConfig = [{ name: '哔哩哔哩', dataSite: 'bilibili', isSmall: false }];
    config.siteUrls = { bilibili: config.siteUrls.bilibili };
    config.siteFlags = { bilibili: { mode: 0, allowBlank: false, requireKeyword: true, rightClick } };
    const navigation = await startRealNavigationButtons(config);
    assert.equal(navigation.buttons.length, 1, 'persisted navigation config must render one real site button');
    const button = navigation.buttons[0];
    const event = { type: 'contextmenu', bubbles: true };
    await button.dispatchEvent(event);
    outcomes.push({ rightClick, prevented: event.defaultPrevented === true, selected: button.classList.contains('selected') });
  }
  assert.deepEqual(outcomes, [
    { rightClick: false, prevented: false, selected: false },
    { rightClick: true, prevented: true, selected: true },
  ]);
});

test('TC-CONTRACT-010 manifest permissions cover every base domain derived from bundled navigation URLs', () => {
  const config = JSON.parse(read('extension/navigation/SiteUrls.json'));
  const manifest = JSON.parse(read('extension/manifest.json'));
  const multiLabelPublicSuffixes = new Set(['com.hk', 'com.cn', 'com.au', 'co.uk', 'co.jp']);
  const baseDomain = (hostname) => {
    const labels = hostname.toLowerCase().split('.');
    if (labels.length <= 2) return hostname.toLowerCase();
    const lastTwo = labels.slice(-2).join('.');
    return labels.slice(multiLabelPublicSuffixes.has(lastTwo) ? -3 : -2).join('.');
  };
  const baseDomains = [...new Set(Object.values(config.siteUrls).flatMap((value) => {
    try {
      const hostname = new URL(value).hostname.toLowerCase();
      return [baseDomain(hostname)];
    } catch (_error) {
      return [];
    }
  }))].sort();
  const permissions = manifest.host_permissions || [];
  const covered = (domain) => permissions.some((pattern) => {
    const match = /^(?:\*|https?):\/\/([^/]+)\//i.exec(pattern);
    if (!match) return pattern === '<all_urls>';
    const host = match[1].toLowerCase();
    if (host === '*') return true;
    const suffix = host.startsWith('*.') ? host.slice(2) : host;
    return domain === suffix || domain.endsWith('.' + suffix);
  });
  assert.equal(baseDomain('www.google.com.hk'), 'google.com.hk');
  assert.ok(covered('google.com.hk'), 'the already-supported google.com.hk base domain must keep explicit host permission');
  assert.deepEqual(baseDomains.filter((domain) => !covered(domain)), [],
    'every configurable navigation row must have permission for its actual UA-changing base domain');
});

test('TC-CONTRACT-011 options keeps google.com.hk intact when applying a real site-row UA change', async () => {
  const config = {
    siteUrls: { googleHk: 'https://www.google.com.hk/search?q=' },
    buttonConfig: [{ name: 'Google HK', dataSite: 'googleHk', isSmall: false }],
    siteFlags: { googleHk: { mode: 0, allowBlank: false, requireKeyword: true, desktopMode: true } },
  };
  const app = await startOptions({ config, uaRules: {
    'google.com.hk': { enabled: true, uaMode: 'desktop', presetKey: 'chrome_windows', customUA: null, uiTransform: false },
  } });
  const control = rowValues(app.document)[0].row.querySelector('td:nth-child(6) input');
  await control.click();
  for (let index = 0; index < 3; index += 1) await settle();
  const update = app.messages.find((message) => message.type === 'UPDATE_RULE');
  assert.equal(update?.domain, 'google.com.hk');
  assert.equal(update?.rule.uaMode, 'mobile');
});

test('TC-OPTIONS-011 real save/import publish a signal consumed by open navigation', async () => {
  const persistent = {
    idb: makeIndexedDB(sampleConfig()),
    storage: makeStorage({ globalEnabled: true, uaRules: {} }),
    localValues: new Map(),
    runtimeListeners: [],
  };
  const navigation = await startNavigationConsumer(persistent);
  assert.ok(navigation.consumerCount > 0,
    'navigation must register and execute a config-change consumer while the page remains open');
  assert.deepEqual(navigation.buttons().map((item) => item.site), ['bilibili-history', 'bilibili']);
  const app = await startOptions({ persistent });
  const save = app.document.getElementById('save-settings');
  const file = app.document.getElementById('config-file-input');
  assert.ok(save && file, 'options must initialize real save/import controls');
  const urlInput = rowValues(app.document)[0].row.querySelector('td:nth-child(3) input');
  urlInput.value = 'https://changed.example/search?q=';
  const readsBeforeSave = navigation.reloadCount;
  await save.click();
  for (let index = 0; index < 6; index += 1) await settle();
  assert.ok(navigation.reloadCount > readsBeforeSave, 'save must cause the open navigation page to reread shared configuration');
  assert.equal(navigation.buttons()[0].url, 'https://changed.example/search?q=');
  const imported = sampleConfig();
  imported.buttonConfig.reverse();
  imported.siteUrls.bilibili = 'https://imported.example/?q=';
  const readsBeforeImport = navigation.reloadCount;
  file.files = [{ text: async () => JSON.stringify(imported) }];
  await file.dispatchEvent({ type: 'change', target: file });
  for (let index = 0; index < 8; index += 1) await settle();
  assert.ok(navigation.reloadCount > readsBeforeImport, 'import must cause the open navigation page to reread shared configuration');
  assert.deepEqual(navigation.buttons().map((item) => item.site), ['bilibili', 'bilibili-history']);
  assert.equal(navigation.buttons()[0].url, 'https://imported.example/?q=');
});
