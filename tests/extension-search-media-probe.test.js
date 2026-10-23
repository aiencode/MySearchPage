'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../extension/diagnostics/search-media-probe.js'), 'utf8');

async function runProbe({ active = true, historyState } = {}) {
  const nodes = {};
  const element = () => ({
    textContent: '', disabled: false, children: [],
    addEventListener() {}, setAttribute() {},
    before(node) { nodes[node.id] = node; },
    replaceChildren(...children) { this.children = children; },
  });
  for (const id of ['probe-status', 'probe-output', 'probe-run', 'probe-clear']) nodes[id] = element();
  const root = { tagName: 'HTML', attributes: [], getAttribute: name => name === 'data-mysearch-blocking-runtime' ? 'immediate-rule-blocking-v4' : null, hasAttribute: () => false };
  const data = { blockedKeywords: ['命中标题', '未命中词'], blockedUrlPatterns: ['/explore/safe', '/other'], blockingEnabled: true };
  const pageWorld = vm.createContext({
    URL, location: { href: 'https://www.xiaohongshu.com/explore/safe?private=not-for-summary' },
    history: { state: historyState },
    document: { title: '命中标题 - 小红书', readyState: 'complete', documentElement: root, body: null, querySelectorAll: () => [] },
    chrome: { runtime: { id: 'test-extension' }, storage: { local: { get: async () => data } } },
    __mySearchBlockingRuntimeVersion: active ? 'immediate-rule-blocking-v4' : undefined,
    MySearchBlockingRules: active ? {} : undefined,
  });
  const injections = [];
  let saved;
  const chrome = {
    runtime: { id: 'test-extension', getManifest: () => ({ content_scripts: [] }) },
    tabs: { query: async () => [
      { id: 1, url: 'https://www.xiaohongshu.com/explore/safe' },
      { id: 2, url: 'https://www.xiaohongshu.com/explore/private', incognito: true },
      { id: 3, url: 'https://www.xiaohongshu.com/explore/discarded', discarded: true },
      { id: 4, url: 'https://example.com/' },
    ] },
    scripting: { executeScript: async injection => {
      injections.push(injection.target.tabId);
      const sample = vm.runInContext(`(${injection.func.toString()})`, pageWorld);
      return [{ frameId: 0, result: await sample(...injection.args) }];
    } },
    storage: { local: { set: async value => { saved = value.searchMediaRuntimeProbe; } } },
  };
  vm.runInNewContext(source, {
    URL, chrome,
    document: { getElementById: id => nodes[id], createElement: element },
    SearchMediaSettings: { sites: [{ domain: 'xiaohongshu.com' }], storageKey: 'media' },
    SearchMediaAdapters: [{ domain: 'xiaohongshu.com', isSearch: url => url.pathname === '/search_result', roots: '.root', cards: '.card', details: '.detail', previews: '.preview' }],
  });
  for (let i = 0; i < 10 && !nodes['probe-status'].textContent.includes('诊断记录已保存'); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(saved, 'probe must save its report');
  assert.match(nodes['probe-status'].textContent, /0 项异常/);
  return { report: saved, injections, nodes };
}

test('diagnostics samples detail pages, skips private/discarded tabs, and reports only matching rules', async () => {
  const { report, injections, nodes } = await runProbe();
  assert.deepEqual(injections, [1]);
  assert.equal(report.incognitoSkippedByDomain['xiaohongshu.com'], 1);
  const sample = report.tabs[0].frames[0].result;
  assert.equal(sample.location.isSearch, false);
  assert.equal(sample.blocking.activeVersion, 'immediate-rule-blocking-v4');
  assert.equal(sample.blocking.rulesApiPresent, true);
  assert.equal(sample.blocking.pageGate, false);
  assert.deepEqual(Array.from(sample.blocking.titleMatches), ['命中标题']);
  assert.deepEqual(Array.from(sample.blocking.urlMatches), ['/explore/safe']);
  const summary = nodes['probe-blocking-summary'].children.map(node => node.textContent).join('');
  assert.match(summary, /activeVersion/);
  assert.doesNotMatch(summary, /not-for-summary|未命中词|\/other/);
});

test('diagnostics distinguishes a matching DOM marker from a dead isolated runtime', async () => {
  const { report } = await runProbe({ active: false });
  const { blocking } = report.tabs[0].frames[0].result;
  assert.equal(blocking.runtime, 'immediate-rule-blocking-v4');
  assert.equal(blocking.activeVersion, '');
  assert.equal(blocking.rulesApiPresent, false);
});

test('route diagnostics retains history identity without exposing query tokens', async () => {
  const { report, nodes } = await runProbe({ historyState: {
    current: '/explore/safe?xsec_token=current-secret',
    back: '/search_result?keyword=private-search',
    forward: '/explore/next?xsec_token=next-secret#private', position: 17,
  } });
  const navigation = report.tabs[0].frames[0].result.navigation;
  assert.deepEqual(JSON.parse(JSON.stringify(navigation.history)), {
    current: '/explore/safe', back: '/search_result', forward: '/explore/next', position: 17,
  });
  const summary = nodes['probe-route-summary'].children.map(node => node.textContent).join('');
  assert.match(summary, /\/explore\/safe/);
  assert.doesNotMatch(summary, /secret|xsec_token|private-search|keyword=/);
});
