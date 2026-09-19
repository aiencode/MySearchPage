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
  assert.ok(manifest.web_accessible_resources.some(entry =>
    entry.resources?.includes('content/feedback-assets/*.png') &&
    entry.matches?.includes('<all_urls>')
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
    'findBlockingSearchMatchBG',
    { URL }
  );
  const rules = {
    blockedKeywords: ['赌博', '光王'],
    blockedUrlPatterns: ['blocked.example'],
  };

  const keywordMatch = findMatch(
    '搜索赌博内容',
    'https://www.douyin.com/search/test',
    rules
  );
  assert.equal(keywordMatch.kind, 'keyword');
  assert.equal(keywordMatch.value, '赌博');

  const encodedYouTubeMatch = findMatch(
    '',
    'https://www.youtube.com/results?' +
      'search_query=%E5%85%89%E7%8E%8B',
    rules
  );
  assert.equal(encodedYouTubeMatch.kind, 'keyword');
  assert.equal(encodedYouTubeMatch.value, '光王');

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

test('search keyword matches become page-level blocks and persistent gates stay separate', () => {
  const controller = read('extension/content/blocking-controller.js');
  const youtubeSearchTextFromUrl = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'youtubeSearchTextFromUrl',
    { URL, String }
  );
  assert.equal(
    youtubeSearchTextFromUrl(
      'https://www.youtube.com/results?' +
        'search_query=%E5%85%89%E7%8E%8B',
      'https://www.youtube.com/'
    ),
    '光王'
  );
  assert.equal(
    youtubeSearchTextFromUrl(
      'https://www.youtube.com/watch?v=allowed',
      'https://www.youtube.com/'
    ),
    ''
  );
  assert.equal(
    youtubeSearchTextFromUrl(
      'https://example.test/results?search_query=光王',
      'https://www.youtube.com/'
    ),
    ''
  );

  const searchTextFromUrl = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'searchTextFromUrl',
    { URL, String }
  );
  assert.equal(
    searchTextFromUrl(
      'https://www.douyin.com/jingxuan/search/%E5%85%89%E7%8E%8B?type=general',
      'https://www.douyin.com/'
    ),
    '光王'
  );

  const searchMatch = {
    kind: 'keyword',
    value: '光王',
    pageSource: 'search',
  };
  const detectedPageBlockingMatch = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'detectedPageBlockingMatch',
    {
      global: {
        location: {
          href: 'https://www.youtube.com/results?search_query=光王',
        },
      },
      currentUrlPattern: null,
      currentTitleKeyword: null,
      currentSearchMatch: searchMatch,
      normalizeNavigationUrl(rawUrl) {
        return rawUrl;
      },
    }
  );
  assert.equal(detectedPageBlockingMatch(), searchMatch);
  const currentPageBlockingMatch = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'currentPageBlockingMatch',
    {
      persistentPageGateMatch: null,
      currentSearchMatch: searchMatch,
      detectedPageBlockingMatch,
    }
  );
  assert.equal(currentPageBlockingMatch(), searchMatch);

  let pauseCount = 0;
  let clickRecords = 0;
  let feedbackCount = 0;
  let persistentImageShows = 0;
  const gateGlobals = {
    persistentPageGateMatch: null,
    pageIsBlocked: false,
    showPersistentPageGateImage() {
      persistentImageShows += 1;
      return 'content/feedback-assets/fixed.png';
    },
    pausePageMedia() {
      pauseCount += 1;
    },
    recordClick() {
      clickRecords += 1;
      return 100 + clickRecords;
    },
    showFeedback() {
      feedbackCount += 1;
    },
  };
  const latchPersistentPageGate = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'latchPersistentPageGate',
    gateGlobals
  );
  const pageMatch = { kind: 'keyword', value: '光王', pageSource: 'title' };
  assert.equal(latchPersistentPageGate(pageMatch), true);
  assert.equal(latchPersistentPageGate(pageMatch), false);
  assert.equal(gateGlobals.pageIsBlocked, true);
  assert.equal(pauseCount, 1);
  assert.equal(clickRecords, 1);
  assert.equal(feedbackCount, 1);
  assert.equal(persistentImageShows, 1);

  const eventGlobals = {
    persistentPageGateMatch: pageMatch,
    NAVIGATION_EVENT: 'mysearch-blocking-navigation-attempt',
    recordClick() {
      clickRecords += 1;
      return 200;
    },
    showFeedback() {
      feedbackCount += 1;
    },
  };
  const persistentGateEventNeedsFeedback = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'persistentGateEventNeedsFeedback',
    eventGlobals
  );
  eventGlobals.persistentGateEventNeedsFeedback =
    persistentGateEventNeedsFeedback;
  for (const type of [
    'click',
    'pointerdown',
    'auxclick',
    'submit',
    'mysearch-blocking-navigation-attempt',
  ]) {
    assert.equal(persistentGateEventNeedsFeedback({ type }), true, type);
  }
  for (const key of ['Enter', ' ', 'Spacebar']) {
    assert.equal(
      persistentGateEventNeedsFeedback({ type: 'keydown', key }),
      true,
      key
    );
  }
  assert.equal(
    persistentGateEventNeedsFeedback({ type: 'keydown', key: 'a' }),
    false
  );
  assert.equal(
    persistentGateEventNeedsFeedback({
      type: 'keydown',
      key: 'Enter',
      isComposing: true,
    }),
    false
  );
  for (const type of [
    'play',
    'mysearch-blocking-media-attempt',
    'mousemove',
    'pointermove',
  ]) {
    assert.equal(persistentGateEventNeedsFeedback({ type }), false, type);
  }

  const blockPersistentPageEvent = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'blockPersistentPageEvent',
    eventGlobals
  );
  const makeEvent = type => ({
    type,
    target: {
      pause() {
        this.paused = true;
      },
    },
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
    stopImmediatePropagation() {
      this.immediatelyStopped = true;
    },
  });
  const passiveMediaEvent = makeEvent('play');
  assert.equal(blockPersistentPageEvent(passiveMediaEvent), true);
  assert.equal(passiveMediaEvent.prevented, true);
  assert.equal(passiveMediaEvent.target.paused, true);
  assert.equal(clickRecords, 1);
  assert.equal(feedbackCount, 1);

  const activeClickEvent = makeEvent('click');
  assert.equal(blockPersistentPageEvent(activeClickEvent), true);
  assert.equal(clickRecords, 2);
  assert.equal(feedbackCount, 2);

  const activeNavigationEvent = makeEvent(
    'mysearch-blocking-navigation-attempt'
  );
  assert.equal(
    blockPersistentPageEvent(activeNavigationEvent),
    true
  );
  assert.equal(activeNavigationEvent.prevented, true);
  assert.equal(clickRecords, 3);
  assert.equal(feedbackCount, 3);

  const blockEventSource = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'blockEvent',
    {}
  ).toString();
  assert.ok(
    blockEventSource.indexOf('event.preventDefault()') <
      blockEventSource.indexOf('recordClick(match)')
  );

  const depth3Source = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'recordDepth3Attempt',
    {}
  ).toString();
  assert.ok(
    depth3Source.indexOf('recordClick(match)') <
      depth3Source.indexOf("type: 'RECORD_BLOCKING_EVENT'")
  );
  assert.match(
    controller,
    /global\.addEventListener\('submit', handleSearchSubmit, true\)/
  );
  assert.match(
    controller,
    /findYouTubeSearchKeywordMatch\(targetUrl\)/
  );
  assert.doesNotMatch(
    controller,
    /addEventListener\(\s*['"](?:mousemove|pointermove|mouseover|mouseenter)['"]/
  );
  assert.match(controller, /function latchPersistentPageGate/);
  assert.match(controller, /function blockPersistentPageEvent/);
  assert.match(controller, /blockPersistentPageEvent\(event\)/);
  assert.match(
    controller,
    /global\.addEventListener\('play', handleNativeMediaPlay, true\)/
  );
  assert.doesNotMatch(
    controller,
    /activeBlockingStateKey|rulesSignature|function blockingStateKey|function beginBlockingState|function activateBlockingState/
  );
  const finishPauseSource = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'finishFeedbackPause',
    {}
  ).toString();
  assert.doesNotMatch(
    finishPauseSource,
    /persistentPageGate|clearPersistentPageGate/
  );

  const transientImageSource = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'showBlockingImageFeedback',
    {}
  ).toString();
  assert.match(transientImageSource, /setTimeout/);
  assert.match(transientImageSource, /5000/);
  assert.match(
    transientImageSource,
    /TRANSIENT_FEEDBACK_IMAGE_ID/
  );

  const persistentImageSource = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'showPersistentPageGateImage',
    {}
  ).toString();
  assert.match(
    persistentImageSource,
    /PERSISTENT_FEEDBACK_IMAGE_ID/
  );
  assert.match(
    persistentImageSource,
    /renderBlockingFeedbackImage/
  );
  assert.doesNotMatch(
    persistentImageSource,
    /setTimeout|showBlockingImageFeedback/
  );

  const clearGateSource = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'clearPersistentPageGate',
    {}
  ).toString();
  assert.match(
    clearGateSource,
    /PERSISTENT_FEEDBACK_IMAGE_ID/
  );
  assert.doesNotMatch(
    clearGateSource,
    /TRANSIENT_FEEDBACK_IMAGE_ID/
  );

  const shouldClearPersistentPageGate = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'shouldClearPersistentPageGate',
    {}
  );
  assert.equal(
    shouldClearPersistentPageGate(pageMatch, null, false, false),
    false
  );
  assert.equal(
    shouldClearPersistentPageGate(pageMatch, null, true, true),
    false
  );
  assert.equal(
    shouldClearPersistentPageGate(
      pageMatch,
      pageMatch,
      true,
      false
    ),
    false
  );
  assert.equal(
    shouldClearPersistentPageGate(pageMatch, null, true, false),
    true
  );
  assert.match(controller, /function showPersistentPageGateImage/);
  assert.match(controller, /mysearch-blocking-page-gate-image/);
  assert.match(
    controller,
    /showBehaviorPauseFeedback\(\);\s*const feedbackImageAsset = match\.persistentPageGate\s*\?\s*showPersistentPageGateImage\(\)\s*:\s*showBlockingImageFeedback\(\)/
  );
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
      isBlockingEnabledForLegacySearch() {
        return true;
      },
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
  let blockingEnabled = true;
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
      async getBlockingEnabledBG() {
        return blockingEnabled;
      },
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

  blockingEnabled = false;
  rules = {
    blockedKeywords: ['赌博'],
    blockedUrlPatterns: [],
  };
  const disabled = await openSearchResult(
    { tab: { id: 10 } },
    '再次搜索赌博内容',
    'https://www.douyin.com/search/test'
  );
  assert.equal(disabled.blocked, false);
  assert.equal(disabled.opened, true);
  assert.equal(sessionStarts, 1, '关闭总开关后不再建立阻断搜索会话');
  assert.equal(tabCreates, 2, '关闭总开关后仍可打开搜索结果');
});

