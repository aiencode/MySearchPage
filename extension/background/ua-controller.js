/**
 * MySearchPage UA Controller - Background Service Worker
 * 
 * 职责：
 * 1. 使用 declarativeNetRequest (Chrome MV3) 动态管理 UA 修改规则
 * 2. 使用 webRequest.onBeforeSendHeaders (Firefox) 修改请求头
 * 3. 监听配置变更，实时更新规则
 * 4. 与 Popup / Options 页面通信
 */

// ============================================
// 初始化：加载配置并应用规则
// ============================================

// 在 Service Worker 中导入配置管理（内联方式，因为 MV3 不支持 importScripts 动态导入）
// 注意：config.js 的函数需要在 Service Worker 中重新定义

const STORAGE_KEYS_BG = {
  UA_RULES: 'uaRules',
  GLOBAL_ENABLED: 'globalEnabled',
};

const BLOCKING_STORAGE_KEYS_BG = Object.freeze({
  KEYWORDS: 'blockedKeywords',
  URL_PATTERNS: 'blockedUrlPatterns',
  HIGH_RISK_DOMAINS: 'highRiskDomains',
});

const BLOCKING_STATS_DB_BG = 'MySearchPageBlockingDB';
const BLOCKING_STATS_DB_VERSION_BG = 1;
const BLOCKING_STATS_STORE_BG = 'events';
const SEARCH_SESSION_STORAGE_KEY_BG = 'mySearchNavigationSessions';
const SEARCH_SESSION_BUDGET_MS_BG = 40 * 60 * 1000;
const SUPPORTED_DEPTH_DOMAINS_BG = [
  'xiaohongshu.com',
  'douyin.com',
  'bilibili.com',
  'youtube.com',
  'youtu.be',
];
const DEFAULT_HIGH_RISK_DOMAINS_BG = Object.freeze([
  'xiaohongshu.com',
  'douyin.com',
  'bilibili.com',
  'youtube.com',
]);
const SEARCH_MEDIA_TAB_PATTERNS_BG = [
  '*://*.bilibili.com/*',
  '*://*.douyin.com/*',
  '*://*.youtube.com/*',
  '*://*.xiaohongshu.com/*',
];
const SEARCH_MEDIA_SCRIPT_FILES_BG = [
  'shared/search-media-settings.js',
  'content/search-media-adapters.js',
  'content/search-media-controller.js',
];

let searchSessionMutationBG = Promise.resolve();

function normalizeNavigationHostnameBG(value) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase()
      .replace(/^www\./, '');
  } catch (error) {
    return String(value || '').toLowerCase().replace(/^www\./, '');
  }
}

function navigationDomainMatchesBG(hostname, rule) {
  const host = normalizeNavigationHostnameBG(hostname);
  const normalizedRule = normalizeNavigationHostnameBG(rule);
  return Boolean(normalizedRule) &&
    (host === normalizedRule || host.endsWith(`.${normalizedRule}`));
}

function supportsDepthNavigationBG(url, highRiskDomains) {
  const hostname = normalizeNavigationHostnameBG(url);
  return SUPPORTED_DEPTH_DOMAINS_BG.some(domain =>
    navigationDomainMatchesBG(hostname, domain)
  ) && highRiskDomains.some(domain =>
    navigationDomainMatchesBG(hostname, domain)
  );
}

function findBlockingSearchMatchBG(keyword, targetUrl, rules) {
  const normalizedKeyword = String(keyword || '').trim();
  const normalizedUrl = String(targetUrl || '');
  for (const blockedKeyword of rules.blockedKeywords || []) {
    const value = String(blockedKeyword || '');
    if (value && normalizedKeyword.includes(value)) {
      return { kind: 'keyword', value };
    }
  }
  for (const blockedUrlPattern of rules.blockedUrlPatterns || []) {
    const value = String(blockedUrlPattern || '');
    if (value && normalizedUrl.includes(value)) {
      return { kind: 'url', value };
    }
  }
  return null;
}

async function readSearchSessionStateBG() {
  if (!chrome.storage.session) return { sessions: {}, tabs: {} };
  const data = await chrome.storage.session.get(
    SEARCH_SESSION_STORAGE_KEY_BG
  );
  const stored = data[SEARCH_SESSION_STORAGE_KEY_BG];
  return stored && typeof stored === 'object'
    ? {
        sessions: stored.sessions || {},
        tabs: stored.tabs || {},
      }
    : { sessions: {}, tabs: {} };
}

async function writeSearchSessionStateBG(state) {
  if (!chrome.storage.session) return;
  await chrome.storage.session.set({
    [SEARCH_SESSION_STORAGE_KEY_BG]: state,
  });
}

function settleSearchSessionBG(session, timestamp = Date.now()) {
  if (!session) return;
  const previous = Number(session.lastForegroundAt) || timestamp;
  if (session.foregroundTabIds?.length) {
    session.remainingMs = Math.max(
      0,
      Number(session.remainingMs) - Math.max(0, timestamp - previous)
    );
  }
  session.lastForegroundAt = timestamp;
}

