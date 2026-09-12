const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function loadNamedFunction(relativePath, functionName, globals = {}) {
  const source = read(relativePath);
  const functionStart = source.indexOf(`function ${functionName}(`);
  const asyncPrefixStart = functionStart - 'async '.length;
  const start = asyncPrefixStart >= 0 &&
    source.slice(asyncPrefixStart, functionStart) === 'async '
    ? asyncPrefixStart
    : functionStart;
  assert.notEqual(start, -1, `${functionName} must exist`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) {
      end = index + 1;
      break;
    }
  }
  assert.notEqual(end, -1, `${functionName} must be complete`);
  return vm.runInNewContext(
    `(${source.slice(start, end)})`,
    globals
  );
}

function loadRules() {
  const context = vm.createContext({});
  context.globalThis = context;
  vm.runInContext(
    read('extension/shared/blocking-rules.js'),
    context,
    { filename: 'blocking-rules.js' }
  );
  return context.MySearchBlockingRules;
}

test('manifest loads blocking modules and preserves media controller', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.ok(manifest.host_permissions.includes('<all_urls>'));

  const mainHook = manifest.content_scripts.find(entry =>
    entry.world === 'MAIN' &&
    entry.js?.includes('content/blocking-page-hook.js')
  );
  assert.ok(mainHook);
  assert.deepEqual(mainHook.matches, ['<all_urls>']);
  assert.equal(mainHook.run_at, 'document_start');

  const controller = manifest.content_scripts.find(entry =>
    entry.js?.includes('content/blocking-controller.js')
  );
  assert.ok(controller);
  assert.deepEqual(controller.js, [
    'shared/blocking-rules.js',
    'content/blocking-controller.js',
  ]);

  assert.ok(manifest.content_scripts.some(entry =>
    entry.js?.includes('content/search-media-controller.js')
  ));
});

test('three rule collections remain independent and append-only', () => {
  const api = loadRules();
  const rules = api.normalizeRules({
    blockedKeywords: [' 赌博 ', '赌博', '', null],
    blockedUrlPatterns: ['casino.example/path'],
    highRiskDomains: ['risk.example'],
  });

  assert.deepEqual(Array.from(rules.blockedKeywords), ['赌博']);
  assert.deepEqual(
    Array.from(rules.blockedUrlPatterns),
    ['casino.example/path']
  );
  assert.deepEqual(Array.from(rules.highRiskDomains), ['risk.example']);
  assert.deepEqual(
    Array.from(api.appendUnique(rules.blockedKeywords, '赌博')),
    ['赌博']
  );
  assert.deepEqual(
    Array.from(api.appendUnique(rules.blockedKeywords, '博彩')),
    ['赌博', '博彩']
  );
  assert.deepEqual(
    Array.from(rules.blockedUrlPatterns),
    ['casino.example/path']
  );
});

test('keyword and URL matching are literal and independent', () => {
  const api = loadRules();
  assert.equal(api.findKeyword('需要阻断的赌博内容', ['赌博']), '赌博');
  assert.equal(api.findKeyword('普通内容', ['赌博']), null);
  assert.equal(
    api.findUrlPattern(
      'https://casino.example/path?id=1',
      ['casino.example/path']
    ),
    'casino.example/path'
  );
  assert.equal(api.findUrlPattern('https://safe.example/', ['赌博']), null);
});

test('unknown ADD_BLOCKING_RULE response falls back to append-only storage', async () => {
  const api = loadRules();
  const stored = {
    blockedKeywords: ['已有关键词'],
    blockedUrlPatterns: ['existing.example'],
    highRiskDomains: ['risk.example'],
  };
  const storageArea = {
    async get() {
      return { ...stored };
    },
    async set(update) {
      Object.assign(stored, update);
    },
  };

  assert.equal(
    api.isUnknownAddRuleResponse({
      error: 'Unknown message type: ADD_BLOCKING_RULE',
    }),
    true
  );
  assert.equal(
    api.isUnknownAddRuleResponse({ error: '阻断规则保存失败' }),
    false
  );

  await api.addRuleToStorage('新增规则', 'both', storageArea);
  await api.addRuleToStorage('新增规则', 'both', storageArea);

  assert.deepEqual(
    Array.from(stored.blockedKeywords),
    ['已有关键词', '新增规则']
  );
  assert.deepEqual(
    Array.from(stored.blockedUrlPatterns),
    ['existing.example', '新增规则']
  );
  assert.deepEqual(Array.from(stored.highRiskDomains), ['risk.example']);
});