test('temporary blocking master switch is wired from popup to enforcement', () => {
  const popupHtml = read('extension/popup/popup.html');
  const popup = read('extension/popup/popup.js');
  const background = read('extension/background/ua-controller.js');
  const controller = read('extension/content/blocking-controller.js');
  const navigation = read('extension/navigation/navigation.js');

  assert.match(popupHtml, /id="blocking-toggle"/);
  assert.match(popupHtml, /id="blocking-status"/);
  assert.match(popup, /type: 'TOGGLE_BLOCKING'/);
  assert.match(popup, /response\.blockingEnabled !== false/);
  assert.match(background, /const BLOCKING_ENABLED_STORAGE_KEY_BG = 'blockingEnabled'/);
  assert.match(background, /case 'GET_BLOCKING_STATUS'/);
  assert.match(background, /case 'TOGGLE_BLOCKING'/);
  assert.match(background, /blockingEnabled \? await getBlockingRulesBG\(\) : null/);
  assert.match(controller, /const BLOCKING_ENABLED_STORAGE_KEY = 'blockingEnabled'/);
  assert.match(controller, /type: 'GET_BLOCKING_STATUS'/);
  assert.match(controller, /blockingEnabled !== true/);
  assert.match(
    controller,
    /const DEPTH_NAVIGATION_ENFORCEMENT_ENABLED = false/
  );
  assert.match(
    background,
    /const DEPTH_NAVIGATION_ENFORCEMENT_ENABLED_BG = false/
  );
  assert.match(controller, /changes\[BLOCKING_ENABLED_STORAGE_KEY\]/);
  assert.match(navigation, /isBlockingEnabledForLegacySearch/);
  const initSource = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'init',
    {}
  ).toString();
  assert.ok(
    initSource.indexOf('markBlockingRuntimeVersion()') <
      initSource.indexOf('loadBlockingEnabled()'),
    '运行版本标记必须独立于开关并先于开关状态读取'
  );
});