function activeSearchSessionBG(state, tabId) {
  const context = state.tabs[String(tabId)];
  if (!context) return null;
  const session = state.sessions[context.sessionId];
  if (!session) return null;
  settleSearchSessionBG(session);
  if (session.remainingMs <= 0) {
    delete state.tabs[String(tabId)];
    return null;
  }
  return { context, session };
}

function inheritSearchSessionBG(state, tabId, openerTabId, url) {
  const parent = activeSearchSessionBG(state, openerTabId);
  if (!parent) return null;
  const depth = parent.context.pendingDepth ||
    Math.min(2, Number(parent.context.depth || 0) + 1);
  const context = {
    sessionId: parent.context.sessionId,
    depth,
    contentId: depth === 2
      ? parent.context.pendingContentId || ''
      : '',
    contentUrl: depth === 2
      ? parent.context.pendingContentUrl ||
        String(url || '').slice(0, 2048)
      : '',
    resultUrl: depth === 1
      ? String(url || '').slice(0, 2048)
      : parent.context.resultUrl || '',
    pendingDepth: depth,
    pendingContentId: '',
    pendingContentUrl: '',
  };
  state.tabs[String(tabId)] = context;
  parent.context.pendingDepth = parent.context.depth;
  parent.context.pendingContentId = '';
  parent.context.pendingContentUrl = '';
  return { context, session: parent.session };
}

function mutateSearchSessionsBG(operation) {
  const result = searchSessionMutationBG.then(async () => {
    const state = await readSearchSessionStateBG();
    const value = await operation(state);
    await writeSearchSessionStateBG(state);
    return value;
  });
  searchSessionMutationBG = result.catch(() => {});
  return result;
}

