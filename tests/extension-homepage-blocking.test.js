'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const context = vm.createContext({ URL });
vm.runInContext(read('extension/shared/blocking-rules.js'), context);
const api = context.MySearchBlockingRules;
const domains = ['douyin.com', 'bilibili.com'];
const emptyRules = { blockedKeywords: [], blockedUrlPatterns: [], highRiskDomains: domains };

function loadFunction(file, name, globals = {}) {
  const source = read(file);
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  const expressionStart = source.slice(start - 6, start) === 'async ' ? start - 6 : start;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) {
      return vm.runInNewContext(`(${source.slice(expressionStart, i + 1)})`, globals);
    }
  }
  throw new Error(`Incomplete function ${name}`);
}

for (const url of [
  'https://bilibili.com', 'https://www.bilibili.com/',
  'http://www.bilibili.com/', 'https://m.bilibili.com/',
  'https://www.bilibili.com/index.html',
  'https://www.bilibili.com/?spm_id_from=333.1007#home',
  'https://www.bilibili.com/?keyword=资料',
  'https://www.bilibili.com./', 'https://WWW.BILIBILI.COM/',
  'https://douyin.com', 'https://www.douyin.com/',
  'https://www.douyin.com/?from=search',
  'https://www.douyin.com/jingxuan', 'https://www.douyin.com/jingxuan/',
  'https://www.douyin.com/?modal_id=not-a-video',
]) {
  test(`configured platform homepage is blocked: ${url}`, () => {
    assert.ok(api.findBlockedHomepage(url, domains));
  });
}

for (const url of [
  'https://search.bilibili.com/all?keyword=资料',
  'https://search.bilibili.com/?keyword=资料',
  'https://www.bilibili.com/s/video?keyword=资料',
  'https://m.bilibili.com/v_search?keyword=资料',
  'https://www.bilibili.com/video/BV1test',
  'https://www.bilibili.com/bangumi/play/ep123',
  'https://space.bilibili.com/', 'https://space.bilibili.com/123',
  'https://passport.bilibili.com/',
  'https://www.douyin.com/search/资料?type=general',
  'https://www.douyin.com/jingxuan/search/资料?type=general',
  'https://www.douyin.com/video/123', 'https://www.douyin.com/user/self',
  'https://www.douyin.com/?modal_id=123456',
  'https://www.douyin.com/jingxuan?modal_id=123456',
  'https://www.example.com/', 'https://bilibili.com.evil.example/',
  'https://notbilibili.com/', 'https://evil.example/bilibili.com/',
  'https://www.bilibili.com@evil.example/',
  'javascript:alert(1)', 'not a URL',
]) {
  test(`homepage rule does not replace search/detail/domain rules: ${url}`, () => {
    assert.equal(api.findBlockedHomepage(url, domains), null);
  });
}

test('homepage matching requires an explicitly configured domain and leaves collections untouched', () => {
  assert.equal(api.findBlockedHomepage('https://www.bilibili.com/', []), null);
  assert.equal(api.findBlockedHomepage('https://www.bilibili.com/', ['douyin.com']), null);
  assert.ok(api.findBlockedHomepage('https://www.bilibili.com/', ['https://www.bilibili.com/']));
  assert.equal(api.findBlockedHomepage('https://www.bilibili.com/', ['bilibili.com.evil.example']), null);
  const before = JSON.stringify(emptyRules);
  api.findBlockedHomepage('https://www.bilibili.com/', emptyRules.highRiskDomains);
  assert.equal(JSON.stringify(emptyRules), before);
  assert.equal(api.findUrlPattern('https://www.bilibili.com/', []), null);
});

test('content URL matching handles relative homepage links without blocking result targets', () => {
  const match = loadFunction('extension/content/blocking-controller.js', 'findUrlMatch', {
    rulesApi: api, rules: emptyRules,
    absoluteUrl: raw => new URL(raw, 'https://www.bilibili.com/s/video?keyword=资料').href,
  });
  assert.equal(match('/'), 'bilibili.com/');
  assert.equal(match('/?spm_id_from=tracking'), 'bilibili.com/');
  assert.equal(match('/s/video?keyword=资料'), null);
  assert.equal(match('https://search.bilibili.com/all?keyword=资料'), null);
  assert.equal(match('/video/BV1test'), null);
});