test('Douyin history scroll, autoplay and detail close stay passive', () => {
  const controller = read('extension/content/blocking-controller.js');
  const adapter = {
    name: 'douyin',
    domains: ['douyin.com'],
  };
  const viewState = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'douyinHistoryViewState',
    {
      URL,
      global: {
        location: { href: 'https://www.douyin.com/' },
      },
      isAdapterDomainUrl() { return true; },
    }
  );

  const history = viewState(
    '',
    'https://www.douyin.com/user/self?' +
      'from_tab_name=main&showTab=record',
    false,
    adapter
  );
  assert.deepEqual(JSON.parse(JSON.stringify(history)), {
    context: 'douyin-history',
    passive: true,
  });

  const detail = viewState(
    history.context,
    'https://www.douyin.com/video/123456',
    true,
    adapter
  );
  assert.deepEqual(JSON.parse(JSON.stringify(detail)), {
    context: 'douyin-history',
    passive: false,
  });

  const closedWithStaleUrl = viewState(
    detail.context,
    'https://www.douyin.com/video/123456',
    false,
    adapter
  );
  assert.deepEqual(JSON.parse(JSON.stringify(closedWithStaleUrl)), {
    context: 'douyin-history',
    passive: true,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(viewState(
    closedWithStaleUrl.context,
    'https://www.douyin.com/recommend',
    false,
    adapter
  ))), {
    context: '',
    passive: false,
  });

  const handleMediaAttempt = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'handleMediaAttempt',
    {
      blockingEnabled: true,
      DEPTH_NAVIGATION_ENFORCEMENT_ENABLED: false,
      navigationContext: null,
      blockPersistentPageEvent() { return false; },
      currentPageBlockingMatch() { return null; },
    }
  );
  const passivePlay = {
    type: 'mysearch-blocking-media-attempt',
    target: {},
    preventDefault() {
      throw new Error('自动预览不应被阻断');
    },
    stopPropagation() {
      throw new Error('自动预览不应被阻断');
    },
    stopImmediatePropagation() {
      throw new Error('自动预览不应被阻断');
    },
  };
  assert.doesNotThrow(() => handleMediaAttempt(passivePlay));
  assert.doesNotMatch(
    handleMediaAttempt.toString(),
    /getInteractionMatch/
  );

  const isAllowedDetailDismissal = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'isAllowedDetailDismissal',
    {
      depthAdapterEntry() { return { name: 'douyin' }; },
      isElement() { return true; },
    }
  );
  assert.equal(
    isAllowedDetailDismissal({
      type: 'keydown',
      key: 'Escape',
    }),
    true
  );
  assert.equal(
    isAllowedDetailDismissal({
      type: 'click',
      target: {
        closest(selector) {
          return selector.includes('[data-e2e*="close"]')
            ? this
            : null;
        },
      },
    }),
    true
  );

  assert.match(
    controller,
    /const nextTitleKeyword = onPassiveCollectionPage\s*\?\s*null/
  );
  assert.match(controller, /isAllowedDetailDismissal\(event\)/);
  assert.doesNotMatch(controller, /blockDuringFeedbackPause/);
  assert.match(
    controller,
    /#\$\{FEEDBACK_PAUSE_ID\} \{[\s\S]*?pointer-events: none !important;/
  );
});

