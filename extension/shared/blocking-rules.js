/**
 * MySearchPage - 内容阻断规则基础能力
 *
 * 三类规则始终独立保存、独立匹配：
 * - blockedKeywords：结果标题/描述等文本内容
 * - blockedUrlPatterns：URL 字符串
 * - blockedAuthors：结果作者字段
 * - highRiskDomains：高风险网站域名（Phase 2 使用）
 */
(function attachBlockingRules(global) {
  'use strict';

  const STORAGE_KEYS = Object.freeze({
    KEYWORDS: 'blockedKeywords',
    URL_PATTERNS: 'blockedUrlPatterns',
    AUTHORS: 'blockedAuthors',
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
      blockedAuthors: normalizeList(source.blockedAuthors),
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

  async function getSearchRulesFromStorage(storageArea = global.chrome?.storage?.local) {
    const storage = ensureStorageArea(storageArea);
    const stored = await storage.get([...Object.values(STORAGE_KEYS), 'uaRules']);
    return { ...normalizeRules(stored), homepageRules: stored.uaRules || {} };
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
      blockedAuthors: normalizePolicyList(
        source.blockedAuthors,
        'blockedAuthors'
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
      blockedAuthors: normalizeList([
        ...current.blockedAuthors,
        ...incoming.blockedAuthors,
      ]),
      highRiskDomains: normalizeList([
        ...current.highRiskDomains,
        ...incoming.highRiskDomains,
      ]),
    };
    await storage.set(merged);
    return merged;
  }

  async function replaceRulesInStorage(
    value,
    storageArea = global.chrome?.storage?.local
  ) {
    const source = value && typeof value === 'object' ? value : {};
    if (source.schemaVersion !== undefined && source.schemaVersion !== 1) {
      throw new Error('阻断策略版本不受支持');
    }
    const normalizeRequiredList = (items, label) => {
      if (!Array.isArray(items)) throw new Error(`${label} 必须是数组`);
      const normalized = normalizeList(items);
      if (normalized.some(item => item.length > 4096)) {
        throw new Error(`${label} 条目过长`);
      }
      return normalized;
    };
    const next = {
      blockedKeywords: normalizeRequiredList(
        source.blockedKeywords || [],
        'blockedKeywords'
      ),
      blockedUrlPatterns: normalizeRequiredList(
        source.blockedUrlPatterns || [],
        'blockedUrlPatterns'
      ),
      blockedAuthors: normalizeRequiredList(
        source.blockedAuthors || [],
        'blockedAuthors'
      ),
      highRiskDomains: normalizeRequiredList(
        source.highRiskDomains || [],
        'highRiskDomains'
      ),
    };
    await ensureStorageArea(storageArea).set(next);
    return next;
  }

  async function addRuleToStorage(
    value,
    scope,
    storageArea = global.chrome?.storage?.local
  ) {
    const normalizedValue = String(value ?? '').trim();
    if (!normalizedValue) throw new Error('阻断规则不能为空');
    if (!['keyword', 'url', 'author', 'both'].includes(scope)) {
      throw new Error('阻断规则类型无效');
    }
    ensureStorageArea(storageArea);

    const stored = await storageArea.get([
      STORAGE_KEYS.KEYWORDS,
      STORAGE_KEYS.URL_PATTERNS,
      STORAGE_KEYS.AUTHORS,
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
    if (scope === 'author') {
      next.blockedAuthors =
        appendUnique(next.blockedAuthors, normalizedValue);
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

  // 站点只描述取词位置；匹配、优先级与反馈由通用规则负责。
  const SEARCH_SITES = Object.freeze([
    {
      domain: 'youtube.com', path: /^\/results$/, parameters: ['search_query'],
      inputs: 'input[name="search_query"], input#search, input[type="search"]',
      containers: 'form, ytd-searchbox, ytm-searchbox, yt-searchbox',
    },
    {
      domain: 'douyin.com', path: /^\/(?:jingxuan\/)?search(?:\/([^/?#]+))?(?:\/|$)/,
      inputs: 'input[data-e2e="searchbar-input"], input[type="search"]',
      containers: 'form, [data-e2e="searchbar"], [role="search"]',
    },
    {
      domain: 'xiaohongshu.com', path: /\/search(?:_result)?(?:\/|$)/, parameters: ['keyword', 'q'],
      inputs: 'input[data-testid*="search"], input[placeholder*="搜索"], input[type="search"]',
      containers: 'form, [data-testid="search-bar"], [data-testid="searchbox"], [role="search"], .input-box',
    },
    {
      domain: 'bilibili.com', path: /\/(?:search|s\/video|v_search)(?:\/|$)/,
      searchHost: 'search.bilibili.com', parameters: ['keyword', 'q'],
      inputs: 'input.nav-search-input, .nav-search-content input, #nav-searchform input, input[type="search"]',
      containers: 'form, .center-search-container, .bili-header__search, .nav-search-box',
    },
  ].map(site => Object.freeze({ ...site, parameters: Object.freeze(site.parameters || []) })));

  function searchSiteForUrl(rawUrl, baseUrl) {
    let url;
    try {
      url = new URL(rawUrl, baseUrl);
    } catch (error) {
      return null;
    }
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    return SEARCH_SITES.find(site => host === site.domain || host.endsWith(`.${site.domain}`)) || null;
  }

  function searchRouteFromUrl(rawUrl, baseUrl) {
    let url;
    try {
      url = new URL(rawUrl, baseUrl);
    } catch (error) {
      return null;
    }
    const site = searchSiteForUrl(url.href);
    if (!site) return null;
    const match = url.pathname.match(site.path);
    return match || url.hostname === site.searchHost ? { url, site, match } : null;
  }

  function isSearchUrl(rawUrl, baseUrl) {
    return Boolean(searchRouteFromUrl(rawUrl, baseUrl));
  }

  function searchTextFromUrl(rawUrl, baseUrl) {
    if (!rawUrl) return '';
    const route = searchRouteFromUrl(rawUrl, baseUrl);
    if (!route) return '';
    const { url, site, match } = route;
    if (!site.parameters.length) {
      if (!match?.[1]) return '';
      try {
        return decodeURIComponent(match[1]).trim();
      } catch (error) {
        return match[1].trim();
      }
    }
    for (const parameter of site.parameters) {
      const value = url.searchParams.get(parameter);
      if (value) return value.trim();
    }
    return '';
  }

  function findSearchMatch(keyword, targetUrl, rules, baseUrl) {
    const texts = [String(keyword || '').trim(), searchTextFromUrl(targetUrl, baseUrl)];
    for (const value of normalizeList(rules.blockedKeywords)) {
      if (texts.some(text => findKeyword(text, [value]))) return { kind: 'keyword', value };
    }
    const value = findUrlPattern(targetUrl, rules.blockedUrlPatterns) ||
      findBlockedHomepage(targetUrl, rules.highRiskDomains, rules.homepageRules);
    return value ? { kind: 'url', value } : null;
  }

  function homepageDomain(value) {
    try {
      const raw = String(value || '').trim();
      return new URL(raw.includes('://') ? raw : `https://${raw}`)
        .hostname.toLowerCase().replace(/\.$/, '').replace(/^(?:www|m)\./, '');
    } catch (error) {
      return '';
    }
  }

  function isHomepageAllowed(domain, rule) {
    if (typeof rule?.allowHomepage === 'boolean') return rule.allowHomepage;
    return !['bilibili.com', 'douyin.com'].includes(homepageDomain(domain));
  }

  function homepageSearchParameters(site) {
    if (['bilibili.com', 'youtube.com', 'xiaohongshu.com'].includes(site)) return [];
    if (site === 'douyin.com') return ['modal_id'];
    return ['q', 'query', 'keyword', 'search', 'search_query'];
  }

  // 新版使用显式逐站权限；旧调用保留高风险名单判断，兼容旧规则入口。
  function findBlockedHomepage(rawUrl, highRiskDomains, homepageRules) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch (error) {
      return null;
    }
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    const site = hostname.replace(/^(?:www|m)\./, '');
    if (homepageRules && typeof homepageRules === 'object') {
      if (isHomepageAllowed(site, homepageRules[site])) return null;
    } else {
      if (!['bilibili.com', 'douyin.com'].includes(site)) return null;
      if (!normalizeList(highRiskDomains).some(domain => {
        const rule = homepageDomain(domain);
        return rule && (site === rule || site.endsWith(`.${rule}`));
      })) return null;
    }
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const homePaths = site === 'douyin.com' ? ['/', '/jingxuan']
      : site === 'xiaohongshu.com' ? ['/', '/explore'] : ['/', '/index.html'];
    if (!homePaths.includes(pathname)) return null;
    for (const key of homepageSearchParameters(site)) {
      const value = url.searchParams.get(key) || '';
      if (site === 'douyin.com' ? /^\d+$/.test(value) : Boolean(value.trim())) return null;
    }
    return `${site}${pathname}`;
  }

  function createHomepageNetworkRules(siteRules, firstId) {
    const saved = siteRules && typeof siteRules === 'object' ? siteRules : {};
    const domains = new Set(['bilibili.com', 'douyin.com', ...Object.keys(saved)]);
    const networkRules = [];
    let id = firstId;
    for (const rawDomain of domains) {
      const domain = homepageDomain(rawDomain);
      if (!domain || domain !== rawDomain || isHomepageAllowed(domain, saved[domain])) continue;
      const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const base = `^https?://(?:www\\.|m\\.)?${escaped}\\.?(?::[0-9]+)?`;
      const path = domain === 'douyin.com' ? '(?:/+|/jingxuan/*)?'
        : domain === 'xiaohongshu.com' ? '(?:/+|/explore/*)?' : '(?:/+|/index\\.html/*)?';
      networkRules.push({
        id: id++, priority: 100,
        action: { type: 'block' },
        condition: { regexFilter: `${base}${path}(?:[?#].*)?$`, resourceTypes: ['main_frame'] },
      });
      const parameters = homepageSearchParameters(domain);
      if (parameters.length) {
        const value = domain === 'douyin.com' ? '[0-9]+' : '[^&#]+';
        networkRules.push({
          id: id++, priority: 101,
          action: { type: 'allow' },
          condition: {
            regexFilter: `${base}${path}\\?(?:[^#]*&)?(?:${parameters.join('|')})=${value}(?:&[^#]*)?(?:#.*)?$`,
            resourceTypes: ['main_frame'],
          },
        });
      }
    }
    return networkRules;
  }

  global.MySearchBlockingRules = Object.freeze({
    STORAGE_KEYS,
    normalizeList,
    normalizeRules,
    appendUnique,
    isUnknownMessageResponse,
    isUnknownAddRuleResponse,
    getRulesFromStorage,
    getSearchRulesFromStorage,
    importPolicyToStorage,
    addRuleToStorage,
    findKeyword,
    findUrlPattern,
    searchSiteForUrl,
    isSearchUrl,
    searchTextFromUrl,
    findSearchMatch,
    findBlockedHomepage,
    homepageDomain,
    isHomepageAllowed,
    createHomepageNetworkRules,
    replaceRulesInStorage,
  });
})(globalThis);