test('background search opening cannot disguise a homepage using a supplied keyword', () => {
  const match = loadFunction('extension/background/ua-controller.js', 'findBlockingSearchMatchBG', {
    URL, MySearchBlockingRules: api,
  });
  const homepage = match('资料', 'https://www.bilibili.com/', emptyRules);
  assert.equal(homepage.kind, 'url');
  assert.equal(homepage.value, 'bilibili.com/');
  assert.equal(match('资料', 'https://search.bilibili.com/all?keyword=资料', emptyRules), null);
  assert.equal(match('资料', 'https://www.douyin.com/jingxuan/search/资料', emptyRules), null);
  assert.equal(match('资料', 'https://www.douyin.com/', emptyRules).kind, 'url');
  assert.equal(match('资料', 'https://www.bilibili.com/', { ...emptyRules, highRiskDomains: [] }), null);
});

test('explicit keyword and URL rules keep priority over homepage matching', () => {
  const match = loadFunction('extension/background/ua-controller.js', 'findBlockingSearchMatchBG', {
    URL, MySearchBlockingRules: api,
  });
  assert.equal(match('blocked', 'https://www.bilibili.com/', {
    ...emptyRules, blockedKeywords: ['blocked'], blockedUrlPatterns: ['www.bilibili.com'],
  }).kind, 'keyword');
  assert.equal(match('资料', 'https://www.bilibili.com/', {
    ...emptyRules, blockedUrlPatterns: ['www.bilibili.com'],
  }).value, 'www.bilibili.com');
});

test('homepage match enters the existing persistent page gate and releases after a real route change', () => {
  const global = { location: { href: 'https://www.bilibili.com/' } };
  const detectedContext = {
    global, currentUrlPattern: api.findBlockedHomepage(global.location.href, domains),
    currentTitleKeyword: null, currentSearchMatch: null,
    normalizeNavigationUrl: raw => raw,
  };
  const detect = loadFunction('extension/content/blocking-controller.js', 'detectedPageBlockingMatch', detectedContext);
  const homepage = detect();
  assert.equal(homepage.pageSource, 'url');
  assert.equal(homepage.targetUrl, global.location.href);
  const clear = loadFunction('extension/content/blocking-controller.js', 'shouldClearPersistentPageGate');
  const gate = { ...homepage, pageViewKey: 'https://www.bilibili.com/|page' };
  assert.equal(clear(gate, gate.pageViewKey, homepage, false, false), false);
  assert.equal(clear(gate, 'https://search.bilibili.com/all?keyword=资料|page', null, true, false), true);
  assert.equal(clear(gate, 'https://www.bilibili.com/video/BV1test|page', null, false, true), true);
  global.location.href = 'https://www.bilibili.com/';
  assert.equal(detect().value, 'bilibili.com/');
});

test('page-gate notice updates are idempotent so its own DOM mutations cannot spin the observer', () => {
  let text = '';
  let writes = 0;
  let pageSource = 'url';
  const notice = {
    get textContent() { return text; },
    set textContent(value) { text = value; writes += 1; },
  };
  const render = loadFunction('extension/content/blocking-controller.js', 'renderPageNotice', {
    global: { document: { documentElement: { setAttribute() {}, removeAttribute() {} }, getElementById: () => notice } },
    pageIsBlocked: true, PAGE_GATE_ATTR: 'data-mysearch-page-gate', NOTICE_ID: 'mysearch-blocking-notice',
    canCreateDocumentNodes: () => true, installStyle() {},
    currentPageBlockingMatch: () => ({ pageSource }),
  });
  render();
  render();
  render();
  assert.equal(writes, 1);
  pageSource = 'title';
  render();
  render();
  assert.equal(writes, 2, 'a real notice change is rendered once');
});