test('unknown rule read and import messages use shared append-only storage', async () => {
  const api = loadRules();
  const stored = {
    blockedKeywords: ['已有关键词'],
    blockedUrlPatterns: ['existing.example'],
    highRiskDomains: ['risk.example'],
  };
  const storageArea = {
    async get() {
      return { ...stored };
    },
    async set(update) {
      Object.assign(stored, update);
    },
  };

  assert.equal(api.isUnknownMessageResponse({
    error: 'Unknown message type: GET_BLOCKING_RULES',
  }, 'GET_BLOCKING_RULES'), true);
  assert.equal(api.isUnknownMessageResponse({
    error: 'Unknown message type: ADD_BLOCKING_RULE',
  }, 'GET_BLOCKING_RULES'), false);

  const initial = await api.getRulesFromStorage(storageArea);
  assert.deepEqual(
    Array.from(initial.blockedKeywords),
    ['已有关键词']
  );

  await api.importPolicyToStorage({
    schemaVersion: 1,
    blockedKeywords: [' 新增甲 ', '新增乙', '新增甲'],
  }, storageArea);
  await api.importPolicyToStorage({
    schemaVersion: 1,
    blockedKeywords: ['新增乙'],
  }, storageArea);

  assert.deepEqual(
    Array.from(stored.blockedKeywords),
    ['已有关键词', '新增甲', '新增乙']
  );
  assert.deepEqual(
    Array.from(stored.blockedUrlPatterns),
    ['existing.example']
  );
  assert.deepEqual(
    Array.from(stored.highRiskDomains),
    ['risk.example']
  );
});

test('background exposes append-only rules and statistics routes', () => {
  const source = read('extension/background/ua-controller.js');
  for (const type of [
    'GET_BLOCKING_RULES',
    'ADD_BLOCKING_RULE',
    'RECORD_BLOCKING_EVENT',
    'UPDATE_FEEDBACK_OUTCOME',
    'GET_BLOCKING_STATS',
    'IMPORT_BLOCKING_POLICY',
    'EXPORT_BLOCKING_POLICY',
    'RECONNECT_SEARCH_MEDIA_TABS',
  ]) {
    assert.match(source, new RegExp(`case ['"]${type}['"]`));
  }
  assert.doesNotMatch(
    source,
    /DELETE_BLOCKING_RULE|REMOVE_BLOCKING_RULE/
  );
  assert.match(
    source,
    /if \(!\['keyword', 'url', 'both'\]\.includes\(scope\)\)/
  );
});

test('settings lists all blocked keywords and batch additions remain append-only', () => {
  const options = read('extension/options/options.html');
  const dashboard = read('extension/options/blocking-dashboard.js');
  const parseBatch = loadNamedFunction(
    'extension/options/blocking-dashboard.js',
    'parseBlockingKeywordBatch',
    { Array, Set, String }
  );

  assert.match(options, /id="blocking-keywords-batch"/);
  assert.match(options, /id="blocking-keywords-add"/);
  assert.match(options, /id="blocking-keyword-list"/);
  assert.match(options, /\.\.\/shared\/blocking-rules\.js/);
  assert.deepEqual(
    Array.from(parseBatch(' 赌博 \n博彩\n赌博\n\n')),
    ['赌博', '博彩']
  );
  assert.match(dashboard, /type: 'GET_BLOCKING_RULES'/);
  assert.match(dashboard, /getRulesFromStorage\(\)/);
  assert.match(dashboard, /renderBlockingKeywords\(response\.rules\)/);
  assert.match(dashboard, /type: 'IMPORT_BLOCKING_POLICY'/);
  assert.match(dashboard, /importPolicyToStorage\(policy\)/);
  assert.match(dashboard, /blockedKeywords: keywords/);
  assert.doesNotMatch(
    dashboard,
    /DELETE_BLOCKING_RULE|REMOVE_BLOCKING_RULE/
  );
});