test('returning from a Douyin video to search results is never depth 3', () => {
  const resets = [];
  const handlePageNavigation = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'handlePageNavigation',
    {
      blockingEnabled: true,
      DEPTH_NAVIGATION_ENFORCEMENT_ENABLED: true,
      blockDuringFeedbackPause() { return false; },
      blockPersistentPageEvent() { return false; },
      findYouTubeSearchKeywordMatch() { return null; },
      findUrlMatch() { return null; },
      douyinHistoryViewState() {
        return { context: '', passive: false };
      },
      currentPageBlockingMatch() { return null; },
      navigationContext: {
        enabled: true,
        depth: 2,
        contentId: 'douyin:100',
      },
      depthAdapterEntry() { return { name: 'douyin' }; },
      isSearchResultsUrl(url) {
        return String(url).includes('/search');
      },
      resetNavigationToSearchResults(url) { resets.push(url); },
      depth3Match() {
        throw new Error('返回搜索结果不应进入 depth3 判断');
      },
    }
  );
  const event = {
    detail: {
      url: 'https://www.douyin.com/search/%E6%88%98%E5%88%A9?type=video',
    },
  };
  assert.doesNotThrow(() => handlePageNavigation(event));
  assert.deepEqual(resets, [event.detail.url]);
});

test('baseline mode does not block ordinary depth navigation', () => {
  const preventions = [];
  const handlePageNavigation = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'handlePageNavigation',
    {
      blockingEnabled: true,
      DEPTH_NAVIGATION_ENFORCEMENT_ENABLED: false,
      blockDuringFeedbackPause() { return false; },
      blockPersistentPageEvent() { return false; },
      findYouTubeSearchKeywordMatch() { return null; },
      findUrlMatch() { return null; },
      douyinHistoryViewState() {
        return { context: '', passive: false };
      },
      currentPageBlockingMatch() { return null; },
      navigationContext: {
        enabled: true,
        depth: 2,
        contentId: 'douyin:100',
      },
      depthAdapterEntry() { return { name: 'douyin' }; },
      isSearchResultsUrl() { return false; },
      depth3Match() {
        throw new Error('基础模式不应进入 depth3 判断');
      },
      blockDepth3() {
        throw new Error('基础模式不应触发 depth3 阻断');
      },
    }
  );
  const event = {
    detail: { url: 'https://www.douyin.com/video/200' },
    preventDefault() { preventions.push('preventDefault'); },
    stopPropagation() { preventions.push('stopPropagation'); },
    stopImmediatePropagation() { preventions.push('stopImmediatePropagation'); },
  };
  assert.doesNotThrow(() => handlePageNavigation(event));
  assert.deepEqual(preventions, []);
});

