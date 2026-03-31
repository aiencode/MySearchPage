/**
 * MySearchPage UA Controller - 常量定义
 */

// UA 预设字符串
const UA_PRESETS = {
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

// 默认 UA 规则
const DEFAULT_UA_RULES = {
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

// 存储键名
const STORAGE_KEYS = {
  UA_RULES: 'uaRules',
  GLOBAL_ENABLED: 'globalEnabled',
  SETTINGS: 'settings',
};

// UA 模式枚举
const UA_MODES = {
  DESKTOP: 'desktop',
  MOBILE: 'mobile',
  CUSTOM: 'custom',
};
