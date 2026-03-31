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
        urlFilter: `*://*.${domain}/*`,
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

async function getUARulesBG() {
  const data = await chrome.storage.local.get(STORAGE_KEYS_BG.UA_RULES);
  return data[STORAGE_KEYS_BG.UA_RULES] || DEFAULT_UA_RULES_BG;
}

async function getGlobalEnabledBG() {
  const data = await chrome.storage.local.get(STORAGE_KEYS_BG.GLOBAL_ENABLED);
  return data[STORAGE_KEYS_BG.GLOBAL_ENABLED] !== false;
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

      case 'TOGGLE_GLOBAL': {
        const newState = message.enabled;
        await chrome.storage.local.set({
          [STORAGE_KEYS_BG.GLOBAL_ENABLED]: newState,
        });
        const rules = await getUARulesBG();
        await applyDynamicRules(rules, newState);
        sendResponse({ success: true });
        break;
      }

      case 'UPDATE_RULE': {
        const { domain, rule } = message;
        const rules = await getUARulesBG();
        rules[domain] = { ...(rules[domain] || {}), ...rule };
        await chrome.storage.local.set({
          [STORAGE_KEYS_BG.UA_RULES]: rules,
        });
        const globalEnabled = await getGlobalEnabledBG();
        await applyDynamicRules(rules, globalEnabled);
        sendResponse({ success: true });
        break;
      }

      case 'DELETE_RULE': {
        const { domain } = message;
        const rules = await getUARulesBG();
        delete rules[domain];
        await chrome.storage.local.set({
          [STORAGE_KEYS_BG.UA_RULES]: rules,
        });
        const globalEnabled = await getGlobalEnabledBG();
        await applyDynamicRules(rules, globalEnabled);
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
        await chrome.storage.local.set({
          [STORAGE_KEYS_BG.UA_RULES]: { ...DEFAULT_UA_RULES_BG },
          [STORAGE_KEYS_BG.GLOBAL_ENABLED]: true,
        });
        await applyDynamicRules(DEFAULT_UA_RULES_BG, true);
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
