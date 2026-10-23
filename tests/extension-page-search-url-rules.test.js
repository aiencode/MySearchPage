'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const context = vm.createContext({ URL });
vm.runInContext(read('extension/shared/blocking-rules.js'), context);
const api = context.MySearchBlockingRules;

function loadFunction(file, name, globals) {
  const source = read(file);
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const begin = source.slice(start - 6, start) === 'async ' ? start - 6 : start;
  let depth = 0;
  for (let index = source.indexOf('{', start); index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) {
      return vm.runInNewContext(`(${source.slice(begin, index + 1)})`, globals);
    }
  }
  throw new Error(`Incomplete function ${name}`);
}

const cases = [
  ['needle', 'https://www.google.com/search?q=needle'],
  ['needle guide', 'https://www.google.com/search?q=needle+guide'],
  ['光王', 'https://www.youtube.com/results?search_query=%E5%85%89%E7%8E%8B'],
  ['needle', 'https://www.douyin.com/search/needle?type=general'],
  ['needle', 'https://www.xiaohongshu.com/search_result?keyword=needle'],
  ['needle', 'https://search.bilibili.com/all?keyword=needle'],
  ['a/b&c', 'https://example.test/search?q=a%2Fb%26c'],
];
for (const [keyword, url] of cases) {
  test(`page search does not treat generated keyword as URL: ${url}`, () => {
    const pattern = url.includes('%E5') ? '%E5%85%89' : url.includes('%2F') ? '%2Fb' : 'needle';
    const rules = { blockedKeywords: [], blockedUrlPatterns: [pattern] };
    assert.equal(api.findSearchMatch(keyword, url, rules), null);
    assert.equal(api.findUrlPattern(url, rules.blockedUrlPatterns), pattern,
      'address-bar navigation still matches the complete URL');
    assert.equal(api.findSearchMatch(keyword, url, { ...rules, blockedKeywords: [keyword] }).kind, 'keyword');
  });
}

test('real URL components and homepage restrictions remain enforced', () => {
  for (const url of [
    'https://needle.example/search?q=needle',
    'https://example.test/needle/path?q=ordinary',
    'https://example.test/search?q=ordinary&source=needle',
  ]) {
    assert.equal(api.findSearchMatch('ordinary', url, { blockedUrlPatterns: ['needle'] }).kind, 'url');
  }
  assert.equal(api.findSearchMatch('needle', 'https://www.douyin.com/', {
    homepageRules: { 'douyin.com': { allowHomepage: false } },
  }).kind, 'url');
  assert.equal(api.searchUrlForRules('needle', 'not a URL'), 'not a URL');
});

test('result-page matching excludes keyword only for the exact recorded target', () => {
  const targetUrl = cases[0][1];
  const rules = { blockedUrlPatterns: ['needle'], pageSearchContext: { keyword: 'needle', targetUrl } };
  const match = loadFunction('extension/content/blocking-controller.js', 'findUrlMatch', {
    rules, rulesApi: api, absoluteUrl: raw => new URL(raw, targetUrl).href,
  });
  assert.equal(match(targetUrl, false), null);
  assert.equal(match('https://example.test/needle', false), 'needle');
  assert.equal(match(`${targetUrl}&other=1`, false), 'needle');
  rules.pageSearchContext = null;
  assert.equal(match(targetUrl, false), 'needle', 'address-bar search must not inherit a page-search exception');
});

function storageHarness() {
  const data = {};
  return {
    data,
    async get(key) { return { [key]: data[key] && { ...data[key] } }; },
    async set(values) { Object.assign(data, values); },
    async remove(key) { delete data[key]; },
  };
}

test('background records source before result navigation and survives worker reload', async () => {
  const storage = storageHarness();
  const targetUrl = cases[0][1];
  const operations = [];
  const chrome = { storage: { session: storage }, tabs: {
    async create(properties) { operations.push(properties.url); return { id: 22 }; },
    async update(tabId, properties) {
      assert.equal(tabId, 22);
      assert.equal(storage.data['mySearchKeywordNavigation:22'].targetUrl, targetUrl);
      operations.push(properties.url);
    },
  } };
  const open = loadFunction('extension/background/ua-controller.js', 'openSearchResultBG', {
    URL, chrome, MySearchBlockingRules: api,
    getBlockingEnabledBG: async () => true, getUARulesBG: async () => ({}),
    getBlockingRulesBG: async () => ({ blockedUrlPatterns: ['needle'] }),
    findBlockingSearchMatchBG: api.findSearchMatch,
    startSearchSessionBG: async () => ({ enabled: false }),
  });
  assert.equal((await open({ tab: { id: 10 } }, 'needle', targetUrl)).opened, true);
  assert.deepEqual(operations, ['about:blank', targetUrl]);
  const loadContext = () => loadFunction('extension/background/ua-controller.js', 'getPageSearchContextBG', { chrome });
  const sender = { tab: { id: 22 }, frameId: 0, documentId: 'page-search-document', url: targetUrl };
  assert.equal(await loadContext()(sender), null, 'unrelated rule readers must not consume the context');
  assert.equal((await loadContext()(sender, 'navigate')).keyword, 'needle');
  assert.equal((await loadContext()(sender, 'navigate')).keyword, 'needle', 'new worker reads the same document context');
  assert.equal(await loadContext()({ ...sender, frameId: 1 }, 'navigate'), null);
  assert.equal(await loadContext()({ ...sender, tab: { id: 23 } }, 'navigate'), null);
  assert.equal((await loadContext()({ ...sender, documentId: 'reloaded-document' }, 'reload')).keyword, 'needle');
  assert.equal(await loadContext()({ ...sender, documentId: 'address-bar-document' }, 'navigate'), null);
  assert.equal(storage.data['mySearchKeywordNavigation:22'], undefined);
});

