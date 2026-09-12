/**
 * MySearchPage - 内容阻断规则基础能力
 *
 * 三类规则始终独立保存、独立匹配：
 * - blockedKeywords：文本内容
 * - blockedUrlPatterns：URL 字符串
 * - highRiskDomains：高风险网站域名（Phase 2 使用）
 */
(function attachBlockingRules(global) {
  'use strict';

  const STORAGE_KEYS = Object.freeze({
    KEYWORDS: 'blockedKeywords',
    URL_PATTERNS: 'blockedUrlPatterns',
    HIGH_RISK_DOMAINS: 'highRiskDomains',
  });

  function normalizeList(value) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)));
  }

  function normalizeRules(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      blockedKeywords: normalizeList(source.blockedKeywords),
      blockedUrlPatterns: normalizeList(source.blockedUrlPatterns),
      highRiskDomains: normalizeList(source.highRiskDomains),
    };
  }

  function appendUnique(list, value) {
    const normalized = String(value ?? '').trim();
    const current = normalizeList(list);
    if (normalized && !current.includes(normalized)) current.push(normalized);
    return current;
  }

  function isUnknownMessageResponse(response, messageType) {
    return response?.success !== true &&
      response?.error === `Unknown message type: ${messageType}`;
  }

  function isUnknownAddRuleResponse(response) {
    return isUnknownMessageResponse(response, 'ADD_BLOCKING_RULE');
  }

  function ensureStorageArea(storageArea) {
    if (
      !storageArea ||
      typeof storageArea.get !== 'function' ||
      typeof storageArea.set !== 'function'
    ) {
      throw new Error('阻断规则存储不可用');
    }
    return storageArea;
  }

  async function getRulesFromStorage(
    storageArea = global.chrome?.storage?.local
  ) {
    const storage = ensureStorageArea(storageArea);
    const stored = await storage.get(Object.values(STORAGE_KEYS));
    return normalizeRules(stored);
  }

  async function importPolicyToStorage(
    value,
    storageArea = global.chrome?.storage?.local
  ) {
    const source = value && typeof value === 'object' ? value : {};
    if (
      source.schemaVersion !== undefined &&
      source.schemaVersion !== 1
    ) {
      throw new Error('阻断策略版本不受支持');
    }

    const normalizePolicyList = (items, label) => {
      if (items === undefined) return [];
      if (!Array.isArray(items)) {
        throw new Error(`${label} 必须是数组`);
      }
      const normalized = normalizeList(items);
      if (normalized.some(item => item.length > 4096)) {
        throw new Error(`${label} 条目过长`);
      }
      return normalized;
    };

    const incoming = {
      blockedKeywords: normalizePolicyList(
        source.blockedKeywords,
        'blockedKeywords'
      ),
      blockedUrlPatterns: normalizePolicyList(
        source.blockedUrlPatterns,
        'blockedUrlPatterns'
      ),
      highRiskDomains: normalizePolicyList(
        source.highRiskDomains,
        'highRiskDomains'
      ),
    };
    const storage = ensureStorageArea(storageArea);
    const current = await getRulesFromStorage(storage);
    const merged = {
      blockedKeywords: normalizeList([
        ...current.blockedKeywords,
        ...incoming.blockedKeywords,
      ]),
      blockedUrlPatterns: normalizeList([
        ...current.blockedUrlPatterns,
        ...incoming.blockedUrlPatterns,
      ]),
      highRiskDomains: normalizeList([
        ...current.highRiskDomains,
        ...incoming.highRiskDomains,
      ]),
    };
    await storage.set(merged);
    return merged;
  }

  async function addRuleToStorage(
    value,
    scope,
    storageArea = global.chrome?.storage?.local
  ) {
    const normalizedValue = String(value ?? '').trim();
    if (!normalizedValue) throw new Error('阻断规则不能为空');
    if (!['keyword', 'url', 'both'].includes(scope)) {
      throw new Error('阻断规则类型无效');
    }
    ensureStorageArea(storageArea);

    const stored = await storageArea.get([
      STORAGE_KEYS.KEYWORDS,
      STORAGE_KEYS.URL_PATTERNS,
      STORAGE_KEYS.HIGH_RISK_DOMAINS,
    ]);
    const next = normalizeRules(stored);
    if (scope === 'keyword' || scope === 'both') {
      next.blockedKeywords =
        appendUnique(next.blockedKeywords, normalizedValue);
    }
    if (scope === 'url' || scope === 'both') {
      next.blockedUrlPatterns =
        appendUnique(next.blockedUrlPatterns, normalizedValue);
    }

    await storageArea.set(next);
    return next;
  }

  function findKeyword(text, keywords) {
    if (typeof text !== 'string' || !text) return null;
    for (const keyword of normalizeList(keywords)) {
      if (text.includes(keyword)) return keyword;
    }
    return null;
  }

  function findUrlPattern(url, patterns) {
    if (typeof url !== 'string' || !url) return null;
    for (const pattern of normalizeList(patterns)) {
      if (url.includes(pattern)) return pattern;
    }
    return null;
  }

  global.MySearchBlockingRules = Object.freeze({
    STORAGE_KEYS,
    normalizeList,
    normalizeRules,
    appendUnique,
    isUnknownMessageResponse,
    isUnknownAddRuleResponse,
    getRulesFromStorage,
    importPolicyToStorage,
    addRuleToStorage,
    findKeyword,
    findUrlPattern,
  });
})(globalThis);
