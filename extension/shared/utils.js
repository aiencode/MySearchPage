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
    const hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    // IP 和本地主机本身就是可匹配主机，不能按标签截断。
    if (
      hostname === 'localhost' ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
      hostname.includes(':')
    ) {
      return hostname;
    }

    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;

    // 当前扩展不引入公共后缀库；覆盖导航配置及常见的二级公共后缀，
    // 避免把 www.google.com.hk 错归为 com.hk。
    const multiLabelPublicSuffixes = new Set([
      'com.hk', 'com.cn', 'net.cn', 'org.cn', 'gov.cn',
      'com.au', 'net.au', 'org.au',
      'co.uk', 'org.uk', 'ac.uk',
      'co.jp', 'ne.jp', 'co.kr',
      'com.sg', 'com.tw', 'com.br', 'com.mx',
      'co.nz', 'co.in', 'com.tr',
    ]);
    const lastTwo = parts.slice(-2).join('.');
    return parts.slice(multiLabelPublicSuffixes.has(lastTwo) ? -3 : -2).join('.');
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