test('baseline mode does not create high-risk navigation sessions', () => {
  const supportsDepthNavigation = loadNamedFunction(
    'extension/background/ua-controller.js',
    'supportsDepthNavigationBG',
    {
      DEPTH_NAVIGATION_ENFORCEMENT_ENABLED_BG: false,
      SUPPORTED_DEPTH_DOMAINS_BG: ['douyin.com'],
      navigationDomainMatchesBG(hostname, rule) {
        return String(hostname).includes(String(rule));
      },
      normalizeNavigationHostnameBG(value) {
        return String(value).replace(/^https?:\/\//, '')
          .split('/')[0];
      },
    }
  );
  assert.equal(
    supportsDepthNavigation(
      'https://www.douyin.com/search/%E6%88%98%E5%88%A9',
      ['douyin.com']
    ),
    false
  );
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

test('keyword-matched search cards replace original content with a low-stimulus placeholder', () => {
  const controller = read('extension/content/blocking-controller.js');
  const mediaAdapters = read('extension/content/search-media-adapters.js');
  assert.match(controller, /data-mysearch-blocked-card/);
  assert.match(controller, /searchMediaCardSelector/);
  assert.match(controller, /resultCardsInElement/);
  assert.match(controller, /hideBlockedCard\(card, match\)/);
  assert.match(controller, /placeholder\.textContent = '已屏蔽'/);
  assert.match(controller, /for \(const child of childNodes\) card\.removeChild/);
  assert.match(controller, /function restoreBlockedCards\(\)/);
  assert.match(controller, /function blockedCardMatch\(card\)/);
  assert.match(controller, /blockedCardMatch\(card\) \|\| matchElement\(card\)/);
  assert.match(controller, /function fallbackResultCardForElement\(element, adapterEntry\)/);
  assert.match(controller, /function genericResultCardForElement\(element, adapterEntry\)/);
  assert.match(controller, /具备“媒体 \+ 内容链接 \+ 少量文字”/);
  assert.match(controller, /function searchTextFromUrl\(rawUrl/);
  assert.match(controller, /PAGE_GATE_ATTR/);
  assert.match(controller, /\[data-e2e\*="search-result-item"\]/);
  assert.match(controller, /\[data-e2e="search-video-card"\]/);
  assert.match(controller, /\[data-e2e\*="search-video-card"\]/);
  assert.doesNotMatch(controller, /\[data-e2e="search-result"\]/);
  assert.match(controller, /\[class\*="video-card"\]/);
  assert.match(mediaAdapters, /\[data-e2e="search-video-card"\]/);
  assert.match(mediaAdapters, /\[data-e2e\*="search-video-card"\]/);
  assert.doesNotMatch(mediaAdapters, /cards: '\[data-e2e="search-result"\]/);
  assert.match(
    controller,
    /\[\$\{BLOCKED_ATTR\}\]:not\(\[\$\{BLOCKED_CARD_ATTR\}\]\)/
  );
  assert.match(controller, /restoreBlockedCards\(\);\s*\n\s*rules = rulesApi/);
});

test('Douyin current jingxuan search route is treated as a result page', () => {
  const controller = read('extension/content/blocking-controller.js');
  const mediaAdapters = read('extension/content/search-media-adapters.js');
  const route = '/^\\/(?:jingxuan\\/)?search(?:\\/|$)/';
  assert.ok(controller.includes(route));
  assert.ok(mediaAdapters.includes(route));
});

test('Xiaohongshu content IDs are found from SPA cards and detail links', () => {
  const contentIdFromElement = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'contentIdFromElement',
    {
      depthAdapterEntry() {
        return {
          name: 'xiaohongshu',
          candidates: [
            '[data-note-id]',
            '[data-note-id-str]',
            '.note-item',
            '[class*="note-item"]',
            'a[href*="/explore/"]',
            'a[href*="/discovery/item/"]',
            'a[href*="/user/"]',
          ],
        };
      },
      isElement(value) {
        return value?.kind === 'element';
      },
      contentIdFromUrl(rawUrl, adapter) {
        const match = String(rawUrl).match(
          /\/(?:explore|discovery\/item)\/([a-zA-Z0-9]+)/
        );
        return match ? `${adapter.name}:${match[1]}` : '';
      },
    }
  );
  const card = {
    kind: 'element',
    parentElement: null,
    getAttribute(name) {
      return name === 'data-id' ? 'spa-note-42' : '';
    },
    matches(selector) {
      return selector.includes('.note-item');
    },
    closest() {
      return this;
    },
    querySelector() {
      return null;
    },
  };
  assert.equal(
    contentIdFromElement(card),
    'xiaohongshu:spa-note-42'
  );

  const link = {
    kind: 'element',
    parentElement: null,
    getAttribute(name) {
      return name === 'href'
        ? '/explore/detail99'
        : '';
    },
    matches(selector) {
      return selector.includes('a[href*="/explore/"]');
    },
    closest() {
      return this;
    },
    querySelector() {
      return null;
    },
  };
  assert.equal(
    contentIdFromElement(link),
    'xiaohongshu:detail99'
  );
});

test('Xiaohongshu closes a hidden detail before allowing the next search result', () => {
  const hiddenDetail = {
    visible: false,
    hasAttribute() { return false; },
    getAttribute() { return null; },
    closest() { return null; },
  };
  const searchResultsRoot = {
    visible: true,
    closest() { return null; },
  };
  const currentPageContentId = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'currentPageContentId',
    {
      DEPTH3_REJECTED_ATTR: 'data-mysearch-depth3-rejected',
      global: {
        location: { href: 'https://www.xiaohongshu.com/explore/first' },
        document: {
          querySelectorAll(selector) {
            return selector === '.note-detail-mask' ||
              selector.includes('note-detail')
              ? [hiddenDetail]
              : [searchResultsRoot];
          },
        },
      },
      depthAdapterEntry() {
        return {
          name: 'xiaohongshu',
          searchRoots: ['.feeds-container'],
          details: ['.note-detail-mask'],
        };
      },
      isVisiblePageElement(element) { return element.visible; },
      hasVisibleSearchResultsRoot() { return true; },
      contentIdFromElement() { return 'xiaohongshu:first'; },
      syntheticDetailContentId() { return 'xiaohongshu:synthetic'; },
      contentIdFromUrl() { return 'xiaohongshu:first'; },
    }
  );
  assert.equal(
    currentPageContentId(),
    '',
    'a hidden old detail must not keep the tab at depth 2'
  );

  const updates = [];
  const synchronizeDepthFromPage = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'synchronizeDepthFromPage',
    {
      navigationContext: {
        enabled: true,
        depth: 2,
        contentId: 'xiaohongshu:first',
      },
      blockingEnabled: true,
      DEPTH_NAVIGATION_ENFORCEMENT_ENABLED: true,
      global: {
        location: { href: 'https://www.xiaohongshu.com/explore/first' },
      },
      depthAdapterEntry() {
        return { name: 'xiaohongshu' };
      },
      clearDepth2Cleanup() {},
      currentPageContentId() { return ''; },
      isSearchResultsView() { return true; },
      updateNavigationContext(...args) { updates.push(args); },
    }
  );
  synchronizeDepthFromPage();
  assert.deepEqual(JSON.parse(JSON.stringify(updates)), [[1, '', {
    contentUrl: '',
    pendingDepth: 1,
    pendingContentId: '',
    pendingContentUrl: '',
  }]]);

  let cleanupCalls = 0;
  const visibleDetailContext = {
    enabled: true,
    depth: 2,
    contentId: 'xiaohongshu:first',
  };
  const synchronizeWithVisibleDetail = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'synchronizeDepthFromPage',
    {
      navigationContext: visibleDetailContext,
      blockingEnabled: true,
      DEPTH_NAVIGATION_ENFORCEMENT_ENABLED: true,
      global: {
        location: { href: 'https://www.xiaohongshu.com/explore/first' },
      },
      depthAdapterEntry() {
        return { name: 'xiaohongshu' };
      },
      clearDepth2Cleanup() {},
      currentPageContentId() { return 'xiaohongshu:first'; },
      isSearchResultsView() { return true; },
      depth3Match() { return null; },
      applyDepth2Cleanup() { cleanupCalls += 1; },
    }
  );
  synchronizeWithVisibleDetail();
  assert.equal(
    visibleDetailContext.depth,
    2,
    'an actually visible detail must remain at depth 2'
  );
  assert.equal(cleanupCalls, 1);
});

test('Douyin closes a hidden detail before allowing the next search result', () => {
  const hiddenDetail = {
    visible: false,
    hasAttribute() { return false; },
    getAttribute() { return null; },
    closest() { return null; },
  };
  const searchResultsRoot = {
    visible: true,
    closest() { return null; },
  };
  const currentPageContentId = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'currentPageContentId',
    {
      DEPTH3_REJECTED_ATTR: 'data-mysearch-depth3-rejected',
      global: {
        location: { href: 'https://www.douyin.com/video/100' },
        document: {
          querySelectorAll(selector) {
            return selector === '[data-e2e="feed-active-video"][data-aweme-id]' ||
              selector === '[data-e2e="video-detail"][data-aweme-id]'
              ? [hiddenDetail]
              : [searchResultsRoot];
          },
        },
      },
      depthAdapterEntry() {
        return {
          name: 'douyin',
          searchRoots: ['[data-e2e="search-result-list"]'],
          details: [
            '[data-e2e="feed-active-video"][data-aweme-id]',
            '[data-e2e="video-detail"][data-aweme-id]',
          ],
        };
      },
      isVisiblePageElement(element) { return element.visible; },
      hasVisibleSearchResultsRoot() { return true; },
      contentIdFromElement() { return 'douyin:100'; },
      contentIdFromUrl(rawUrl, adapter) {
        const match = String(rawUrl).match(/\/video\/([0-9]+)/);
        return match ? `${adapter.name}:${match[1]}` : '';
      },
    }
  );
  assert.equal(
    currentPageContentId(),
    '',
    '抖音隐藏的旧详情不能继续把标签页占在第 2 层'
  );

  const isSearchResultsView = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'isSearchResultsView',
    {
      depthAdapterEntry() {
        return {
          name: 'douyin',
          searchRoots: ['[data-e2e="search-result-list"]'],
        };
      },
      isSearchResultsUrl() { return false; },
      hasVisibleSearchResultsRoot() { return true; },
    }
  );
  assert.equal(
    isSearchResultsView('https://www.douyin.com/video/100'),
    true,
    '抖音结果流恢复时，即使地址暂时仍是旧视频地址，也应视为结果页'
  );
});