async function startSearchSessionBG(sender, targetUrl) {
  const rules = await getBlockingRulesBG();
  if (!supportsDepthNavigationBG(targetUrl, rules.highRiskDomains)) {
    return { enabled: false };
  }
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error('无法确定搜索标签页');

  return mutateSearchSessionsBG(state => {
    const active = activeSearchSessionBG(state, tabId);
    const session = active?.session || {
      id: `search-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      remainingMs: SEARCH_SESSION_BUDGET_MS_BG,
      lastForegroundAt: Date.now(),
      foregroundTabIds: [],
    };
    state.sessions[session.id] = session;
    state.tabs[String(tabId)] = {
      sessionId: session.id,
      depth: 0,
      contentId: '',
      contentUrl: '',
      resultUrl: '',
      pendingDepth: 1,
      pendingContentId: '',
      pendingContentUrl: '',
    };
    return {
      enabled: true,
      sessionId: session.id,
      remainingMs: session.remainingMs,
    };
  });
}

async function openSearchResultBG(sender, keyword, targetUrl) {
  const normalizedKeyword = String(keyword || '').trim();
  const normalizedTargetUrl = String(targetUrl || '').trim();
  if (
    normalizedKeyword.length > 4096 ||
    !normalizedTargetUrl ||
    normalizedTargetUrl.length > 8192
  ) {
    throw new Error('搜索请求参数无效');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedTargetUrl);
  } catch (error) {
    throw new Error('搜索地址无效');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('搜索地址协议无效');
  }

  const openerTabId = sender.tab?.id;
  if (!Number.isInteger(openerTabId)) {
    throw new Error('无法确定搜索标签页');
  }

  const rules = await getBlockingRulesBG();
  const match = findBlockingSearchMatchBG(
    normalizedKeyword,
    parsedUrl.href,
    rules
  );
  if (match) {
    return {
      opened: false,
      blocked: true,
      match,
    };
  }

  const session = await startSearchSessionBG(sender, parsedUrl.href);
  const tab = await chrome.tabs.create({
    url: parsedUrl.href,
    active: true,
    openerTabId,
  });
  return {
    opened: true,
    blocked: false,
    sessionEnabled: session.enabled === true,
    sessionId: session.sessionId || '',
    tabId: tab?.id,
  };
}

async function getSearchSessionContextBG(sender) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) return { enabled: false };
  return mutateSearchSessionsBG(state => {
    let active = activeSearchSessionBG(state, tabId);
    if (!active && Number.isInteger(sender.tab?.openerTabId)) {
      active = inheritSearchSessionBG(
        state,
        tabId,
        sender.tab.openerTabId,
        sender.tab.pendingUrl || sender.tab.url
      );
    }
    if (!active) return { enabled: false };
    return {
      enabled: true,
      ...active.context,
      remainingMs: active.session.remainingMs,
    };
  });
}

async function updateSearchSessionContextBG(sender, message) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) return { enabled: false };
  return mutateSearchSessionsBG(state => {
    const active = activeSearchSessionBG(state, tabId);
    if (!active) return { enabled: false };
    const depth = Number(message.depth);
    if (![1, 2].includes(depth)) throw new Error('导航深度无效');
    active.context.depth = depth;
    active.context.contentId = depth === 2
      ? String(message.contentId || '').slice(0, 500)
      : '';
    active.context.contentUrl = depth === 2
      ? String(
          message.contentUrl || active.context.contentUrl || ''
        ).slice(0, 2048)
      : '';
    active.context.resultUrl = String(
      message.resultUrl || active.context.resultUrl || ''
    ).slice(0, 2048);
    active.context.pendingDepth = [1, 2].includes(
      Number(message.pendingDepth)
    ) ? Number(message.pendingDepth) : depth;
    active.context.pendingContentId = String(
      message.pendingContentId || ''
    ).slice(0, 500);
    active.context.pendingContentUrl = String(
      message.pendingContentUrl || ''
    ).slice(0, 2048);
    return {
      enabled: true,
      ...active.context,
      remainingMs: active.session.remainingMs,
    };
  });
}

async function updateSearchSessionForegroundBG(sender, visible) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) return { enabled: false };
  return mutateSearchSessionsBG(state => {
    const active = activeSearchSessionBG(state, tabId);
    if (!active) return { enabled: false };
    const ids = new Set(active.session.foregroundTabIds || []);
    if (visible) ids.add(tabId);
    else ids.delete(tabId);
    active.session.foregroundTabIds = Array.from(ids);
    active.session.lastForegroundAt = Date.now();
    return {
      enabled: true,
      remainingMs: active.session.remainingMs,
    };
  });
}

if (chrome.tabs?.onCreated) {
  chrome.tabs.onCreated.addListener(tab => {
    if (!Number.isInteger(tab.id) || !Number.isInteger(tab.openerTabId)) {
      return;
    }
    void mutateSearchSessionsBG(state => {
      inheritSearchSessionBG(
        state,
        tab.id,
        tab.openerTabId,
        tab.pendingUrl || tab.url
      );
    });
  });
}

if (chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener(tabId => {
    void mutateSearchSessionsBG(state => {
      const context = state.tabs[String(tabId)];
      if (!context) return;
      const session = state.sessions[context.sessionId];
      if (session) {
        settleSearchSessionBG(session);
        session.foregroundTabIds = (
          session.foregroundTabIds || []
        ).filter(id => id !== tabId);
      }
      delete state.tabs[String(tabId)];
    });
  });
}

async function reconnectSearchMediaTabsBG() {
  if (
    typeof chrome.tabs?.query !== 'function' ||
    typeof chrome.scripting?.executeScript !== 'function'
  ) {
    return { attempted: 0, connected: 0 };
  }

  const tabs = await chrome.tabs.query({
    url: SEARCH_MEDIA_TAB_PATTERNS_BG,
  });
  let connected = 0;
  for (const tab of tabs) {
    if (!Number.isInteger(tab.id) || tab.discarded) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        files: SEARCH_MEDIA_SCRIPT_FILES_BG,
      });
      connected += 1;
    } catch (error) {
      // 正在关闭、未授权或浏览器限制的标签允许跳过。
    }
  }
  return { attempted: tabs.length, connected };
}

chrome.runtime?.onInstalled?.addListener(() => {
  void reconnectSearchMediaTabsBG();
});

chrome.runtime?.onStartup?.addListener(() => {
  void reconnectSearchMediaTabsBG();
});

const UA_PRESETS_BG = {
  desktop: {
    chrome_windows:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    chrome_mac:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    edge_windows:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    firefox_windows:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  },
  mobile: {
    iphone_safari:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    iphone_chrome:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
    android_chrome:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    android_firefox:
      'Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0',
  },
};

const DEFAULT_UA_RULES_BG = {
  'bilibili.com': {
    enabled: true,
    uaMode: 'desktop',
    presetKey: 'chrome_windows',
    customUA: null,
    uiTransform: true,
  },
  'douyin.com': {
    enabled: true,
    uaMode: 'desktop',
    presetKey: 'chrome_windows',
    customUA: null,
    uiTransform: true,
  },
  'youtube.com': {
    enabled: true,
    uaMode: 'mobile',
    presetKey: 'android_chrome',
    customUA: null,
    uiTransform: false,
  },
  'google.com': {
    enabled: true,
    uaMode: 'desktop',
    presetKey: 'chrome_windows',
    customUA: null,
    uiTransform: false,
  },
  'xiaohongshu.com': {
    enabled: true,
    uaMode: 'mobile',
    presetKey: 'iphone_safari',
    customUA: null,
    uiTransform: false,
  },
};

function tabMatchesDomainBG(url, domain) {
  const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const domainPattern = new RegExp('^https?:\\/\\/(?:[^/?#]+\\.)?' + escapedDomain + '(?=[:/?#]|$)', 'i');
  return typeof url === 'string' && domainPattern.test(url);
}

const LIVE_RULE_FIELDS_BG = ['enabled', 'uaMode', 'presetKey', 'customUA', 'uiTransform'];

function effectiveRuleSignatureBG(rule, globalEnabled) {
  if (!globalEnabled || !rule || !rule.enabled) return null;
  return LIVE_RULE_FIELDS_BG.map((field) => rule[field] ?? null).join('\u0000');
}

function changedEffectiveDomainsBG(previousRules, previousGlobalEnabled, nextRules, nextGlobalEnabled) {
  const domains = new Set([
    ...Object.keys(previousRules || {}),
    ...Object.keys(nextRules || {}),
  ]);
  return Array.from(domains).filter((domain) => (
    effectiveRuleSignatureBG(previousRules?.[domain], previousGlobalEnabled) !==
    effectiveRuleSignatureBG(nextRules?.[domain], nextGlobalEnabled)
  ));
}

async function reloadOpenMatchingTabsBG(domains) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id == null) continue;
    if (domains.some((domain) => tabMatchesDomainBG(tab.url, domain))) {
      await chrome.tabs.reload(tab.id);
    }
  }
}

// ============================================
// UA 解析
// ============================================

function resolveUA_BG(rule) {
  if (!rule || !rule.enabled) return null;

  if (rule.uaMode === 'custom' && rule.customUA) {
    return rule.customUA;
  }

  const presetKey = rule.presetKey || 'chrome_windows';
  const modeGroup = UA_PRESETS_BG[rule.uaMode];
  if (modeGroup && modeGroup[presetKey]) {
    return modeGroup[presetKey];
  }
  if (modeGroup) {
    return Object.values(modeGroup)[0];
  }
  return null;
}

// ============================================
// Chrome MV3: declarativeNetRequest 动态规则管理
// ============================================

let ruleIdCounter = 1;

/**
 * 将 UA 规则转换为 declarativeNetRequest 动态规则
 * @param {object} uaRules - UA 规则对象
 * @param {boolean} globalEnabled - 全局启用状态
 * @returns {Array} declarativeNetRequest 规则数组
 */
function buildDynamicRules(uaRules, globalEnabled) {
  const rules = [];
  let id = 1;

  for (const [domain, rule] of Object.entries(uaRules)) {
    if (!rule.enabled || !globalEnabled) continue;

    const uaString = resolveUA_BG(rule);
    if (!uaString) continue;

    rules.push({
      id: id++,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'User-Agent', operation: 'set', value: uaString },
        ],
      },
      condition: {
        // DNR domain anchor covers both the bare domain and all subdomains,
        // without leaking onto lookalikes such as notexample.com.
        urlFilter: `||${domain}^`,
        resourceTypes: [
          'main_frame',
          'sub_frame',
          'xmlhttprequest',
          'websocket',
          'image',
          'stylesheet',
          'script',
          'font',
          'other',
        ],
      },
    });
  }

  ruleIdCounter = id;
  return rules;
}

/**
 * 应用动态规则到 Chrome
 * @param {object} uaRules
 * @param {boolean} globalEnabled
 */
async function applyDynamicRules(uaRules, globalEnabled) {
  try {
    // 获取现有动态规则的 ID
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingIds = existingRules.map((r) => r.id);

    // 构建新规则
    const newRules = buildDynamicRules(uaRules, globalEnabled);

    // 更新规则
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingIds,
      addRules: newRules,
    });

    console.log(
      `[UA Controller] 已更新 ${newRules.length} 条 UA 规则`,
      newRules.map((r) => ({
        id: r.id,
        domain: r.condition.urlFilter,
        ua: r.action.requestHeaders[0].value.substring(0, 50) + '...',
      }))
    );
  } catch (e) {
    console.error('[UA Controller] 更新动态规则失败:', e);
  }
}

// ============================================
// Firefox: webRequest.onBeforeSendHeaders
// ============================================

function setupFirefoxWebRequest() {
  if (
    typeof browser !== 'undefined' &&
    browser.webRequest &&
    browser.webRequest.onBeforeSendHeaders
  ) {
    browser.webRequest.onBeforeSendHeaders.addListener(
      (details) => {
        return handleRequestFirefox(details);
      },
      { urls: ['<all_urls>'] },
      ['blocking', 'requestHeaders']
    );
    console.log('[UA Controller] Firefox webRequest 模式已启用');
  }
}

async function handleRequestFirefox(details) {
  try {
    const globalEnabled = await getGlobalEnabledBG();
    if (!globalEnabled) return { requestHeaders: details.requestHeaders };

    const rules = await getUARulesBG();
    for (const [domain, rule] of Object.entries(rules)) {
      if (!rule.enabled) continue;
      if (!details.url.includes(domain)) continue;

      const uaString = resolveUA_BG(rule);
      if (!uaString) continue;

      for (const header of details.requestHeaders) {
        if (header.name.toLowerCase() === 'user-agent') {
          header.value = uaString;
          break;
        }
      }
      return { requestHeaders: details.requestHeaders };
    }
  } catch (e) {
    console.error('[UA Controller] Firefox 请求处理失败:', e);
  }
  return { requestHeaders: details.requestHeaders };
}

// ============================================
// 配置读写（Background 专用）
// ============================================

function cloneUARulesBG(rules) {
  return Object.fromEntries(
    Object.entries(rules || {}).map(([domain, rule]) => [domain, { ...(rule || {}) }])
  );
}

async function getUARulesBG() {
  const data = await chrome.storage.local.get(STORAGE_KEYS_BG.UA_RULES);
  return cloneUARulesBG(data[STORAGE_KEYS_BG.UA_RULES] || DEFAULT_UA_RULES_BG);
}

async function getGlobalEnabledBG() {
  const data = await chrome.storage.local.get(STORAGE_KEYS_BG.GLOBAL_ENABLED);
  return data[STORAGE_KEYS_BG.GLOBAL_ENABLED] !== false;
}

// ============================================
// 内容阻断规则与行为统计（Phase 1）
// ============================================

function normalizeBlockingListBG(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)));
}

async function getBlockingRulesBG() {
  const data = await chrome.storage.local.get(Object.values(BLOCKING_STORAGE_KEYS_BG));
  const storedHighRiskDomains = normalizeBlockingListBG(
    data[BLOCKING_STORAGE_KEYS_BG.HIGH_RISK_DOMAINS]
  );
  const highRiskDomains = normalizeBlockingListBG([
    ...DEFAULT_HIGH_RISK_DOMAINS_BG,
    ...storedHighRiskDomains,
  ]);

  if (
    highRiskDomains.length !== storedHighRiskDomains.length ||
    highRiskDomains.some(
      (domain, index) => domain !== storedHighRiskDomains[index]
    )
  ) {
    await chrome.storage.local.set({
      [BLOCKING_STORAGE_KEYS_BG.HIGH_RISK_DOMAINS]:
        highRiskDomains,
    });
  }

  return {
    blockedKeywords: normalizeBlockingListBG(data[BLOCKING_STORAGE_KEYS_BG.KEYWORDS]),
    blockedUrlPatterns: normalizeBlockingListBG(data[BLOCKING_STORAGE_KEYS_BG.URL_PATTERNS]),
    highRiskDomains,
  };
}

function normalizeBlockingPolicyBG(value) {
  const source = value && typeof value === 'object' ? value : {};
  if (
    source.schemaVersion !== undefined &&
    source.schemaVersion !== 1
  ) {
    throw new Error('阻断策略版本不受支持');
  }

  const normalize = (items, label) => {
    if (items === undefined) return [];
    if (!Array.isArray(items)) throw new Error(`${label} 必须是数组`);
    return normalizeBlockingListBG(items).map(item => {
      if (item.length > 4096) throw new Error(`${label} 条目过长`);
      return item;
    });
  };

  return {
    schemaVersion: 1,
    blockedKeywords: normalize(
      source.blockedKeywords,
      'blockedKeywords'
    ),
    blockedUrlPatterns: normalize(
      source.blockedUrlPatterns,
      'blockedUrlPatterns'
    ),
    highRiskDomains: normalize(
      source.highRiskDomains,
      'highRiskDomains'
    ),
  };
}

async function importBlockingPolicyBG(value) {
  const incoming = normalizeBlockingPolicyBG(value);
  const current = await getBlockingRulesBG();
  const merged = {
    blockedKeywords: normalizeBlockingListBG([
      ...current.blockedKeywords,
      ...incoming.blockedKeywords,
    ]),
    blockedUrlPatterns: normalizeBlockingListBG([
      ...current.blockedUrlPatterns,
      ...incoming.blockedUrlPatterns,
    ]),
    highRiskDomains: normalizeBlockingListBG([
      ...current.highRiskDomains,
      ...incoming.highRiskDomains,
    ]),
  };
  await chrome.storage.local.set({
    [BLOCKING_STORAGE_KEYS_BG.KEYWORDS]: merged.blockedKeywords,
    [BLOCKING_STORAGE_KEYS_BG.URL_PATTERNS]:
      merged.blockedUrlPatterns,
    [BLOCKING_STORAGE_KEYS_BG.HIGH_RISK_DOMAINS]:
      merged.highRiskDomains,
  });
  return merged;
}

async function exportBlockingPolicyBG() {
  return {
    schemaVersion: 1,
    ...(await getBlockingRulesBG()),
  };
}

async function addBlockingRuleBG(value, scope) {
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedValue) throw new Error('阻断规则不能为空');
  if (!['keyword', 'url', 'both'].includes(scope)) throw new Error('阻断规则类型无效');

  const current = await getBlockingRulesBG();
  const next = {
    blockedKeywords: [...current.blockedKeywords],
    blockedUrlPatterns: [...current.blockedUrlPatterns],
    highRiskDomains: [...current.highRiskDomains],
  };
  if (scope === 'keyword' || scope === 'both') {
    if (!next.blockedKeywords.includes(normalizedValue)) next.blockedKeywords.push(normalizedValue);
  }
  if (scope === 'url' || scope === 'both') {
    if (!next.blockedUrlPatterns.includes(normalizedValue)) next.blockedUrlPatterns.push(normalizedValue);
  }
  await chrome.storage.local.set({
    [BLOCKING_STORAGE_KEYS_BG.KEYWORDS]: next.blockedKeywords,
    [BLOCKING_STORAGE_KEYS_BG.URL_PATTERNS]: next.blockedUrlPatterns,
    [BLOCKING_STORAGE_KEYS_BG.HIGH_RISK_DOMAINS]: next.highRiskDomains,
  });
  return next;
}

let blockingStatsDbPromiseBG = null;

function openBlockingStatsDBBG() {
  if (blockingStatsDbPromiseBG) return blockingStatsDbPromiseBG;
  blockingStatsDbPromiseBG = new Promise((resolve, reject) => {
    const request = indexedDB.open(BLOCKING_STATS_DB_BG, BLOCKING_STATS_DB_VERSION_BG);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(BLOCKING_STATS_STORE_BG)) return;
      const store = db.createObjectStore(BLOCKING_STATS_STORE_BG, { keyPath: 'id' });
      store.createIndex('type', 'type', { unique: false });
      store.createIndex('timestamp', 'timestamp', { unique: false });
      store.createIndex('keyword', 'keyword', { unique: false });
      store.createIndex('domain', 'domain', { unique: false });
      store.createIndex('sessionId', 'sessionId', { unique: false });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => {
      blockingStatsDbPromiseBG = null;
      reject(request.error || new Error('无法打开阻断统计数据库'));
    };
  });
  return blockingStatsDbPromiseBG;
}

function normalizeBlockingEventBG(event) {
  const source = event && typeof event === 'object' ? event : {};
  const type = [
    'exposure',
    'click',
    'feedback',
    'attemptedDepth3Navigation',
  ].includes(source.type) ? source.type : null;
  if (!type) throw new Error('阻断统计事件类型无效');
  return {
    id: String(source.id || `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 200),
    type,
    keyword: String(source.keyword || '').slice(0, 500),
    urlPattern: String(source.urlPattern || '').slice(0, 500),
    domain: String(source.domain || '').slice(0, 253),
    timestamp: Number.isFinite(source.timestamp) ? source.timestamp : Date.now(),
    sessionId: String(source.sessionId || '').slice(0, 200),
    feedbackType: String(source.feedbackType || '').slice(0, 40),
    fromContentId: String(source.fromContentId || '').slice(0, 500),
    toContentId: String(source.toContentId || '').slice(0, 500),
    nextBlockedAttemptInterval: Number.isFinite(source.nextBlockedAttemptInterval)
      ? source.nextBlockedAttemptInterval
      : null,
    whetherRetriedWithin10Minutes: typeof source.whetherRetriedWithin10Minutes === 'boolean'
      ? source.whetherRetriedWithin10Minutes
      : null,
  };
}

async function recordBlockingEventBG(event) {
  const db = await openBlockingStatsDBBG();
  const record = normalizeBlockingEventBG(event);
  await new Promise((resolve, reject) => {
    const request = db.transaction(BLOCKING_STATS_STORE_BG, 'readwrite')
      .objectStore(BLOCKING_STATS_STORE_BG).put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('保存阻断统计失败'));
  });
  return record;
}