test('explicit homepage permissions override high-risk membership and retain independent defaults', () => {
  assert.equal(api.isHomepageAllowed('bilibili.com', {}), false);
  assert.equal(api.isHomepageAllowed('douyin.com', {}), false);
  assert.equal(api.isHomepageAllowed('example.com', {}), true);
  assert.equal(api.isHomepageAllowed('bilibili.com', { allowHomepage: true }), true);
  assert.equal(api.findBlockedHomepage('https://www.bilibili.com/', [], {}), 'bilibili.com/');
  assert.equal(api.findBlockedHomepage('https://www.bilibili.com/', domains, { 'bilibili.com': { allowHomepage: true } }), null);
  const denied = { 'example.com': { allowHomepage: false } };
  assert.equal(api.findBlockedHomepage('https://www.example.com/', [], denied), 'example.com/');
  assert.equal(api.findBlockedHomepage('https://www.example.com/?q=资料', [], denied), null);
  assert.equal(api.findBlockedHomepage('https://search.bilibili.com/all?keyword=资料', [], {}), null);
});

test('network permissions block only homepage main documents and preserve root searches/modal details', () => {
  const network = Array.from(api.createHomepageNetworkRules({ 'example.com': { allowHomepage: false } }, 10));
  assert.equal(new Set(network.map(rule => rule.id)).size, network.length);
  assert.equal(network[0].id, 10);
  assert.ok(network.every(rule => JSON.stringify(rule.condition.resourceTypes) === '["main_frame"]'));
  const action = url => network.filter(rule => new RegExp(rule.condition.regexFilter, 'i').test(url))
    .sort((a, b) => b.priority - a.priority)[0]?.action.type;
  assert.equal(action('https://www.bilibili.com/'), 'block');
  assert.equal(action('https://m.bilibili.com/index.html?tracking=1'), 'block');
  assert.equal(action('https://search.bilibili.com/all?keyword=资料'), undefined);
  assert.equal(action('https://www.bilibili.com/video/BV1test'), undefined);
  assert.equal(action('https://www.douyin.com/jingxuan/search/资料'), undefined);
  assert.equal(action('https://www.douyin.com/?modal_id=123456'), 'allow');
  assert.equal(action('https://www.douyin.com/?modal_id=invalid'), 'block');
  assert.equal(action('https://www.example.com/'), 'block');
  assert.equal(action('https://www.example.com/?q=资料'), 'allow');
  assert.equal(action('https://bilibili.com.evil.example/'), undefined);
  const allowed = Array.from(api.createHomepageNetworkRules({ 'bilibili.com': { allowHomepage: true } }, 1));
  assert.ok(allowed.every(rule => !new RegExp(rule.condition.regexFilter, 'i').test('https://www.bilibili.com/')));
});

test('new homepage permission releases an existing homepage gate without overriding explicit rules', () => {
  const clear = loadFunction('extension/content/blocking-controller.js', 'shouldClearPersistentPageGate');
  const gate = { kind: 'url', value: 'bilibili.com/', pageSource: 'homepage', pageViewKey: 'same-view' };
  assert.equal(clear(gate, 'same-view', null, false, false), true);
  assert.equal(clear(gate, 'same-view', gate, false, false), false);
  assert.equal(clear({ ...gate, pageSource: 'url' }, 'same-view', null, false, false), false);
});

test('background rejects a denied homepage even when keyword blocking is off', async () => {
  let policy = { 'bilibili.com': { allowHomepage: false } };
  let created = 0;
  const source = read('extension/background/ua-controller.js');
  const start = source.indexOf('async function openSearchResultBG(');
  const end = source.indexOf('\nasync function getSearchSessionContextBG', start);
  const open = vm.runInNewContext(`(${source.slice(start, end).trim()})`, {
    URL, MySearchBlockingRules: api,
    getBlockingEnabledBG: async () => false,
    getUARulesBG: async () => policy,
    chrome: { tabs: { create: async () => { created++; return { id: 5 }; } } },
  });
  const blocked = await open({ tab: { id: 1 } }, '资料', 'https://www.bilibili.com/');
  assert.equal(blocked.blocked, true);
  assert.equal(created, 0);
  assert.equal((await open({ tab: { id: 1 } }, '资料', 'https://search.bilibili.com/all?keyword=资料')).opened, true);
  policy = { 'bilibili.com': { allowHomepage: true } };
  assert.equal((await open({ tab: { id: 1 } }, '', 'https://www.bilibili.com/')).opened, true);
  assert.equal(created, 2);
});