test('changing the URL invalidates the page-search context', async () => {
  const storage = storageHarness();
  storage.data['mySearchKeywordNavigation:22'] = { keyword: 'needle', targetUrl: cases[0][1], documentId: 'original' };
  const getContext = loadFunction('extension/background/ua-controller.js', 'getPageSearchContextBG', {
    chrome: { storage: { session: storage } },
  });
  assert.equal(await getContext({ tab: { id: 22 }, frameId: 0, documentId: 'next', url: 'https://example.test/needle' }, 'navigate'), null);
  assert.equal(storage.data['mySearchKeywordNavigation:22'], undefined);
});

test('failed result navigation cleans up the temporary tab and context', async () => {
  const storage = storageHarness();
  const removed = [];
  const open = loadFunction('extension/background/ua-controller.js', 'openSearchResultBG', {
    URL, MySearchBlockingRules: api,
    chrome: { storage: { session: storage }, tabs: {
      async create() { return { id: 22 }; },
      async update() { throw new Error('navigation failed'); },
      async remove(id) { removed.push(id); },
    } },
    getBlockingEnabledBG: async () => true, getUARulesBG: async () => ({}),
    getBlockingRulesBG: async () => ({}), findBlockingSearchMatchBG: api.findSearchMatch,
    startSearchSessionBG: async () => ({ enabled: false }),
  });
  await assert.rejects(open({ tab: { id: 10 } }, 'needle', cases[0][1]), /navigation failed/);
  assert.deepEqual(removed, [22]);
  assert.deepEqual(storage.data, {});
});

for (const url of [
  'https://www.google.com/search?q=%40%E5%85%89%E7%8E%8B',
  'https://www.google.com/search?q=@%e5%85%89%e7%8e%8b',
  'https://www.youtube.com/results?search_query=%40%E5%85%89%E7%8E%8B',
  'https://www.douyin.com/search/%40%E5%85%89%E7%8E%8B',
  'https://www.xiaohongshu.com/search_result?keyword=%40%E5%85%89%E7%8E%8B',
  'https://search.bilibili.com/all?keyword=%40%E5%85%89%E7%8E%8B',
  'https://example.test/search?q=%40%6e%65%65%64%6c%65',
]) {
  test(`address-bar @ prefix cannot bypass an encoded URL rule: ${url}`, () => {
    const pattern = url.includes('%6e') ? 'needle' : '光王';
    const keyword = `@${pattern}`;
    const rules = { blockedKeywords: [], blockedUrlPatterns: [pattern] };
    assert.equal(api.findUrlPattern(url, rules.blockedUrlPatterns), pattern);
    assert.equal(api.findSearchMatch('', url, rules)?.value, pattern);
    assert.equal(api.findSearchMatch(keyword, url, rules), null,
      'navigation-page search must still be isolated from URL-only rules');
    assert.equal(api.findSearchMatch(keyword, url, { ...rules, blockedKeywords: [pattern] })?.kind, 'keyword');
  });
}

test('URL matching decodes escaped text without changing literal case or rule priority', () => {
  assert.equal(api.findUrlPattern('https://example.test/?q=%40needle', ['@needle']), '@needle');
  assert.equal(api.findUrlPattern('https://example.test/?q=%40needle', ['%40needle']), '%40needle');
  assert.equal(api.findUrlPattern('https://example.test/?q=%40needle', ['needle', '%40']), 'needle');
  assert.equal(api.findUrlPattern('https://example.test/?q=%40NEEDLE', ['needle']), null);
  assert.equal(api.findUrlPattern('https://example.test/?q=%ZZ&other=%40%E5%85%89%E7%8E%8B', ['光王']), '光王');
  assert.equal(api.findUrlPattern('https://example.test/?q=%E0%A4', ['光王']), null);
  assert.equal(api.findUrlPattern('https://example.test/?q=ordinary', ['光王']), null);
});

test('full content runtime keeps page-search results open but gates address-bar results', async t => {
  const { JSDOM } = require(process.env.MYSEARCHPAGE_JSDOM_MODULE || 'jsdom');
  for (const [keyword, targetUrl, pattern] of [
    ['needle', 'https://www.youtube.com/results?search_query=needle', 'needle'],
    ['@光王', 'https://www.google.com/search?q=%40%E5%85%89%E7%8E%8B', '光王'],
    ['@光王', 'https://www.douyin.com/search/%40%E5%85%89%E7%8E%8B', '光王'],
  ]) for (const fromPage of [true, false]) {
    const dom = new JSDOM('<!doctype html><title>普通资料</title><body><main>普通结果</main></body>', {
      url: targetUrl, runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const w = dom.window;
    t.after(() => { w.testSearchBlocking.dispose(); w.close(); });
    w.chrome = {
      runtime: { lastError: null, sendMessage(message, callback) {
        callback?.(message.type === 'GET_BLOCKING_RULES' ? { success: true, rules: {
          blockedKeywords: [], blockedUrlPatterns: [pattern],
          pageSearchContext: fromPage ? { keyword, targetUrl } : null,
        } } : { success: true, enabled: true });
      } },
      storage: { onChanged: { addListener() {} } },
    };
    w.eval(read('extension/shared/blocking-rules.js'));
    w.eval(read('extension/content/blocking-controller.js').replace('  init();',
      '  global.testSearchBlocking = { dispose() { observer?.disconnect(); queuedNodes.clear(); } };\n  init();'));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(w.document.documentElement.hasAttribute('data-mysearch-page-gate'), !fromPage);
    if (fromPage) assert.ok(w.document.body.textContent.includes('普通结果'));
  }
});