async function updateFeedbackOutcomeBG(eventId, interval, retried) {
  if (!eventId) return false;
  const db = await openBlockingStatsDBBG();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(BLOCKING_STATS_STORE_BG, 'readwrite');
    const store = transaction.objectStore(BLOCKING_STATS_STORE_BG);
    const request = store.get(String(eventId));
    request.onsuccess = () => {
      const record = request.result;
      if (!record || record.type !== 'feedback') {
        resolve(false);
        return;
      }
      record.nextBlockedAttemptInterval = Number.isFinite(interval) ? interval : null;
      record.whetherRetriedWithin10Minutes = typeof retried === 'boolean' ? retried : null;
      store.put(record);
      resolve(true);
    };
    request.onerror = () => reject(request.error || new Error('更新反馈统计失败'));
  });
}

async function getBlockingEventsSinceBG(timestamp) {
  const db = await openBlockingStatsDBBG();
  return new Promise((resolve, reject) => {
    const request = db.transaction(BLOCKING_STATS_STORE_BG, 'readonly')
      .objectStore(BLOCKING_STATS_STORE_BG).index('timestamp')
      .getAll(IDBKeyRange.lowerBound(timestamp));
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('读取阻断统计失败'));
  });
}

function startOfDayBG(timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function aggregateBlockingStatsBG(events, start, end) {
  const selected = events.filter((event) => event.timestamp >= start && event.timestamp < end);
  const exposures = selected.filter((event) => event.type === 'exposure');
  const clicks = selected.filter((event) => event.type === 'click');
  const feedbacks = selected.filter((event) => event.type === 'feedback');
  const attempts = selected.filter(event =>
    event.type === 'click' ||
    event.type === 'attemptedDepth3Navigation'
  );
  const attemptedDepth3Navigations = selected.filter(
    event => event.type === 'attemptedDepth3Navigation'
  );
  const group = (key) => {
    const map = new Map();
    for (const event of selected) {
      const value = event[key] || '（未标记）';
      if (!map.has(value)) map.set(value, { exposure: 0, click: 0 });
      if (event.type === 'exposure') map.get(value).exposure += 1;
      if (event.type === 'click') map.get(value).click += 1;
    }
    return Object.fromEntries(Array.from(map.entries()).map(([value, count]) => [value, {
      ...count,
      attemptedClickRate: count.exposure ? count.click / count.exposure : 0,
    }]));
  };
  const feedbackByType = {};
  for (const event of feedbacks) {
    const type = event.feedbackType || 'unknown';
    const item = feedbackByType[type] || { count: 0, retriedWithin10Minutes: 0, measured: 0 };
    item.count += 1;
    const laterAttempt = attempts.find(attempt =>
      attempt.sessionId &&
      attempt.sessionId === event.sessionId &&
      attempt.timestamp > event.timestamp &&
      attempt.timestamp - event.timestamp <= 10 * 60 * 1000
    );
    const measuredOutcome =
      typeof event.whetherRetriedWithin10Minutes === 'boolean'
        ? event.whetherRetriedWithin10Minutes
        : laterAttempt
          ? true
          : end - event.timestamp >= 10 * 60 * 1000
            ? false
            : null;
    if (typeof measuredOutcome === 'boolean') {
      item.measured += 1;
      if (measuredOutcome) item.retriedWithin10Minutes += 1;
    }
    feedbackByType[type] = item;
  }
  return {
    blockedExposureCount: exposures.length,
    attemptedBlockedClickCount: clicks.length,
    attemptedDepth3Navigation: attemptedDepth3Navigations.length,
    attemptedClickRate: exposures.length ? clicks.length / exposures.length : 0,
    byKeyword: group('keyword'),
    byDomain: group('domain'),
    feedbackByType,
  };
}

async function getBlockingStatsBG() {
  const end = Date.now() + 1;
  const today = startOfDayBG(end);
  const sevenDaysAgo = end - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = end - 30 * 24 * 60 * 60 * 1000;
  const events = await getBlockingEventsSinceBG(Math.min(today, thirtyDaysAgo));
  const dailyTrend = [];
  for (let index = 29; index >= 0; index -= 1) {
    const start = startOfDayBG(end - index * 24 * 60 * 60 * 1000);
    const aggregate = aggregateBlockingStatsBG(events, start, start + 24 * 60 * 60 * 1000);
    dailyTrend.push({
      date: new Date(start).toISOString().slice(0, 10),
      blockedExposureCount: aggregate.blockedExposureCount,
      attemptedBlockedClickCount: aggregate.attemptedBlockedClickCount,
      attemptedClickRate: aggregate.attemptedClickRate,
    });
  }
  return {
    today: aggregateBlockingStatsBG(events, today, end),
    last7Days: aggregateBlockingStatsBG(events, sevenDaysAgo, end),
    last30Days: aggregateBlockingStatsBG(events, thirtyDaysAgo, end),
    dailyTrend,
  };
}

// ============================================
// 消息处理（与 Popup / Options 通信）
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // 保持消息通道开放（异步 sendResponse）
});

