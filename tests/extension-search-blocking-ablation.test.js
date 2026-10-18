'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require(process.env.MYSEARCHPAGE_JSDOM_MODULE || 'jsdom');
const root = process.env.MYSEARCHPAGE_ABLATION_ROOT || path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sites = [
  { name: 'youtube', url: 'https://www.youtube.com/results?search_query=%E5%85%89%E7%8E%8B', detail: 'https://www.youtube.com/watch?v=1&search_query=光王', markup: '<ytd-searchbox><form><input name="search_query" value="光王"><button id="submit">搜索</button></form></ytd-searchbox>' },
  { name: 'douyin', url: 'https://www.douyin.com/jingxuan/search/%E5%85%89%E7%8E%8B?type=general', detail: 'https://www.douyin.com/video/123?keyword=光王', markup: '<form><input data-e2e="searchbar-input" value="光王"><button id="submit">搜索</button></form>' },
  { name: 'xiaohongshu', url: 'https://www.xiaohongshu.com/search_result/?keyword=%E5%85%89%E7%8E%8B', detail: 'https://www.xiaohongshu.com/explore/123?keyword=光王', markup: '<form><input data-testid="search-input" placeholder="搜索" value="光王"><button id="submit">搜索</button></form>' },
  { name: 'bilibili', url: 'https://search.bilibili.com/all?keyword=%E5%85%89%E7%8E%8B', detail: 'https://www.bilibili.com/video/BV123?keyword=光王', markup: '<form id="nav-searchform"><input class="nav-search-input" value="光王"><button id="submit">搜索</button></form>' },
];
function rulesApi() {
  const context = vm.createContext({ URL });
  vm.runInContext(read('extension/shared/blocking-rules.js'), context);
  return context.MySearchBlockingRules;
}
function backgroundMatch(api) {
  const source = read('extension/background/ua-controller.js');
  const start = source.indexOf('function findBlockingSearchMatchBG(');
  const end = source.indexOf('\nasync function readSearchSessionStateBG', start);
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext(`(${source.slice(start, end).trim()})`, { URL, MySearchBlockingRules: api });
}
async function harness(t, url, markup = '', keywords = ['光王'], enabled = true) {
  const dom = new JSDOM(`<!doctype html><html><head><title>普通资料</title></head><body>${markup}</body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => {
    assert.ok(events.every(event => ['exposure', 'click'].includes(event.type)),
      'blocking records must contain only exposures and clicks');
    assert.equal(dom.window.document.querySelector(
      '#mysearch-blocking-feedback-image, #mysearch-blocking-page-gate-image, ' +
      '#mysearch-blocking-feedback-pause, .mysearch-blocking-feedback-flash'
    ), null, 'blocking must not create feedback artifacts');
  });
  t.after(async () => {
    dom.window.testSearchBlocking?.dispose();
    await new Promise(resolve => setImmediate(resolve));
    dom.window.close();
  });
  const w = dom.window;
  const events = [];
  w.chrome = {
    runtime: { lastError: null, sendMessage(message, callback) {
      if (message.type === 'RECORD_BLOCKING_EVENT') events.push(message.event);
      callback?.(message.type === 'GET_BLOCKING_RULES' ? { success: true, rules: { blockedKeywords: keywords, blockedUrlPatterns: [], blockedAuthors: [], highRiskDomains: [] } } : { success: true, enabled });
    } },
    storage: { onChanged: { addListener() {} } },
  };
  w.eval(read('extension/shared/blocking-rules.js'));
  const source = read('extension/content/blocking-controller.js');
  assert.equal(source.split('  init();').length, 2);
  w.eval(source.replace('  init();', `  global.testSearchBlocking = {
    match: typeof findSearchKeywordMatch === 'function' ? findSearchKeywordMatch : findYouTubeSearchKeywordMatch,
    control: typeof findSearchControlMatch === 'function' ? findSearchControlMatch : findYouTubeSearchControlMatch,
    text: typeof searchTextFromUrl === 'function' ? searchTextFromUrl : rulesApi.searchTextFromUrl,
    dispose() { observer?.disconnect(); queuedNodes.clear(); },
  };\n  init();`));
  await new Promise(resolve => setTimeout(resolve, 15));
  return { w, events, api: w.testSearchBlocking };
}
for (const site of sites) {
  test(`ablation ${site.name}: encoded URL uses one keyword policy in content and background`, async t => {
    const { api } = await harness(t, site.url);
    assert.equal(api.text(site.url), '光王');
    assert.equal(api.match(site.url)?.value, '光王');
    const match = backgroundMatch(rulesApi())('', site.url, { blockedKeywords: ['光王'], blockedUrlPatterns: [] });
    assert.equal(match?.value, '光王');
  });
  test(`ablation ${site.name}: matched search automatically gates; normal search does not`, async t => {
    const blocked = await harness(t, site.url);
    assert.equal(blocked.w.document.documentElement.hasAttribute('data-mysearch-page-gate'), true);
    assert.equal(blocked.events.filter(e => e.type === 'exposure').length, 1);
    assert.equal(blocked.events.filter(e => e.type === 'click').length, 1);
    const normal = await harness(t, site.url.replace(/%E5%85%89%E7%8E%8B/g, '资料'));
    assert.equal(normal.w.document.documentElement.hasAttribute('data-mysearch-page-gate'), false);
    assert.equal(normal.events.length, 0);
  });
  test(`ablation ${site.name}: search control matching and submit block immediately and record a click`, async t => {
    const { w, api, events } = await harness(t, site.detail, site.markup);
    assert.equal(api.control(w.document.querySelector('input'))?.value, '光王');
    assert.equal(api.control(w.document.querySelector('#submit'))?.value, '光王');
    const event = new w.Event('submit', { bubbles: true, cancelable: true });
    assert.equal(w.document.querySelector('form').dispatchEvent(event), false);
    assert.equal(events.filter(e => e.type === 'click').length, 1);
  });
  test(`ablation ${site.name}: details, disabled blocking and unrelated controls stay unaffected`, async t => {
    const detail = await harness(t, site.detail, '<form id="other"><input name="message" value="光王"><button>发送</button></form>');
    assert.equal(detail.api.text(site.detail), '');
    assert.equal(detail.api.match(site.detail), null);
    assert.equal(detail.api.control(detail.w.document.querySelector('input')), null);
    assert.equal(detail.w.document.documentElement.hasAttribute('data-mysearch-page-gate'), false);
    const disabled = await harness(t, site.url, site.markup, ['光王'], false);
    assert.equal(disabled.w.document.documentElement.hasAttribute('data-mysearch-page-gate'), false);
    assert.equal(disabled.w.document.querySelector('form').dispatchEvent(new disabled.w.Event('submit', { bubbles: true, cancelable: true })), true);
    assert.equal(disabled.events.length, 0);
  });
}
test('ablation: unknown hosts, malformed URLs and literal casing stay out of search policy', async t => {
  const { api } = await harness(t, sites[0].detail);
  for (const url of ['https://youtube.com.evil.test/results?search_query=光王', 'https://example.test/search/光王', 'http://[']) {
    assert.equal(api.text(url), '');
    assert.equal(api.match(url), null);
  }
  assert.equal(api.text('https://www.douyin.com/search/%ZZ'), '%ZZ');
  assert.equal(api.match('https://www.youtube.com/results?search_query=普通'), null);
});
test('ablation: production no longer contains YouTube-only search functions or duplicate query parser', () => {
  const controller = read('extension/content/blocking-controller.js');
  const background = read('extension/background/ua-controller.js');
  assert.doesNotMatch(controller, /function (?:findYouTubeSearch\w+|youtubeSearchTextFromUrl|searchTextFromUrl)\(/);
  assert.doesNotMatch(background.slice(background.indexOf('function findBlockingSearchMatchBG('), background.indexOf('async function readSearchSessionStateBG')), /searchParams|youtube\.com|\.includes\(/);
});

for (const site of sites) {
  test(`shared ${site.name}: an unrelated submit cannot borrow another search box value`, async t => {
    const { w, api, events } = await harness(t, site.detail, site.markup + '<form id="other"><input name="message" value="普通消息"><button>发送</button></form>');
    assert.equal(api.control(w.document.querySelector('#other')), null);
    assert.equal(w.document.querySelector('#other').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })), true);
    assert.equal(events.filter(e => e.type === 'click').length, 0);
    const input = w.document.querySelector(site.name === 'youtube' ? 'input[name="search_query"]' : site.name === 'douyin' ? 'input[data-e2e="searchbar-input"]' : site.name === 'xiaohongshu' ? 'input[data-testid="search-input"]' : 'input.nav-search-input');
    assert.ok(input, 'search input must survive content scanning');
    assert.equal(input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })), false);
    assert.equal(events.filter(e => e.type === 'click').length, 1);
  });
}

test('shared route aliases and empty searches retain site boundaries', () => {
  const api = rulesApi();
  for (const url of [
    'https://search.bilibili.com/?keyword=资料',
    'https://www.bilibili.com/s/video?keyword=资料',
    'https://m.bilibili.com/v_search?q=资料',
    'https://www.xiaohongshu.com/search?q=资料',
    'https://www.douyin.com/search/资料',
    'https://m.youtube.com/results?search_query=资料',
  ]) {
    assert.equal(api.isSearchUrl(url), true);
    assert.equal(api.searchTextFromUrl(url), '资料');
  }
  assert.equal(api.isSearchUrl('https://www.douyin.com/search'), true);
  assert.equal(api.searchTextFromUrl('https://www.douyin.com/search'), '');
  assert.equal(api.searchTextFromUrl('/results?search_query=资料', 'https://www.youtube.com/'), '资料');
  assert.equal(api.searchTextFromUrl('javascript:search/资料'), '');
});

test('shared opening policy preserves literal casing, keyword order, URL and homepage priority', () => {
  const api = rulesApi();
  const url = 'https://www.youtube.com/results?search_query=second';
  const rules = { blockedKeywords: ['second', 'first'], blockedUrlPatterns: ['youtube.com'], highRiskDomains: [] };
  assert.equal(api.findSearchMatch('first', url, rules).value, 'second');
  assert.equal(api.findSearchMatch('FIRST', url, { ...rules, blockedKeywords: ['first'], blockedUrlPatterns: [] }), null);
  assert.equal(api.findSearchMatch('normal', url, { ...rules, blockedKeywords: [] }).kind, 'url');
  const home = { blockedKeywords: [], blockedUrlPatterns: [], homepageRules: { 'youtube.com': { allowHomepage: false } } };
  assert.equal(api.findSearchMatch('normal', 'https://www.youtube.com/', home).value, 'youtube.com/');
  assert.equal(api.findSearchMatch('normal', url, home), null);
});

test('shared nested unrelated form cannot borrow an enclosing search container value', async t => {
  const markup = '<div role="search"><input type="search" value="光王"><form id="other"><input name="message" value="普通消息"><button>发送</button></form></div>';
  const { w, events } = await harness(t, sites[1].detail, markup);
  assert.equal(w.document.querySelector('#other').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })), true);
  assert.equal(events.filter(e => e.type === 'click').length, 0);
});

function loadFunction(file, name, globals) {
  const source = read(file);
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const expressionStart = source.slice(start - 6, start) === 'async ' ? start - 6 : start;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) {
      return vm.runInNewContext(`(${source.slice(expressionStart, index + 1)})`, globals);
    }
  }
  throw new Error(`Incomplete function ${name}`);
}

for (const entry of ['content', 'navigation']) {
  test(`shared ${entry} legacy opening reads explicit homepage permission and encoded search rules`, async () => {
    const stored = { blockedKeywords: ['光王'], blockedUrlPatterns: [], highRiskDomains: ['douyin.com'], uaRules: { 'douyin.com': { allowHomepage: true } } };
    const created = [];
    const chrome = {
      storage: { local: { async get() { return stored; }, async set() {} } },
      runtime: { lastError: null, sendMessage(_message, callback) { callback({ success: true, enabled: true }); } },
      tabs: { async getCurrent() { return { id: 17 }; }, async create(properties) { created.push(properties.url); return { id: 18 }; } },
    };
    const context = vm.createContext({ URL, chrome });
    vm.runInContext(read('extension/shared/blocking-rules.js'), context);
    const api = context.MySearchBlockingRules;
    const globals = { rulesApi: api, MySearchBlockingRules: api, chrome, loadBlockingEnabled: async () => true, isBlockingEnabledForLegacySearch: async () => true, sendMessage: async () => ({ enabled: true }), global: { open(url) { created.push(url); return {}; } } };
    const file = entry === 'content' ? 'extension/content/blocking-controller.js' : 'extension/navigation/navigation.js';
    const open = loadFunction(file, 'openSearchResultWithLegacyBackground', globals);
    const allowed = await open('普通', 'https://www.douyin.com/');
    assert.equal(allowed.blocked, false);
    assert.equal(allowed.opened, true);
    const blocked = await open('普通', sites[1].url);
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.match.value, '光王');
    assert.equal(created.length, 1);
  });
}