test('main-page searches are blocked before opening and create sessions when allowed', () => {
  const mainPage = read('mysearch.html');
  const controller = read('extension/content/blocking-controller.js');
  const background = read('extension/background/ua-controller.js');
  const findMatch = loadNamedFunction(
    'extension/background/ua-controller.js',
    'findBlockingSearchMatchBG'
  );
  const rules = {
    blockedKeywords: ['赌博'],
    blockedUrlPatterns: ['blocked.example'],
  };

  const keywordMatch = findMatch(
    '搜索赌博内容',
    'https://www.douyin.com/search/test',
    rules
  );
  assert.equal(keywordMatch.kind, 'keyword');
  assert.equal(keywordMatch.value, '赌博');

  const urlMatch = findMatch(
    '普通内容',
    'https://blocked.example/search',
    rules
  );
  assert.equal(urlMatch.kind, 'url');
  assert.equal(urlMatch.value, 'blocked.example');
  assert.equal(
    findMatch(
      '普通内容',
      'https://www.douyin.com/search/test',
      rules
    ),
    null
  );

  assert.match(mainPage, /MYSEARCH_SEARCH_OPEN_REQUEST/);
  assert.match(mainPage, /MYSEARCH_SEARCH_OPEN_RESPONSE/);
  assert.match(mainPage, /openSearchResultThroughExtension/);
  assert.doesNotMatch(mainPage, /window\.open\(url, '_blank'\)/);
  assert.match(controller, /function handleSearchOpenRequest/);
  assert.match(controller, /event\.source !== global/);
  assert.match(controller, /event\.origin !== global\.location\?\.origin/);
  assert.match(controller, /isMySearchPage\(\)/);
  assert.match(controller, /type: 'OPEN_SEARCH_RESULT'/);
  assert.match(background, /case 'OPEN_SEARCH_RESULT'/);
  assert.match(
    background,
    /startSearchSessionBG\(sender, parsedUrl\.href\)/
  );
  assert.match(background, /chrome\.tabs\.create\(\{/);
  assert.match(background, /openerTabId/);
});

test('extension new-tab search uses the checked background open path without a bypass', () => {
  const navigation = read('extension/navigation/navigation.js');
  const openSearchResult = loadNamedFunction(
    'extension/navigation/navigation.js',
    'openSearchResult',
    {}
  ).toString();

  assert.match(openSearchResult, /type: 'OPEN_SEARCH_RESULT'/);
  assert.match(openSearchResult, /keyword,/);
  assert.match(openSearchResult, /targetUrl: url/);
  assert.match(openSearchResult, /response\.blocked/);
  assert.match(openSearchResult, /response\.match/);
  assert.match(openSearchResult, /插件响应超时，未打开搜索页/);
  assert.doesNotMatch(openSearchResult, /window\.open/);
  assert.doesNotMatch(openSearchResult, /START_SEARCH_SESSION/);
  assert.match(
    openSearchResult,
    /isUnknownMessageResponse[\s\S]*OPEN_SEARCH_RESULT/
  );
  assert.match(
    openSearchResult,
    /openSearchResultWithLegacyBackground/
  );
  assert.match(navigation, /function openSearchResult\(url\)/);
});

test('legacy OPEN_SEARCH_RESULT fallback blocks only stored matches', async () => {
  const storageRules = {
    blockedKeywords: ['赌博'],
    blockedUrlPatterns: ['blocked.example'],
    highRiskDomains: ['douyin.com'],
  };
  const createdTabs = [];
  const sessionMessages = [];
  const rulesApi = {
    async getRulesFromStorage() {
      return storageRules;
    },
    findKeyword(text, keywords) {
      return keywords.find(value => text.includes(value)) || null;
    },
    findUrlPattern(url, patterns) {
      return patterns.find(value => url.includes(value)) || null;
    },
  };
  const legacyOpen = loadNamedFunction(
    'extension/navigation/navigation.js',
    'openSearchResultWithLegacyBackground',
    {
      MySearchBlockingRules: rulesApi,
      Number,
      Promise,
      chrome: {
        runtime: {
          lastError: null,
          sendMessage(message, callback) {
            sessionMessages.push(message);
            callback({
              success: true,
              enabled: true,
              sessionId: 'legacy-session',
            });
          },
        },
        tabs: {
          async getCurrent() {
            return { id: 17 };
          },
          async create(properties) {
            createdTabs.push(properties);
            return { id: 18 };
          },
        },
      },
    }
  );

  const keywordBlocked = await legacyOpen(
    '搜索赌博内容',
    'https://www.douyin.com/search/test'
  );
  assert.equal(keywordBlocked.blocked, true);
  assert.equal(keywordBlocked.match.kind, 'keyword');

  const urlBlocked = await legacyOpen(
    '普通内容',
    'https://blocked.example/search'
  );
  assert.equal(urlBlocked.blocked, true);
  assert.equal(urlBlocked.match.kind, 'url');
  assert.equal(createdTabs.length, 0);
  assert.equal(sessionMessages.length, 0);

  const allowed = await legacyOpen(
    '普通内容',
    'https://www.douyin.com/search/test'
  );
  assert.equal(allowed.blocked, false);
  assert.equal(allowed.opened, true);
  assert.equal(allowed.sessionEnabled, true);
  assert.deepEqual(sessionMessages.map(message => ({
    type: String(message.type),
    targetUrl: String(message.targetUrl),
  })), [{
    type: 'START_SEARCH_SESSION',
    targetUrl: 'https://www.douyin.com/search/test',
  }]);
  assert.deepEqual(createdTabs.map(properties => ({
    url: String(properties.url),
    active: properties.active,
    openerTabId: properties.openerTabId,
  })), [{
    url: 'https://www.douyin.com/search/test',
    active: true,
    openerTabId: 17,
  }]);
});

test('supported high-risk sites are restored when existing storage omitted them', async () => {
  const source = read('extension/background/ua-controller.js');

  assert.match(source, /const DEFAULT_HIGH_RISK_DOMAINS_BG/);
  for (const domain of [
    'xiaohongshu.com',
    'douyin.com',
    'bilibili.com',
    'youtube.com',
  ]) {
    assert.match(
      source,
      new RegExp(domain.replace('.', '\\.'))
    );
  }
  assert.match(
    source,
    /\.\.\.DEFAULT_HIGH_RISK_DOMAINS_BG,\s*\.\.\.storedHighRiskDomains/
  );
  assert.match(
    source,
    /\[BLOCKING_STORAGE_KEYS_BG\.HIGH_RISK_DOMAINS\]:\s*highRiskDomains/
  );
});

test('first blocked search creates neither SearchSession nor tab', async () => {
  let rules = {
    blockedKeywords: ['赌博'],
    blockedUrlPatterns: [],
  };
  let sessionStarts = 0;
  let tabCreates = 0;
  const openSearchResult = loadNamedFunction(
    'extension/background/ua-controller.js',
    'openSearchResultBG',
    {
      String,
      Number,
      URL,
      Error,
      async getBlockingRulesBG() {
        return rules;
      },
      findBlockingSearchMatchBG(keyword, targetUrl, currentRules) {
        for (const value of currentRules.blockedKeywords || []) {
          if (value && keyword.includes(value)) {
            return { kind: 'keyword', value };
          }
        }
        for (const value of currentRules.blockedUrlPatterns || []) {
          if (value && targetUrl.includes(value)) {
            return { kind: 'url', value };
          }
        }
        return null;
      },
      async startSearchSessionBG() {
        sessionStarts += 1;
        return { enabled: true, sessionId: 'session-1' };
      },
      chrome: {
        tabs: {
          async create() {
            tabCreates += 1;
            return { id: 22 };
          },
        },
      },
    }
  );

  const blocked = await openSearchResult(
    { tab: { id: 10 } },
    '首次搜索赌博内容',
    'https://www.douyin.com/search/test'
  );
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.opened, false);
  assert.equal(sessionStarts, 0);
  assert.equal(tabCreates, 0);

  rules = {
    blockedKeywords: [],
    blockedUrlPatterns: [],
  };
  const allowed = await openSearchResult(
    { tab: { id: 10 } },
    '普通内容',
    'https://www.douyin.com/search/test'
  );
  assert.equal(allowed.blocked, false);
  assert.equal(allowed.opened, true);
  assert.equal(sessionStarts, 1);
  assert.equal(tabCreates, 1);
});

test('Douyin adapter blocks a keyword matched on the complete result card', () => {
  const controller = read('extension/content/blocking-controller.js');
  assert.match(controller, /adapter\?\.candidates\?\.join\(','\)/);
  assert.match(controller, /target\.closest\?\.\(adapterSelector\)/);
  assert.match(
    controller,
    /textForElement\(adapterCard\),\s*rules\.blockedKeywords/
  );
  assert.match(
    controller,
    /kind: 'keyword',\s*value: keyword,\s*element: adapterCard/
  );
});

test('policy dashboard and old-tab takeover remain in the existing extension', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const policy = JSON.parse(
    read('extension/policies/blocking-policy.template.json')
  );
  const background = read('extension/background/ua-controller.js');
  const options = read('extension/options/options.html');
  const dashboard = read('extension/options/blocking-dashboard.js');
  const mediaController =
    read('extension/content/search-media-controller.js');

  assert.equal(policy.schemaVersion, 1);
  assert.deepEqual(policy.highRiskDomains, [
    'xiaohongshu.com',
    'douyin.com',
    'bilibili.com',
    'youtube.com',
  ]);
  assert.ok(manifest.permissions.includes('tabs'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.match(background, /chrome\.runtime\?\.onInstalled/);
  assert.match(background, /reconnectSearchMediaTabsBG/);
  assert.match(background, /SEARCH_MEDIA_SCRIPT_FILES_BG/);
  assert.match(options, /id="blocking-stats-periods"/);
  assert.match(options, /id="blocking-feedback-stats"/);
  assert.match(options, /id="search-media-diagnostics"/);
  assert.match(options, /src="blocking-dashboard\.js"/);
  assert.match(dashboard, /type: 'GET_BLOCKING_STATS'/);
  assert.match(dashboard, /type: 'IMPORT_BLOCKING_POLICY'/);
  assert.match(dashboard, /type: 'EXPORT_BLOCKING_POLICY'/);
  assert.match(dashboard, /RECONNECT_SEARCH_MEDIA_TABS/);
  assert.match(dashboard, /diagnostics\/search-media-probe\.html/);
  assert.match(mediaController, /STYLE_LEDGER_ATTR/);
  assert.match(mediaController, /PLAYER_LEDGER_ATTR/);
  assert.match(mediaController, /recoverOrphanedOverrides/);
  assert.match(mediaController, /__mySearchMediaControllerActive/);
});

test('main page places the only blocking-rule UI beside settings', () => {
  const mainPage = read('mysearch.html');
  const navigationHtml = read('extension/navigation/navigation.html');
  const navigationSource = read('extension/navigation/navigation.js');
  const navigationCss = read('extension/navigation/navigation.css');

  assert.equal((mainPage.match(/id="search-input"/g) || []).length, 1);
  assert.match(
    mainPage,
    /settingsBtn\.insertAdjacentElement\('afterend', blockingRuleControls\)/
  );
  assert.match(mainPage, /name="blocking-rule-scope"/);
  assert.match(mainPage, /value="keyword" checked/);
  assert.match(mainPage, /value="url"/);
  assert.match(mainPage, /value="both"/);
  assert.match(mainPage, /id="add-blocking-rule"/);
  assert.match(mainPage, /const value = searchInput\.value\.trim\(\)/);
  assert.match(mainPage, /type: 'MYSEARCH_BLOCKING_RULE_REQUEST'/);
  assert.match(mainPage, /window\.setTimeout\(\(\) =>/);
  assert.match(mainPage, /event\.source !== window/);
  assert.match(mainPage, /event\.origin !== expectedOrigin/);

  assert.equal(
    (navigationHtml.match(/id="search-input"/g) || []).length,
    1
  );
  assert.doesNotMatch(navigationHtml, /id="blocking-rule-scope"/);
  assert.doesNotMatch(navigationHtml, /<select[^>]*blocking-rule/);
});

test('extension new tab adds radio rules beside settings using its existing search input', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const html = read('extension/navigation/navigation.html');
  const source = read('extension/navigation/navigation.js');
  const css = read('extension/navigation/navigation.css');

  assert.equal(
    manifest.chrome_url_overrides?.newtab,
    'navigation/navigation.html'
  );
  assert.equal((html.match(/id="search-input"/g) || []).length, 1);
  assert.doesNotMatch(html, /<select[^>]*blocking-rule/);

  assert.match(
    source,
    /settingsBtn\.insertAdjacentElement\('afterend', blockingRuleControls\)/
  );
  assert.match(source, /name="blocking-rule-scope"/);
  assert.match(source, /value="keyword" checked/);
  assert.match(source, /value="url"/);
  assert.match(source, /value="both"/);
  assert.match(source, /id="add-blocking-rule"/);
  assert.match(source, /const value = searchInput\.value\.trim\(\)/);
  assert.match(source, /type: 'ADD_BLOCKING_RULE'/);
  assert.match(source, /value,\s*scope,/);
  assert.match(source, /chrome\.runtime\.sendMessage/);
  assert.match(source, /chrome\.runtime\.lastError/);
  assert.match(source, /setTimeout\(\(\) =>/);
  assert.match(html, /\.\.\/shared\/blocking-rules\.js/);
  assert.match(source, /isUnknownAddRuleResponse\(response\)/);
  assert.match(source, /addRuleToStorage\(value, scope\)/);
  assert.match(source, /response\?\.error \|\| '阻断规则保存失败'/);
  assert.doesNotMatch(
    source,
    /MYSEARCH_BLOCKING_RULE_REQUEST/
  );

  assert.match(css, /\.blocking-rule-inline-controls/);
  assert.match(css, /#blocking-rule-status\[data-state="error"\]/);
});

test('content script securely bridges rule requests to the existing protocol', () => {
  const controller = read('extension/content/blocking-controller.js');

  assert.match(controller, /MYSEARCH_BLOCKING_RULE_REQUEST/);
  assert.match(controller, /MYSEARCH_BLOCKING_RULE_RESPONSE/);
  assert.match(controller, /event\.source !== global/);
  assert.match(controller, /event\.origin !== global\.location\?\.origin/);
  assert.match(controller, /RULE_SCOPES\.has\(scope\)/);
  assert.match(controller, /value\.length > MAX_RULE_LENGTH/);
  assert.match(controller, /type: 'ADD_BLOCKING_RULE'/);
  assert.match(controller, /value,\s*scope,/);
  assert.match(controller, /isUnknownAddRuleResponse\(response\)/);
  assert.match(controller, /addRuleToStorage\(value, scope\)/);
  assert.match(
    controller,
    /isUnknownMessageResponse\(\s*response,\s*'OPEN_SEARCH_RESULT'/
  );
  assert.match(
    controller,
    /openSearchResultWithLegacyBackground/
  );
  assert.match(
    controller,
    /global\.addEventListener\('message', handleBlockingRuleRequest, false\)/
  );
});

test('controller covers dynamic attributes and navigation boundaries', () => {
  const controller = read('extension/content/blocking-controller.js');
  const hook = read('extension/content/blocking-page-hook.js');

  assert.match(controller, /new global\.MutationObserver/);
  assert.match(controller, /characterData: true/);
  assert.match(controller, /attributes: true/);
  for (const attribute of [
    'href',
    'data-href',
    'data-url',
    'title',
    'aria-label',
    'src',
  ]) {
    assert.match(controller, new RegExp(`['"]${attribute}['"]`));
  }
  assert.match(controller, /\['click', 'auxclick', 'keydown'\]/);
  assert.match(controller, /DEDUPLICATION_WINDOW_MS = 2000/);
  assert.match(controller, /RECORD_BLOCKING_EVENT/);
  assert.match(controller, /filter: blur\(6px\) grayscale\(1\)/);
  assert.match(controller, /typeof global\.Element === 'function'/);
  assert.doesNotMatch(controller, /instanceof Element/);

  assert.match(hook, /global\.open = function guardedOpen/);
  assert.match(hook, /\['pushState', 'replaceState'\]/);
  assert.match(hook, /mediaPrototype\.play = function guardedPlay/);
  assert.match(hook, /event\.defaultPrevented/);
  assert.match(
    controller,
    /function handleMediaAttempt\(event\) \{[\s\S]*currentPageContentId\(\)[\s\S]*depth3Match\(contentId\)[\s\S]*rejectCommittedDepth3\(contentId\)/
  );
});

test('high-risk navigation has persistent sessions and explicit adapters only', () => {
  const background = read('extension/background/ua-controller.js');
  const controller = read('extension/content/blocking-controller.js');
  const hook = read('extension/content/blocking-page-hook.js');
  const navigation = read('extension/navigation/navigation.js');

  assert.match(
    background,
    /SEARCH_SESSION_BUDGET_MS_BG = 40 \* 60 \* 1000/
  );
  assert.match(background, /chrome\.storage\.session/);
  assert.match(background, /chrome\.tabs\.onCreated\.addListener/);
  assert.match(background, /tab\.openerTabId/);
  assert.match(background, /foregroundTabIds/);
  assert.match(background, /attemptedDepth3Navigation/);
  for (const domain of [
    'xiaohongshu.com',
    'douyin.com',
    'bilibili.com',
    'youtube.com',
  ]) {
    assert.match(background, new RegExp(domain.replace('.', '\\.')));
  }

  assert.match(controller, /const DEPTH_ADAPTERS =/);
  assert.match(controller, /data-note-id/);
  assert.match(controller, /data-aweme-id/);
  assert.match(controller, /data-bvid/);
  assert.match(controller, /a\[href\*="\/watch\?"\]/);
  assert.match(controller, /function depth3Match/);
  const isDepth3 = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'isDepth3ContentTransition',
    { Boolean }
  );
  assert.equal(isDepth3({
    enabled: true,
    depth: 2,
    contentId: 'douyin:100',
  }, 'douyin:200'), true);
  assert.equal(isDepth3({
    enabled: true,
    depth: 2,
    contentId: 'douyin:100',
  }, 'douyin:100'), false);
  const shouldRestoreUrl = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'shouldRestoreCommittedDepth3Url',
    { Boolean }
  );
  assert.equal(shouldRestoreUrl(
    'douyin:200',
    'douyin:200',
    'https://www.douyin.com/video/100',
    'https://www.douyin.com/video/200'
  ), true);
  assert.equal(shouldRestoreUrl(
    '',
    'douyin:200',
    'https://www.douyin.com/video/100',
    'https://www.douyin.com/search/test'
  ), false);
  assert.equal(shouldRestoreUrl(
    'douyin:100',
    'douyin:200',
    'https://www.douyin.com/video/100',
    'https://www.douyin.com/video/100'
  ), false);
  assert.match(controller, /function rejectCommittedDepth3/);
  assert.match(controller, /DEPTH3_REJECTED_ATTR/);
  assert.match(controller, /global\.location\.replace\(allowedUrl\)/);
  assert.match(controller, /node\.style\?\.setProperty/);
  assert.match(controller, /pendingContentUrl/);
  assert.match(background, /pendingContentUrl/);
  assert.match(controller, /function synchronizeDepthFromPage/);
  assert.match(controller, /type: 'attemptedDepth3Navigation'/);
  assert.match(controller, /DEPTH2_HIDDEN_ATTR/);
  assert.match(controller, /NAVIGATION_DEPTH_ATTR/);
  for (const selectorEvidence of [
    'recommend-container',
    'video-detail-recommend',
    'reco_list',
    'watch-next-secondary-results-renderer',
  ]) {
    assert.match(controller, new RegExp(selectorEvidence));
  }
  assert.match(
    controller,
    /if \(mutation\.removedNodes\?\.length\) \{\s*scheduleNode\(mutation\.target\)/
  );
  assert.match(
    controller,
    /global\.document\?\.visibilityState === 'hidden'/
  );
  assert.match(
    controller,
    /typeof global\.document\?\.hasFocus === 'function'/
  );
  assert.match(
    controller,
    /global\.addEventListener\('focus', reportSearchSessionForeground, true\)/
  );
  assert.match(
    controller,
    /global\.addEventListener\('blur', reportSearchSessionForeground, true\)/
  );
  assert.doesNotMatch(
    controller,
    /genericContentId|heuristicContentId/
  );

  assert.match(hook, /navigationKind/);
  assert.match(navigation, /type: 'OPEN_SEARCH_RESULT'/);
  assert.match(navigation, /openSearchResult\(url\)/);
  assert.doesNotMatch(
    loadNamedFunction(
      'extension/navigation/navigation.js',
      'openSearchResult',
      {}
    ).toString(),
    /window\.open/
  );
});

test('blocking controller tolerates a non-page document without DOM construction APIs', async () => {
  const messages = [];
  const context = vm.createContext({
    URL,
    Date,
    Math,
    Promise,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    location: {
      href: 'https://example.test/',
      hostname: 'example.test',
    },
    document: {
      title: '',
      readyState: 'complete',
    },
    crypto: {
      randomUUID() {
        return 'phase1-fake-document';
      },
    },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          messages.push(message);
          callback?.({
            success: true,
            rules: {
              blockedKeywords: [],
              blockedUrlPatterns: [],
              highRiskDomains: [],
            },
          });
        },
      },
      storage: {
        onChanged: {
          addListener() {},
        },
      },
    },
  });
  context.globalThis = context;

  vm.runInContext(
    read('extension/shared/blocking-rules.js'),
    context,
    { filename: 'extension/shared/blocking-rules.js' }
  );
  assert.doesNotThrow(() => vm.runInContext(
    read('extension/content/blocking-controller.js'),
    context,
    { filename: 'extension/content/blocking-controller.js' }
  ));
  await Promise.resolve();
  assert.ok(messages.some(message =>
    message.type === 'GET_BLOCKING_RULES'
  ));
});

test('all affected JavaScript parses', () => {
  for (const relativePath of [
    'extension/shared/blocking-rules.js',
    'extension/content/blocking-page-hook.js',
    'extension/content/blocking-controller.js',
    'extension/background/ua-controller.js',
    'extension/content/search-media-controller.js',
    'extension/options/blocking-dashboard.js',
    'extension/navigation/navigation.js',
  ]) {
    assert.doesNotThrow(() => new vm.Script(
      read(relativePath),
      { filename: relativePath }
    ));
  }
});