async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      case 'GET_STATUS': {
        const rules = await getUARulesBG();
        const globalEnabled = await getGlobalEnabledBG();
        sendResponse({ rules, globalEnabled });
        break;
      }

      case 'GET_BLOCKING_RULES': {
        sendResponse({ success: true, rules: await getBlockingRulesBG() });
        break;
      }

      case 'IMPORT_BLOCKING_POLICY': {
        const rules = await importBlockingPolicyBG(message.policy);
        sendResponse({ success: true, rules });
        break;
      }

      case 'EXPORT_BLOCKING_POLICY': {
        sendResponse({
          success: true,
          policy: await exportBlockingPolicyBG(),
        });
        break;
      }

      case 'RECONNECT_SEARCH_MEDIA_TABS': {
        sendResponse({
          success: true,
          ...(await reconnectSearchMediaTabsBG()),
        });
        break;
      }

      case 'START_SEARCH_SESSION': {
        sendResponse({
          success: true,
          ...(await startSearchSessionBG(sender, message.targetUrl)),
        });
        break;
      }

      case 'OPEN_SEARCH_RESULT': {
        sendResponse({
          success: true,
          ...(await openSearchResultBG(
            sender,
            message.keyword,
            message.targetUrl
          )),
        });
        break;
      }

      case 'GET_SEARCH_SESSION_CONTEXT': {
        sendResponse({
          success: true,
          ...(await getSearchSessionContextBG(sender)),
        });
        break;
      }

      case 'UPDATE_SEARCH_SESSION_CONTEXT': {
        sendResponse({
          success: true,
          ...(await updateSearchSessionContextBG(sender, message)),
        });
        break;
      }

      case 'SET_SEARCH_SESSION_FOREGROUND': {
        sendResponse({
          success: true,
          ...(await updateSearchSessionForegroundBG(
            sender,
            message.visible === true
          )),
        });
        break;
      }

      case 'ADD_BLOCKING_RULE': {
        const rules = await addBlockingRuleBG(message.value, message.scope);
        sendResponse({ success: true, rules });
        break;
      }

      case 'RECORD_BLOCKING_EVENT': {
        const event = await recordBlockingEventBG(message.event);
        sendResponse({ success: true, eventId: event.id });
        break;
      }

      case 'UPDATE_FEEDBACK_OUTCOME': {
        const updated = await updateFeedbackOutcomeBG(
          message.eventId,
          message.nextBlockedAttemptInterval,
          message.whetherRetriedWithin10Minutes
        );
        sendResponse({ success: true, updated });
        break;
      }

      case 'GET_BLOCKING_STATS': {
        sendResponse({ success: true, stats: await getBlockingStatsBG() });
        break;
      }

      case 'TOGGLE_GLOBAL': {
        const previousState = await getGlobalEnabledBG();
        const newState = message.enabled;
        await chrome.storage.local.set({
          [STORAGE_KEYS_BG.GLOBAL_ENABLED]: newState,
        });
        const rules = await getUARulesBG();
        await applyDynamicRules(rules, newState);
        if (previousState !== newState) {
          await reloadOpenMatchingTabsBG(changedEffectiveDomainsBG(
            rules, previousState, rules, newState
          ));
        }
        sendResponse({ success: true });
        break;
      }

      case 'UPDATE_RULE': {
        const { domain, rule } = message;
        const rules = await getUARulesBG();
        const previousRule = rules[domain] || {};
        rules[domain] = { ...previousRule, ...rule };
        await chrome.storage.local.set({
          [STORAGE_KEYS_BG.UA_RULES]: rules,
        });
        const globalEnabled = await getGlobalEnabledBG();
        await applyDynamicRules(rules, globalEnabled);
        const liveBehaviorChanged = globalEnabled && LIVE_RULE_FIELDS_BG.some((field) => (
          Object.prototype.hasOwnProperty.call(rule, field) &&
          rule[field] !== previousRule[field]
        ));
        if (liveBehaviorChanged) {
          await reloadOpenMatchingTabsBG([domain]);
        }
        sendResponse({ success: true });
        break;
      }

      case 'DELETE_RULE': {
        const { domain } = message;
        const rules = await getUARulesBG();
        const previousRules = { ...rules };
        delete rules[domain];
        await chrome.storage.local.set({
          [STORAGE_KEYS_BG.UA_RULES]: rules,
        });
        const globalEnabled = await getGlobalEnabledBG();
        await applyDynamicRules(rules, globalEnabled);
        if (globalEnabled) {
          await reloadOpenMatchingTabsBG(changedEffectiveDomainsBG(
            previousRules, globalEnabled, rules, globalEnabled
          ));
        }
        sendResponse({ success: true });
        break;
      }

      case 'IMPORT_RULES': {
        const imported = message.rules;
        const currentRules = await getUARulesBG();
        const merged = { ...currentRules, ...imported };
        await chrome.storage.local.set({
          [STORAGE_KEYS_BG.UA_RULES]: merged,
        });
        const globalEnabled = await getGlobalEnabledBG();
        await applyDynamicRules(merged, globalEnabled);
        if (globalEnabled) {
          await reloadOpenMatchingTabsBG(changedEffectiveDomainsBG(
            currentRules, globalEnabled, merged, globalEnabled
          ));
        }
        sendResponse({ success: true, rules: merged });
        break;
      }

      case 'EXPORT_RULES': {
        const rules = await getUARulesBG();
        const globalEnabled = await getGlobalEnabledBG();
        sendResponse({
          version: '1.0.0',
          exportTime: new Date().toISOString(),
          globalEnabled,
          uaRules: rules,
        });
        break;
      }

      case 'RESET_RULES': {
        const previousRules = await getUARulesBG();
        const previousGlobalEnabled = await getGlobalEnabledBG();
        const defaultRules = cloneUARulesBG(DEFAULT_UA_RULES_BG);
        await chrome.storage.local.set({
          [STORAGE_KEYS_BG.UA_RULES]: defaultRules,
          [STORAGE_KEYS_BG.GLOBAL_ENABLED]: true,
        });
        await applyDynamicRules(defaultRules, true);
        await reloadOpenMatchingTabsBG(changedEffectiveDomainsBG(
          previousRules,
          previousGlobalEnabled,
          defaultRules,
          true
        ));
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ error: 'Unknown message type: ' + message.type });
    }
  } catch (e) {
    console.error('[UA Controller] 消息处理失败:', e);
    sendResponse({ error: e.message });
  }
}

// ============================================
// 存储变更监听
// ============================================

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes[STORAGE_KEYS_BG.UA_RULES] || changes[STORAGE_KEYS_BG.GLOBAL_ENABLED]) {
    console.log('[UA Controller] 配置已变更，重新加载规则');
    initRules();
  }
});

// ============================================
// 初始化
// ============================================

async function initRules() {
  const rules = await getUARulesBG();
  const globalEnabled = await getGlobalEnabledBG();
  await applyDynamicRules(rules, globalEnabled);
}

// 启动
initRules();
setupFirefoxWebRequest();

console.log('[UA Controller] Service Worker 已启动');
