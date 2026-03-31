/**
 * MySearchPage UA Controller - 工具函数
 */

/**
 * 从 URL 中提取主域名
 * 例: https://search.bilibili.com/all?keyword=test → bilibili.com
 * @param {string} url - 完整 URL
 * @returns {string|null} 主域名
 */
function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    // 处理子域名：search.bilibili.com → bilibili.com
    const parts = hostname.split('.');
    if (parts.length > 2) {
      return parts.slice(-2).join('.');
    }
    return hostname;
  } catch (e) {
    return null;
  }
}

/**
 * 根据 uaMode 和 presetKey 获取 UA 字符串
 * @param {object} rule - UA 规则对象
 * @returns {string} UA 字符串
 */
function resolveUA(rule) {
  if (!rule || !rule.enabled) {
    return null; // null 表示不修改
  }

  if (rule.uaMode === 'custom' && rule.customUA) {
    return rule.customUA;
  }

  const presetKey = rule.presetKey || 'chrome_windows';
  const modeGroup = UA_PRESETS[rule.uaMode];
  if (modeGroup && modeGroup[presetKey]) {
    return modeGroup[presetKey];
  }

  // 降级：返回该模式的第一个预设
  if (modeGroup) {
    return Object.values(modeGroup)[0];
  }

  return null;
}

/**
 * 匹配 URL 是否符合规则域名
 * @param {string} url - 请求 URL
 * @param {string} ruleDomain - 规则中的域名（如 bilibili.com）
 * @returns {boolean}
 */
function matchDomain(url, ruleDomain) {
  const domain = extractDomain(url);
  if (!domain) return false;
  return domain === ruleDomain || domain.endsWith('.' + ruleDomain);
}

/**
 * 深度合并对象
 * @param {object} target - 目标对象
 * @param {object} source - 源对象
 * @returns {object} 合并后的对象
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key])
    ) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