test('policy dashboard and old-tab takeover remain in the existing extension', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const policy = JSON.parse(
    read('extension/policies/blocking-policy.template.json')
  );
  const background = read('extension/background/ua-controller.js');
  const blockingController =
    read('extension/content/blocking-controller.js');
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
  assert.match(
    background,
    /BLOCKING_RUNTIME_VERSION_BG =\s*'explicit-rules-switch-v1'/
  );
  assert.match(
    background,
    /runtimeVersion !== BLOCKING_RUNTIME_VERSION_BG/
  );
  assert.match(background, /chrome\.tabs\.reload\(tab\.id\)/);
  assert.match(
    blockingController,
    /BLOCKING_RUNTIME_VERSION =\s*'explicit-rules-switch-v1'/
  );
  assert.match(
    blockingController,
    /setAttribute\?\.\(\s*BLOCKING_RUNTIME_ATTR,\s*BLOCKING_RUNTIME_VERSION/
  );
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
  assert.match(
    mainPage,
    /<button id="add-blocking-rule" type="button">阻断<\/button>/
  );
  assert.doesNotMatch(mainPage, /添加阻断规则/);
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
  assert.match(
    source,
    /<button id=\"add-blocking-rule\" type=\"button\">阻断<\/button>/
  );
  assert.doesNotMatch(source, /添加阻断规则/);
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
  assert.match(controller, /'pointerdown'/);
  assert.match(controller, /'click'/);
  assert.match(controller, /'auxclick'/);
  assert.match(controller, /'keydown'/);
  assert.match(controller, /DEDUPLICATION_WINDOW_MS = 2000/);
  assert.match(controller, /RECORD_BLOCKING_EVENT/);
  assert.match(controller, /filter: blur\(6px\) grayscale\(1\)/);
  assert.match(
    controller,
    /if \(!allowDeduplicatedAttempt\(match\)\) return null/
  );
  assert.match(controller, /function latchPersistentPageGate/);
  assert.match(controller, /function blockPersistentPageEvent/);
  assert.doesNotMatch(
    controller,
    /activeBlockingStateKey|rulesSignature|function blockingStateKey|function beginBlockingState|function activateBlockingState/
  );
  assert.doesNotMatch(controller, /lastFeedbackAt/);
  assert.match(
    controller,
    /const feedbackType = 'aversive\+pause\+beep\+photo'/
  );
  assert.match(controller, /function flashBlockingFeedback/);
  assert.match(controller, /function showBlockingImageFeedback/);
  assert.match(
    controller,
    /function visibleDocumentAppendTarget\(\) \{\s*const target = global\.document\?\.body \|\|\s*global\.document\?\.documentElement/
  );
  assert.equal(
    (
      controller.match(
        /const target = visibleDocumentAppendTarget\(\);/g
      ) || []
    ).length,
    4
  );
  assert.equal(
    (
      controller.match(
        /const target = documentAppendTarget\(\);/g
      ) || []
    ).length,
    1
  );
  assert.match(controller, /createElement\('img'\)/);
  assert.match(controller, /global\.chrome\?\.runtime\?\.getURL\?\./);
  assert.match(controller, /data:image\/svg\+xml;charset=utf-8/);
  assert.match(controller, /const fallbackImageUrl =/);
  assert.match(controller, /image\.onload = revealImage/);
  assert.match(controller, /image\.onerror = \(\) =>/);
  assert.match(
    controller,
    /target\.appendChild\(image\);\s*image\.classList\.add\('visible'\)/
  );
  assert.match(
    controller,
    /showBehaviorPauseFeedback\(\);\s*const feedbackImageAsset = match\.persistentPageGate\s*\?\s*showPersistentPageGateImage\(\)\s*:\s*showBlockingImageFeedback\(\)/
  );
  assert.match(controller, /display: block !important/);
  assert.match(controller, /image\.classList\.add\('visible'\)/);
  assert.match(
    controller,
    /classList\.add\('mysearch-blocking-feedback-flash'\)/
  );
  assert.match(controller, /playBeep\(\)/);
  assert.match(controller, /内容已阻断。本次冲动点击已记录/);
  assert.match(controller, /冲动不是命令。停一下，识别它，然后回到原来的任务/);
  assert.match(controller, /type: 'feedback'/);
  assert.match(controller, /function loadBlockingRules/);
  assert.match(
    controller,
    /isUnknownMessageResponse\(\s*response,\s*'GET_BLOCKING_RULES'/
  );
  assert.match(controller, /rulesApi\.getRulesFromStorage\(\)/);
  assert.match(controller, /function refreshBlockingRules/);
  assert.doesNotMatch(
    controller,
    /applyRules\(response\?\.rules \|\| rulesApi\.normalizeRules\(\)\)/
  );
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
  assert.match(controller, /data-note-id-str/);
  assert.match(controller, /\.note-item/);
  assert.match(controller, /\.note-detail-mask/);
  assert.match(controller, /\[class\*="noteDetailMask"\]/);
  assert.match(controller, /data-aweme-id/);
  assert.match(controller, /data-bvid/);
  assert.match(controller, /a\[href\*="\/watch\?"\]/);
  assert.match(controller, /NEGATIVE_FEEDBACK_ASSETS/);
  for (const asset of [
    'moldy-fruit.png',
    'clogged-drain.png',
    'greasy-pan.png',
    'dirty-wastewater.png',
  ]) {
    assert.match(controller, new RegExp(asset.replace('.', '\\.') + "'")
    );
  }
  assert.match(controller, /oscillator\.frequency\.setValueAtTime\(2800/);
  assert.match(controller, /context\.currentTime \+ 0\.14/);
  assert.match(controller, /function showBehaviorPauseFeedback/);
  assert.match(controller, /先停 \$\{seconds\} 秒/);
  assert.match(controller, /pauseDurationMs: 5000/);
  assert.match(controller, /soundProfile: 'short-high-frequency-safe'/);
  assert.match(controller, /trainingPrompt: '识别冲动，不执行，回到原任务'/);
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
  const depth3Match = loadNamedFunction(
    'extension/content/blocking-controller.js',
    'depth3Match',
    {
      navigationContext: {
        enabled: true,
        depth: 2,
        contentId: 'douyin:100',
      },
      isDepth3ContentTransition(context, contentId) {
        return Boolean(
          context.enabled &&
          context.depth === 2 &&
          context.contentId &&
          contentId &&
          context.contentId !== contentId
        );
      },
    }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(depth3Match('douyin:200'))),
    {
      kind: 'navigation',
      value: 'douyin:200',
      contentId: 'douyin:200',
    },
    '层级拦截不能伪装成用户配置的网址命中'
  );
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