test('explicit social-platform homepage permissions do not accept fake keyword parameters or feed aliases', () => {
  const policy = { 'youtube.com': { allowHomepage: false }, 'xiaohongshu.com': { allowHomepage: false } };
  assert.equal(api.findBlockedHomepage('https://www.youtube.com/?search_query=资料', [], policy), 'youtube.com/');
  assert.equal(api.findBlockedHomepage('https://www.youtube.com/results?search_query=资料', [], policy), null);
  assert.equal(api.findBlockedHomepage('https://www.xiaohongshu.com/explore', [], policy), 'xiaohongshu.com/explore');
  assert.equal(api.findBlockedHomepage('https://www.xiaohongshu.com/explore/abc123', [], policy), null);
  assert.equal(api.findBlockedHomepage('https://www.xiaohongshu.com/search_result?keyword=资料', [], policy), null);
  const rules = Array.from(api.createHomepageNetworkRules(policy, 1));
  const block = url => rules.some(rule => rule.action.type === 'block' && new RegExp(rule.condition.regexFilter).test(url));
  assert.equal(block('https://www.xiaohongshu.com/explore/'), true);
  assert.equal(block('https://www.xiaohongshu.com/explore/abc123'), false);
});

test('releasing homepage permission reloads only that homepage, including blocked pending URLs', async () => {
  const reloaded = [];
  const restore = loadFunction('extension/background/ua-controller.js', 'restoreHomepageTabsBG', {
    MySearchBlockingRules: api, console,
    chrome: { tabs: {
      query: async () => [
        { id: 1, url: 'https://www.bilibili.com/' },
        { id: 2, url: 'chrome-error://chromewebdata/', pendingUrl: 'https://www.bilibili.com/?tracking=1' },
        { id: 3, url: 'https://search.bilibili.com/all?keyword=资料' },
        { id: 4, url: 'https://www.bilibili.com/video/BV1test' },
        { id: 5, url: 'https://www.douyin.com/' },
        { id: 6, url: 'https://www.bilibili.com/', discarded: true },
      ],
      reload: async id => { reloaded.push(id); },
    } },
  });
  await restore('bilibili.com', { allowHomepage: false });
  assert.deepEqual(reloaded, [1, 2]);
});

test('dynamic network updates are serial, reject failures, and permit a subsequent retry', async () => {
  let active = 0;
  let maxActive = 0;
  let fail = false;
  const applied = [];
  const apply = loadFunction('extension/background/ua-controller.js', 'applyDynamicRules', {
    dynamicRuleUpdatesBG: Promise.resolve(), console: { log() {}, error() {} },
    buildDynamicRules: rules => rules,
    chrome: { declarativeNetRequest: {
      getDynamicRules: async () => [],
      updateDynamicRules: async ({ addRules }) => {
        active++; maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 10));
        active--;
        if (fail) throw new Error('network update rejected');
        applied.push(addRules[0].id);
      },
    } },
  });
  const rule = id => [{ id, action: { type: 'block' }, condition: { regexFilter: 'test' } }];
  await Promise.all([apply(rule(1), false), apply(rule(2), false)]);
  assert.equal(maxActive, 1);
  assert.deepEqual(applied, [1, 2]);
  fail = true;
  await assert.rejects(apply(rule(3), false), /network update rejected/);
  fail = false;
  await apply(rule(4), false);
  assert.deepEqual(applied, [1, 2, 4]);
});

