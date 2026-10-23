'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const extension = path.resolve(__dirname, '../extension');
const currentVersion = 'immediate-rule-blocking-v4';
const fixtures = [
  { id: 1, url: 'https://www.douyin.com/search/safe', marker: '' },
  { id: 2, url: 'https://search.bilibili.com/all?keyword=safe', marker: 'old-runtime' },
  { id: 3, url: 'https://www.xiaohongshu.com/search_result?keyword=safe', marker: '' },
  { id: 4, url: 'https://www.youtube.com/results?search_query=safe', marker: currentVersion, activeVersion: currentVersion, rulesApiPresent: true },
  { id: 5, url: 'https://www.google.com/search?q=safe', marker: 'old-runtime' },
  { id: 6, url: 'https://www.douyin.com/video/123', marker: '', discarded: true },
  { id: 7, url: 'chrome://extensions/', marker: '' },
  { id: 8, url: 'https://www.xiaohongshu.com/explore/safe', marker: currentVersion },
  { id: 9, url: 'https://www.douyin.com/video/456', marker: currentVersion, activeVersion: currentVersion },
];
const settle = () => new Promise(resolve => setImmediate(resolve));

function startWorker({ unavailableTab } = {}) {
  const listeners = {};
  const events = [];
  const chrome = {
    runtime: {
      getURL: file => file,
      onMessage: { addListener: listener => { listeners.message = listener; } },
      onInstalled: { addListener: listener => { listeners.installed = listener; } },
      onStartup: { addListener: listener => { listeners.startup = listener; } },
    },
    storage: {
      local: { get: async () => ({ uaRules: {} }), set: async () => {} },
      onChanged: { addListener() {} },
    },
    declarativeNetRequest: {
      getDynamicRules: async () => [],
      updateDynamicRules: async () => {},
    },
    tabs: {
      query: async query => fixtures.filter(tab => !query.url ||
        query.url.some(pattern => new URL(tab.url).hostname.endsWith(pattern.split('*.')[1].split('/')[0]))),
      reload: async tabId => { events.push({ type: 'reload', tabId }); },
    },
    scripting: {
      executeScript: async injection => {
        const tabId = injection.target.tabId;
        events.push({ type: injection.func ? 'probe' : 'inject', tabId, files: injection.files });
        if (tabId === unavailableTab) throw new Error('Tab closed or permission unavailable');
        const tab = fixtures.find(tab => tab.id === tabId);
        if (!injection.func) return [];
        // Execute the real serialized probe, not a canned result that can hide stale-DOM bugs.
        const pageWorld = vm.createContext({
          document: { documentElement: { getAttribute: () => tab?.marker } },
          __mySearchBlockingRuntimeVersion: tab?.activeVersion,
          MySearchBlockingRules: tab?.rulesApiPresent ? {} : undefined,
        });
        const probe = vm.runInContext(`(${injection.func.toString()})`, pageWorld);
        return [{ result: probe(...injection.args) }];
      },
    },
  };
  const context = vm.createContext({ chrome, URL, console: { log() {}, warn() {}, error() {} } });
  context.importScripts = (...files) => {
    for (const file of files) {
      vm.runInContext(fs.readFileSync(path.join(extension, file), 'utf8'), context, { filename: file });
    }
  };
  vm.runInContext(fs.readFileSync(path.join(extension, 'background/ua-controller.js'), 'utf8'), context);
  return {
    events,
    async ready() { await settle(); await settle(); },
    async emit(event) { listeners[event](); await this.ready(); },
    send(message) { return new Promise(resolve => listeners.message(message, {}, resolve)); },
  };
}

function reloaded(worker) {
  return worker.events.filter(event => event.type === 'reload').map(event => event.tabId);
}
function mediaInjections(worker) {
  return worker.events.filter(event => event.files?.includes('content/search-media-controller.js')).map(event => event.tabId);
}

test('ordinary worker wakeups never reload missing, stale or current page runtimes', async () => {
  // Each new VM models a terminated worker being woken again while the same tabs remain open.
  for (let wake = 0; wake < 3; wake++) {
    const worker = startWorker();
    await worker.ready();
    await worker.send({ type: 'GET_BLOCKING_STATUS' });
    assert.deepEqual(reloaded(worker), [], `wake ${wake} must preserve all open documents`);
    assert.deepEqual(mediaInjections(worker), [1, 2, 3, 4, 8, 9]);
    assert.equal(worker.events.some(event => event.type === 'probe'), false,
      'page DOM markers must not decide whether an ordinary wake reloads tabs');
  }
});

test('browser startup reconnects scripts without refreshing open tabs', async () => {
  const worker = startWorker();
  await worker.ready();
  worker.events.length = 0;
  await worker.emit('startup');
  assert.deepEqual(reloaded(worker), []);
  assert.deepEqual(mediaInjections(worker), [1, 2, 3, 4, 8, 9]);
});

test('installation/update can still refresh incompatible media runtimes', async () => {
  const worker = startWorker();
  await worker.ready();
  worker.events.length = 0;
  await worker.emit('installed');
  assert.deepEqual(reloaded(worker), [1, 2, 3, 8, 9]);
  assert.deepEqual(mediaInjections(worker), [4]);
});

test('explicit reconnect refreshes incompatible HTTP tabs but preserves current and discarded tabs', async () => {
  const worker = startWorker();
  await worker.ready();
  worker.events.length = 0;
  const response = await worker.send({ type: 'RECONNECT_SEARCH_MEDIA_TABS' });
  assert.equal(response.success, true);
  assert.equal(response.reloaded, 6);
  assert.equal(response.connected, 1);
  assert.deepEqual(reloaded(worker), [1, 2, 3, 5, 8, 9]);
  assert.deepEqual(mediaInjections(worker), [4]);
});

test('matching DOM version cannot hide a dead controller or missing rules in the current isolated world', async () => {
  const worker = startWorker();
  await worker.ready();
  assert.deepEqual(reloaded(worker), [], 'even orphaned runtimes must not refresh on ordinary wake');
  worker.events.length = 0;
  await worker.emit('installed');
  assert.ok(reloaded(worker).includes(8), 'stale matching DOM marker must not pass the probe');
  assert.ok(reloaded(worker).includes(9), 'a controller without its rules module is not healthy');
  assert.ok(!reloaded(worker).includes(4), 'a healthy current runtime must preserve its document');
});

test('a failed script injection during wakeup is skipped, never repaired by reloading', async () => {
  const worker = startWorker({ unavailableTab: 1 });
  await worker.ready();
  assert.deepEqual(reloaded(worker), []);
  assert.ok(mediaInjections(worker).includes(3), 'failure must not prevent connecting other tabs');
});
