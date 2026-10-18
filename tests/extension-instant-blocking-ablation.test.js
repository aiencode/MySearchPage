'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require(process.env.MYSEARCHPAGE_JSDOM_MODULE || 'jsdom');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const controller = read('extension/content/blocking-controller.js');
function blockFunction(globals) {
  const start = controller.indexOf('  function blockEvent(');
  const end = controller.indexOf('  function handleSearchSubmit(', start);
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext(`(${controller.slice(start, end).trim()})`, globals);
}
for (const kind of ['keyword', 'url', 'author']) {
  test(`ablation ${kind}: same cancellation outcome, zero presentation or waiting`, () => {
    const calls = [];
    let presentations = 0;
    const block = blockFunction({ recordClick() { calls.push('record'); return 1; }, showFeedback() { presentations++; } });
    const event = { preventDefault() { calls.push('cancel'); }, stopPropagation() { calls.push('stop'); }, stopImmediatePropagation() { calls.push('stopImmediate'); } };
    block(event, { kind, value: 'BLOCKME' });
    // Independent policy oracle: a matched action must be cancelled before its record is sent.
    assert.deepEqual(calls, ['cancel', 'stop', 'stopImmediate', 'record']);
    assert.equal(presentations, 0, 'matched actions must have no presentation side effects');
  });
}
test('ablation: deduplicated records never delay blocking; a non-match remains allowed', () => {
  const calls = [];
  let presentations = 0;
  const block = blockFunction({ recordClick() { calls.push('record'); return null; }, showFeedback() { presentations++; } });
  const event = { preventDefault() { calls.push('cancel'); }, stopPropagation() { calls.push('stop'); }, stopImmediatePropagation() { calls.push('stopImmediate'); } };
  block(event, null);
  assert.deepEqual(calls, []);
  for (let index = 0; index < 3; index++) block(event, { kind: 'keyword', value: 'BLOCKME' });
  assert.equal(calls.filter(call => call === 'cancel').length, 3);
  assert.equal(presentations, 0);
});
async function harness(t, url, rules, markup = '', title = '普通资料') {
  const dom = new JSDOM(`<!doctype html><html><head><title>${title}</title></head><body>${markup}</body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  t.after(async () => { w.testBlocking.dispose(); await new Promise(resolve => setImmediate(resolve)); w.close(); });
  const messages = [];
  const scheduledWaits = [];
  let audioContexts = 0;
  const originalTimeout = w.setTimeout.bind(w);
  w.setTimeout = (callback, delay, ...args) => { if (delay >= 500) scheduledWaits.push(delay); return originalTimeout(callback, delay, ...args); };
  w.AudioContext = class { constructor() { audioContexts++; throw new Error('audio must not be invoked'); } };
  w.chrome = {
    runtime: { lastError: null, getURL: value => `chrome-extension://fixture/${value}`, sendMessage(message, callback) {
      messages.push(message);
      callback?.(message.type === 'GET_BLOCKING_RULES' ? { success: true, rules: { blockedKeywords: [], blockedUrlPatterns: [], blockedAuthors: [], highRiskDomains: [], ...rules } } : { success: true, enabled: true });
    } },
    storage: { onChanged: { addListener() {} } },
  };
  w.eval(read('extension/shared/blocking-rules.js'));
  w.eval(read('extension/content/search-media-adapters.js'));
  w.eval(read('extension/content/blocking-page-hook.js'));
  assert.equal(controller.split('  init();').length, 2);
  w.eval(controller.replace('  init();', '  global.testBlocking = { dispose() { observer?.disconnect(); queuedNodes.clear(); } };\n  init();'));
  await new Promise(resolve => setTimeout(resolve, 20));
  return { w, messages, scheduledWaits, get audioContexts() { return audioContexts; } };
}
const searchUrls = [
  'https://www.youtube.com/results?search_query=BLOCKME',
  'https://www.douyin.com/jingxuan/search/BLOCKME',
  'https://www.xiaohongshu.com/search_result?keyword=BLOCKME',
  'https://search.bilibili.com/all?keyword=BLOCKME',
];
function assertPureBlocking(h) {
  assert.equal(h.w.document.querySelectorAll('img[id^="mysearch-blocking-"], [id*="feedback"], [class*="feedback"]').length, 0);
  assert.equal(h.messages.some(message => message.type === 'UPDATE_FEEDBACK_OUTCOME' || message.event?.type === 'feedback'), false);
  assert.deepEqual(h.scheduledWaits, []);
  assert.equal(h.audioContexts, 0);
}
for (const url of searchUrls) {
  test(`ablation ${new URL(url).hostname}: search rule remains immediate and persistent without overlays`, async t => {
    const h = await harness(t, url, { blockedKeywords: ['BLOCKME'] }, '<button id="action">打开</button>');
    assert.equal(h.w.document.documentElement.hasAttribute('data-mysearch-page-gate'), true);
    assert.equal(h.w.document.querySelector('#action').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, cancelable: true })), false);
    assert.ok(h.messages.some(message => message.event?.type === 'click'));
    assertPureBlocking(h);
    h.w.history.pushState({}, '', url.replace('BLOCKME', 'safe'));
    assert.equal(h.w.document.documentElement.hasAttribute('data-mysearch-page-gate'), false);
    assert.equal(h.w.document.querySelector('#action').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, cancelable: true })), true);
    h.w.history.replaceState({}, '', url);
    assert.equal(h.w.location.href, url.replace('BLOCKME', 'safe'));
    assert.equal(h.w.document.documentElement.hasAttribute('data-mysearch-page-gate'), false);
  });
}
for (const scenario of [
  { name: 'current URL', rules: { blockedUrlPatterns: ['/watch'] } },
  { name: 'page title', rules: { blockedKeywords: ['BLOCKME'] }, title: 'BLOCKME' },
  { name: 'homepage permission', rules: { homepageRules: { 'youtube.com': { allowHomepage: false } } }, url: 'https://www.youtube.com/' },
]) {
  test(`ablation ${scenario.name}: page rule stays active with no presentation side effects`, async t => {
    const h = await harness(t, scenario.url || 'https://www.youtube.com/watch?v=safe', scenario.rules, '<button id="action">打开</button>', scenario.title);
    assert.equal(h.w.document.documentElement.hasAttribute('data-mysearch-page-gate'), true);
    assert.equal(h.w.document.querySelector('#action').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, cancelable: true })), false);
    assertPureBlocking(h);
  });
}
test('ablation: ordinary details and unrelated actions remain available immediately', async t => {
  const h = await harness(t, 'https://www.youtube.com/watch?v=safe', { blockedKeywords: ['BLOCKME'] }, '<button id="action">收藏</button>');
  assert.equal(h.w.document.documentElement.hasAttribute('data-mysearch-page-gate'), false);
  assert.equal(h.w.document.querySelector('#action').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, cancelable: true })), true);
  assertPureBlocking(h);
});