test('failed homepage release restores saved permission and never acknowledges success', async () => {
  const previous = { enabled: false, uaMode: 'custom', customUA: 'keep', allowHomepage: false };
  let stored = { 'bilibili.com': { ...previous } };
  let updates = 0;
  let restores = 0;
  const handle = loadFunction('extension/background/ua-controller.js', 'handleMessage', {
    MySearchBlockingRules: api, console: { log() {}, error() {} },
    STORAGE_KEYS_BG: { UA_RULES: 'uaRules' }, LIVE_RULE_FIELDS_BG: [],
    getUARulesBG: async () => JSON.parse(JSON.stringify(stored)),
    getGlobalEnabledBG: async () => false,
    applyDynamicRules: async () => { if (++updates === 1) throw new Error('cannot remove homepage block'); },
    restoreHomepageTabsBG: async () => { restores++; },
    chrome: { storage: { local: { set: async update => { stored = update.uaRules; } } } },
  });
  let response;
  await handle({ type: 'UPDATE_RULE', domain: 'bilibili.com', rule: { allowHomepage: true } }, {}, value => { response = value; });
  assert.equal(response.error, 'cannot remove homepage block');
  assert.notEqual(response.success, true);
  assert.deepEqual(JSON.parse(JSON.stringify(stored['bilibili.com'])), previous);
  assert.equal(restores, 0);
  assert.equal(updates, 2, 'previous network rules are reapplied after rollback');
});

for (const keyword of ['picot', '资料检索', '冷压端子']) {
  for (const searchPath of ['/search_result', '/search_result/']) {
    test(`TC-REG-HOME-004 XHS search is independent of homepage permission: ${searchPath} ${keyword}`, () => {
      const search = `https://www.xiaohongshu.com${searchPath}?keyword=${encodeURIComponent(keyword)}&type=51`;
      for (const allowed of [false, true]) {
        const policy = { 'xiaohongshu.com': { enabled: false, allowHomepage: allowed } };
        assert.equal(api.findBlockedHomepage(search, [], policy), null);
        assert.equal(api.findBlockedHomepage('https://www.xiaohongshu.com/explore/abc123', [], policy), null);
        assert.equal(Boolean(api.findBlockedHomepage('https://www.xiaohongshu.com/explore', [], policy)), !allowed);
        const network = Array.from(api.createHomepageNetworkRules(policy, 1));
        const matches = network.filter(rule => new RegExp(rule.condition.regexFilter, 'i').test(search));
        assert.equal(matches.some(rule => rule.action.type === 'block'), false, 'DNR must not block either real search path');
        const match = loadFunction('extension/background/ua-controller.js', 'findBlockingSearchMatchBG', {
          URL, MySearchBlockingRules: api,
        });
        assert.equal(match(keyword, search, { ...emptyRules, homepageRules: policy }), null,
          'the navigation search-opening handler must agree with URL and DNR classification');
      }
    });
  }
}

test('TC-REG-HOME-005 XHS release restores homepage error tabs without refreshing search, detail or collection tabs', async () => {
  const reloaded = [];
  const restore = loadFunction('extension/background/ua-controller.js', 'restoreHomepageTabsBG', {
    MySearchBlockingRules: api, console,
    chrome: { tabs: {
      query: async () => [
        { id: 1, url: 'https://www.xiaohongshu.com/explore' },
        { id: 2, url: 'chrome-error://chromewebdata/', pendingUrl: 'https://www.xiaohongshu.com/explore?channel_id=homefeed_recommend' },
        { id: 3, url: 'https://www.xiaohongshu.com/search_result/?keyword=picot&type=51' },
        { id: 4, url: 'https://www.xiaohongshu.com/explore/abc123' },
        { id: 5, url: 'https://www.xiaohongshu.com/user/profile/self' },
        { id: 6, url: 'https://www.douyin.com/' },
        { id: 7, url: 'https://www.xiaohongshu.com/explore', discarded: true },
      ],
      reload: async id => { reloaded.push(id); },
    } },
  });
  await restore('xiaohongshu.com', { allowHomepage: false });
  assert.deepEqual(reloaded, [1, 2]);
});