function namedFunction(file, name, globals = {}) {
  const source = read(file);
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const expressionStart = source.slice(start - 6, start) === 'async ' ? start - 6 : start;
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return vm.runInNewContext(`(${source.slice(expressionStart, index + 1)})`, globals);
  }
  throw new Error(`Incomplete function ${name}`);
}

test('removal: runtime, manifest, resources and dashboard contain no retired presentation feature', () => {
  const runtimeFiles = ['extension/content/blocking-controller.js', 'extension/background/ua-controller.js', 'extension/options/blocking-dashboard.js', 'extension/options/options.html', 'extension/options/options.css', 'extension/manifest.json'];
  const retired = /feedback|aversive|playBeep|AudioContext|grayout|先停|倒计时|厌恶|恶心/i;
  for (const file of runtimeFiles) assert.equal(retired.test(read(file)), false, `${file} contains a retired presentation token`);
  assert.equal(fs.existsSync(path.join(root, 'extension/content/feedback-assets')), false);
  for (const artifact of ['dist', 'mysearchpage-extension.zip', 'mysearchpage-extension-douyin-fix.zip', 'mysearchpage-extension-douyin-portal-fix.zip']) assert.equal(fs.existsSync(path.join(root, artifact)), false, artifact);
});

test('removal: database upgrade deletes retired events and strips obsolete fields without losing blocking records', async t => {
  const { IDBFactory } = require(process.env.MYSEARCHPAGE_FAKE_INDEXEDDB_MODULE || 'fake-indexeddb');
  const indexedDB = new IDBFactory();
  const name = 'InstantBlockingAblation';
  const seeded = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('events', { keyPath: 'id' });
      for (const key of ['type', 'timestamp', 'keyword', 'domain', 'sessionId']) store.createIndex(key, key);
      store.put({ id: 'click-1', type: 'click', keyword: 'BLOCKME', timestamp: 10, feedbackType: 'retired' });
      store.put({ id: 'exposure-1', type: 'exposure', keyword: 'BLOCKME', timestamp: 9 });
      store.put({ id: 'retired-1', type: 'feedback', timestamp: 11 });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  seeded.close();
  const normalizeBlockingEventBG = namedFunction('extension/background/ua-controller.js', 'normalizeBlockingEventBG');
  const open = namedFunction('extension/background/ua-controller.js', 'openBlockingStatsDBBG', { indexedDB, BLOCKING_STATS_DB_BG: name, BLOCKING_STATS_DB_VERSION_BG: 2, BLOCKING_STATS_STORE_BG: 'events', blockingStatsDbPromiseBG: null, normalizeBlockingEventBG });
  const db = await open();
  t.after(() => db.close());
  const records = await new Promise((resolve, reject) => {
    const request = db.transaction('events').objectStore('events').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  assert.deepEqual(records.map(record => record.id), ['click-1', 'exposure-1']);
  assert.equal(records[0].keyword, 'BLOCKME');
  assert.equal(Object.hasOwn(records[0], 'feedbackType'), false);
  assert.throws(() => normalizeBlockingEventBG({ type: 'feedback' }));
});

test('removal: dashboard loads rule editors and only blocking statistics without the retired table', async t => {
  const dom = new JSDOM(read('extension/options/options.html'), { url: 'https://extension.test/options', runScripts: 'outside-only' });
  const w = dom.window;
  t.after(() => w.close());
  w.chrome = { runtime: { lastError: null, sendMessage(message, callback) {
    callback({ success: true, rules: { blockedKeywords: ['BLOCKME'], blockedUrlPatterns: [], blockedAuthors: [] }, stats: { today: { blockedExposureCount: 3, attemptedBlockedClickCount: 2 }, last7Days: {}, last30Days: {} } });
  } } };
  w.eval(read('extension/shared/blocking-rules.js'));
  w.eval(read('extension/options/blocking-dashboard.js'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(w.document.querySelectorAll('#blocking-stats-periods tr').length, 3);
  assert.equal(w.document.querySelector('#blocking-keyword-list input').value, 'BLOCKME');
  assert.equal(w.document.querySelectorAll('.blocking-dashboard .blocking-stats-table').length, 1);
});
