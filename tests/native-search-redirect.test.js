'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const redirect = require(
  '../extension/content/native-search-redirect-runtime.js'
);
const controllerSource = fs.readFileSync(
  path.resolve(
    __dirname,
    '../extension/content/native-search-redirect-runtime.js'
  ),
  'utf8'
);
const redirectCss = fs.readFileSync(
  path.resolve(
    __dirname,
    '../extension/content/styles/native-search-redirect.css'
  ),
  'utf8'
);

test('Douyin 使用 input 与原生 submit 的最窄共同 owner', () => {
  const submit = {};
  const outer = {
    parentElement: null,
    querySelector(selector) {
      return selector === '[data-e2e="searchbar-button"]'
        ? submit
        : null;
    },
  };
  const inner = {
    parentElement: outer,
    querySelector() {
      return null;
    },
  };
  const input = {
    parentElement: inner,
  };
  const site = redirect.getTargetSite(
    'www.douyin.com',
    ['douyin.com']
  );

  assert.equal(
    redirect.findDouyinSearchOwner(input, site),
    outer
  );
});

test('Douyin 没有原生 submit 时不退化为只替换 input', () => {
  const parent = {
    parentElement: null,
    querySelector() {
      return null;
    },
  };
  const input = { parentElement: parent };
  const site = redirect.getTargetSite(
    'www.douyin.com',
    ['douyin.com']
  );

  assert.equal(
    redirect.findDouyinSearchOwner(input, site),
    null
  );
});

test('Douyin 仅提升到明确搜索 shell，保留无标识的未来详情挂载点', () => {
  const selectorParts = selector =>
    String(selector || '')
      .split(',')
      .map(item => item.trim());

  const input = {
    parentElement: null,
    textContent: '',
    getAttribute(name) {
      return name === 'data-e2e'
        ? 'searchbar-input'
        : null;
    },
    matches(selector) {
      return selectorParts(selector).some(item =>
        item.startsWith('input')
      );
    },
    closest() {
      return null;
    },
  };

  const submit = {
    textContent: '搜索',
    getAttribute(name) {
      return name === 'data-e2e'
        ? 'searchbar-button'
        : null;
    },
    matches(selector) {
      const parts = selectorParts(selector);
      return parts.includes('button') ||
        parts.includes(
          '[data-e2e="searchbar-button"]'
        );
    },
  };

  const unrelatedLogin = {
    textContent: '登录',
    getAttribute() {
      return null;
    },
    matches(selector) {
      return selectorParts(selector).includes('button');
    },
  };

  const innerOwner = {
    tagName: 'DIV',
    parentElement: null,
    contains(node) {
      return node === this ||
        node === input ||
        node === submit;
    },
    querySelector(selector) {
      if (
        selector ===
        '[data-e2e="searchbar-button"]'
      ) {
        return submit;
      }
      if (selector.includes('input')) return input;
      return null;
    },
    querySelectorAll() {
      return [input, submit];
    },
  };

  const visualShell = {
    tagName: 'DIV',
    parentElement: null,
    contains(node) {
      return node === this ||
        node === innerOwner ||
        innerOwner.contains(node);
    },
    querySelector(selector) {
      if (
        selector ===
        '[data-e2e="searchbar-button"]'
      ) {
        return submit;
      }
      if (selector.includes('input')) return input;
      return null;
    },
    querySelectorAll() {
      return [input, submit];
    },
  };

  const topNavigation = {
    tagName: 'DIV',
    parentElement: null,
    contains() {
      return true;
    },
    querySelector(selector) {
      if (
        selector ===
        '[data-e2e="searchbar-button"]'
      ) {
        return submit;
      }
      if (selector.includes('input')) return input;
      return null;
    },
    querySelectorAll() {
      return [input, submit, unrelatedLogin];
    },
  };

  const header = {
    tagName: 'HEADER',
    parentElement: null,
    contains() {
      return true;
    },
  };

  input.parentElement = innerOwner;
  innerOwner.parentElement = visualShell;
  visualShell.parentElement = topNavigation;
  topNavigation.parentElement = header;

  const site = redirect.getTargetSite(
    'www.douyin.com',
    ['douyin.com']
  );

  assert.equal(
    redirect.findDouyinSearchOwner(input, site),
    innerOwner
  );
  // A stable search marker supplies positive ownership evidence.
  visualShell.matches = selector => selector === '[data-e2e="searchbar-container"]';
  assert.equal(redirect.findDouyinSearchOwner(input, site), visualShell);
});

test('Douyin 共同 owner 含关闭控件时只替换 input 分支', () => {
  const selectorParts = selector =>
    String(selector || '')
      .split(',')
      .map(item => item.trim());

  const input = {
    parentElement: null,
    parentNode: null,
    textContent: '',
    getAttribute(name) {
      return name === 'data-e2e'
        ? 'searchbar-input'
        : null;
    },
    matches(selector) {
      return selectorParts(selector).some(item =>
        item.startsWith('input') ||
        item.endsWith(' input')
      );
    },
    closest() {
      return null;
    },
    contains(node) {
      return node === this;
    },
  };

  const submit = {
    parentElement: null,
    parentNode: null,
    textContent: '搜索',
    getAttribute(name) {
      return name === 'data-e2e'
        ? 'searchbar-button'
        : null;
    },
    matches(selector) {
      const parts = selectorParts(selector);
      return parts.includes('button') ||
        parts.includes(
          '[data-e2e="searchbar-button"]'
        );
    },
    contains(node) {
      return node === this;
    },
  };

  const close = {
    parentElement: null,
    parentNode: null,
    textContent: '×',
    getAttribute(name) {
      return name === 'aria-label'
        ? '关闭搜索结果'
        : null;
    },
    matches(selector) {
      const parts = selectorParts(selector);
      return parts.includes('button') ||
        parts.includes('[aria-label*="关闭"]');
    },
    contains(node) {
      return node === this;
    },
  };

  const inputBranch = {
    tagName: 'DIV',
    parentElement: null,
    parentNode: null,
    contains(node) {
      return node === this || node === input;
    },
    querySelector(selector) {
      return selector.includes('input')
        ? input
        : null;
    },
    querySelectorAll() {
      return [input];
    },
    matches() {
      return false;
    },
  };

  const sharedOwner = {
    tagName: 'DIV',
    parentElement: null,
    parentNode: null,
    contains(node) {
      return node === this ||
        node === inputBranch ||
        node === input ||
        node === submit ||
        node === close;
    },
    querySelector(selector) {
      if (
        selector ===
        '[data-e2e="searchbar-button"]'
      ) {
        return submit;
      }
      if (selector.includes('input')) return input;
      return null;
    },
    querySelectorAll() {
      return [input, submit, close];
    },
    matches() {
      return false;
    },
  };

  input.parentElement = inputBranch;
  input.parentNode = inputBranch;
  inputBranch.parentElement = sharedOwner;
  inputBranch.parentNode = sharedOwner;
  submit.parentElement = sharedOwner;
  submit.parentNode = sharedOwner;
  close.parentElement = sharedOwner;
  close.parentNode = sharedOwner;

  const site = redirect.getTargetSite(
    'www.douyin.com',
    ['douyin.com']
  );

  assert.equal(
    redirect.findDouyinSearchOwner(input, site),
    inputBranch,
    '共享外壳中的关闭控件不能随搜索输入一起被替换'
  );
});

test('Douyin 原生搜索 CSS 使用 display none，不再保留占位', () => {
  const selectorStart = redirectCss.indexOf(
    'input[data-e2e="searchbar-input"]'
  );
  assert.notEqual(
    selectorStart,
    -1,
    '必须存在原生搜索 input 规则'
  );

  const ruleStart = redirectCss.indexOf(
    '{',
    selectorStart
  );
  const ruleEnd = redirectCss.indexOf(
    '}',
    ruleStart
  );
  assert.ok(ruleStart > selectorStart && ruleEnd > ruleStart);

  const declarationBlock = redirectCss.slice(
    ruleStart + 1,
    ruleEnd
  );
  const selectorBlock = redirectCss.slice(
    selectorStart,
    ruleStart
  );

  assert.match(
    selectorBlock,
    /\[data-e2e="searchbar-button"\]/
  );
  for (const sharedOwnerSelector of [
    '[data-e2e="searchbar-container"]',
    '[data-e2e="searchbar"]',
    '[data-e2e="search-box"]',
  ]) {
    assert.equal(
      selectorBlock.includes(sharedOwnerSelector),
      false,
      `${sharedOwnerSelector} 不能整体隐藏`
    );
  }
  assert.match(
    declarationBlock,
    /display:\s*none\s*!important/
  );
  assert.match(
    declarationBlock,
    /visibility:\s*hidden\s*!important/
  );
  assert.match(
    declarationBlock,
    /pointer-events:\s*none\s*!important/
  );
});

test('Douyin SPA 将自绘入口包回原生 owner 时会重新提升入口', () => {
  const host = {
    child: null,
    replaceChild(next, previous) {
      assert.equal(previous, owner);
      this.child = next;
      next.parentNode = this;
      previous.parentNode = null;
    },
  };
  const holder = {
    child: null,
    removeChild(child) {
      assert.equal(child, replacementRoot);
      this.child = null;
      child.parentNode = null;
    },
  };
  const replacementRoot = {
    parentNode: holder,
  };
  holder.child = replacementRoot;

  const owner = {
    parentNode: host,
    contains(node) {
      return node === replacementRoot;
    },
  };
  host.child = owner;

  assert.equal(
    redirect.hoistReplacementOutOfOwner(
      owner,
      replacementRoot
    ),
    true
  );
  assert.equal(host.child, replacementRoot);
  assert.equal(replacementRoot.parentNode, host);
  assert.equal(owner.parentNode, null);
});

test('Douyin SPA 关闭详情后把旧入口迁移到当前 owner', () => {
  const oldHost = {
    child: null,
    removeChild(child) {
      assert.equal(child, replacementRoot);
      this.child = null;
      child.parentNode = null;
    },
  };
  const replacementRoot = {
    parentNode: oldHost,
    contains() {
      return false;
    },
  };
  oldHost.child = replacementRoot;

  const newHost = {
    children: [],
    replaceChild(next, previous) {
      const index = this.children.indexOf(previous);
      assert.notEqual(index, -1);
      next.parentNode?.removeChild?.(next);
      this.children[index] = next;
      next.parentNode = this;
      previous.parentNode = null;
    },
  };
  const close = {
    id: 'search-page-close',
    parentNode: newHost,
  };
  const owner = {
    parentNode: newHost,
    contains() {
      return false;
    },
  };
  newHost.children = [close, owner];

  assert.equal(
    redirect.relocateReplacementToOwner(
      owner,
      replacementRoot
    ),
    true
  );
  assert.deepEqual(
    newHost.children,
    [close, replacementRoot]
  );
  assert.equal(replacementRoot.parentNode, newHost);
  assert.equal(owner.parentNode, null);
  assert.equal(oldHost.child, null);
  assert.match(
    controllerSource,
    /relocateReplacementToOwner\(\s*owner,\s*currentRoot\s*\)/
  );
  assert.match(
    controllerSource,
    /rememberReplacement\(\s*owner,\s*currentRoot\s*\)/
  );
  assert.doesNotMatch(
    controllerSource,
    /if \(!currentRoot \|\| owner !== currentRoot\) \{\s*removeElement\(owner\)/
  );
});

test('动态 class 浮层只在搜索入口附近且具有诱因文字时命中', () => {
  const replacementRoot = {
    contains() { return false; },
    getBoundingClientRect() {
      return {
        left: 100,
        right: 204,
        top: 20,
        bottom: 56,
      };
    },
  };
  const popup = {
    textContent: '猜你想搜',
    className: 'random-runtime-class',
    style: {},
    contains() { return false; },
    getAttribute() { return null; },
    getBoundingClientRect() {
      return {
        left: 90,
        right: 350,
        top: 56,
        bottom: 300,
      };
    },
  };
  const staticArticle = {
    ...popup,
    className: 'article-panel',
    textContent: '文章讨论热榜',
  };
  const windowRef = {
    getComputedStyle(element) {
      return {
        position: element === popup
          ? 'absolute'
          : 'sticky',
      };
    },
  };

  assert.equal(
    redirect.isLikelyDynamicSearchPopup(
      popup,
      replacementRoot,
      windowRef
    ),
    true
  );
  assert.equal(
    redirect.isLikelyDynamicSearchPopup(
      staticArticle,
      replacementRoot,
      windowRef
    ),
    false
  );
});

test('随机 class 浮层覆盖初始 DOM、文本变化和低成本定时跟踪', () => {
  assert.match(
    controllerSource,
    /purgeDynamicPopupSubtree\(documentRef\);/
  );
  assert.match(
    controllerSource,
    /function purgeTrackedDynamicPopups\(\)/
  );
  assert.match(
    controllerSource,
    /function collectObserverBatchPlan\(\s*mutations\s*\)[\s\S]*?else if\s*\(\s*type\s*===\s*['"]characterData['"]\s*\)/
  );
  assert.match(
    controllerSource,
    /characterData:\s*true/
  );
  assert.match(
    controllerSource,
    /DOMContentLoaded[\s\S]*?installObserver\(\)[\s\S]*?scan\(\s*documentRef\s*\)/
  );
});

test('Douyin 覆盖历史、猜你想搜、热点与热榜弹层证据', () => {
  const site = redirect.getTargetSite(
    'www.douyin.com',
    ['douyin.com']
  );
  const selectors = site.popupSelectors.join('\n');

  assert.match(selectors, /history/);
  assert.match(selectors, /suggest/);
  assert.match(selectors, /hot/);
  assert.match(selectors, /trend/);
});

test('自绘入口文案只保留一个搜索入口', () => {
  assert.equal(redirect.BUTTON_TEXT, '搜索资料');
  assert.equal(
    redirect.getTargetSite(
      'www.example.com',
      ['douyin.com']
    ),
    null
  );
});

test('最终运行时使用 hover/focus 触发的六秒清理窗口', () => {
  assert.equal(
    redirect.POPUP_SWEEP_HOVER_WINDOW_MS,
    6000
  );
  assert.match(
    controllerSource,
    /function stopOriginalHover\(\s*event\s*\)[\s\S]*?armPopupSweepWindow\(\)[\s\S]*?purgeAllPopups\(\)/
  );
  assert.match(
    controllerSource,
    /function armPopupSweepWindow\(\)[\s\S]*?setInterval\([\s\S]*?POPUP_SWEEP_INTERVAL_MS[\s\S]*?setTimeout\([\s\S]*?POPUP_SWEEP_HOVER_WINDOW_MS/
  );
  assert.doesNotMatch(
    controllerSource,
    /msp_native_search_perf|msp_native_search_ablation|PerformanceObserver|__MYSEARCH_NATIVE_SEARCH_PERF__|\bperf\./
  );
  assert.doesNotMatch(
    controllerSource,
    /startPopupSweep\(\s*['"]permanent['"]/
  );
});

test('Observer 批次计划只做 root 去重且不改变 root 语义', () => {
  const sharedTarget = { name: 'shared-target' };
  const sharedNode = { name: 'shared-node' };
  const attributeParent = {
    name: 'attribute-parent',
  };
  const attributeTarget = {
    parentElement: attributeParent,
  };
  const textParent = { name: 'text-parent' };
  const textNode = {
    parentElement: textParent,
  };

  const plan =
    redirect.collectObserverBatchPlan([
      {
        type: 'childList',
        target: sharedTarget,
        addedNodes: [sharedNode],
      },
      {
        type: 'childList',
        target: sharedTarget,
        addedNodes: [sharedNode],
      },
      {
        type: 'attributes',
        target: attributeTarget,
      },
      {
        type: 'characterData',
        target: textNode,
      },
    ]);

  assert.deepEqual(
    new Set(plan.roots),
    new Set([
      sharedNode,
      sharedTarget,
      attributeParent,
      textParent,
    ])
  );
});

test('Observer 默认使用批次单遍路径且旧 A0 路径已移除', () => {
  assert.match(
    controllerSource,
    /collectObserverBatchPlan\(mutations\)/
  );
  assert.match(
    controllerSource,
    /scan\(\s*root\s*,\s*\{[\s\S]*?skipFinalFullPurge:\s*true/
  );
  assert.match(
    controllerSource,
    /finally\s*\{[\s\S]*?purgeAllPopups\(\)/
  );
  assert.doesNotMatch(
    controllerSource,
    /observerSinglePassAblation|OBSERVER_SINGLE_PASS_ABLATION|mutation_single_pass|mutation_batch/
  );
});

test('Google 两种域名都替换 q 输入框，且不加入高风险阻断名单', () => {
  for (const host of ['www.google.com', 'www.google.com.hk']) {
    const site = redirect.getTargetSite(host, []);
    assert.ok(site);
    assert.deepEqual(site.inputSelectors, ['input[name="q"]', 'textarea[name="q"]']);
    assert.ok(site.ownerSelectors.includes('[role="search"]'));
  }
  assert.ok(!redirect.DEFAULT_HIGH_RISK_DOMAINS.includes('google.com'));
  assert.equal(redirect.getTargetSite('google.com.example.org', []), null);
});

test('Google 渲染边界排除隐藏副本、hidden input 和零尺寸输入', () => {
  const node = (attrs = {}, parentElement = null, style = {}, rect = { width: 200, height: 30 }) => ({
    parentElement, style,
    getAttribute(name) { return attrs[name] ?? null; },
    hasAttribute(name) { return Object.hasOwn(attrs, name); },
    getBoundingClientRect() { return rect; },
  });
  const windowRef = { getComputedStyle(element) { return element.style; } };
  assert.equal(redirect.isRenderedSearchControl(node(), windowRef), true);
  assert.equal(redirect.isRenderedSearchControl(node({ type: 'hidden' }), windowRef), false);
  assert.equal(redirect.isRenderedSearchControl(node({}, node({ hidden: '' })), windowRef), false);
  assert.equal(redirect.isRenderedSearchControl(node({}, node({ 'aria-hidden': 'true' })), windowRef), false);
  assert.equal(redirect.isRenderedSearchControl(node({}, node({}, null, { display: 'none' })), windowRef), false);
  assert.equal(redirect.isRenderedSearchControl(node({}, null, {}, { width: 0, height: 0 }), windowRef), false);
});

test('动态挂载的搜索身份属性也触发 Observer 扫描', () => {
  const filter = controllerSource.match(/attributeFilter:\s*\[([\s\S]*?)\]/)[1];
  for (const name of ['name', 'type', 'role', 'placeholder', 'aria-label']) {
    assert.ok(filter.includes(`'${name}'`), name);
  }
});

test('只读入口优先保留原生值，缺失时从现有搜索 URL 恢复', () => {
  assert.equal(redirect.searchKeywordForInput({ value: '新的 蓝牙关键词' }, 'https://www.google.com/search?q=old', 'google.com'), '新的 蓝牙关键词');
  assert.equal(redirect.searchKeywordForInput({ value: '' }, 'https://www.google.com/search?q=ESP32+%E8%93%9D%E7%89%99', 'google.com'), 'ESP32 蓝牙');
  assert.equal(redirect.searchKeywordForInput({ value: '' }, 'https://www.douyin.com/jingxuan/search/ESP32%20%E8%93%9D%E7%89%99', 'douyin.com'), 'ESP32 蓝牙');
  assert.equal(redirect.searchKeywordForInput({ value: '' }, 'https://www.youtube.com/results?search_query=ESP32', 'youtube.com'), 'ESP32');
  assert.equal(redirect.searchKeywordForInput({ value: '' }, 'https://www.google.com/', 'google.com'), '');
  assert.match(controllerSource, /createElement\('input'\)/);
  assert.match(controllerSource, /button\.readOnly = true/);
  assert.match(controllerSource, /input\.getAttribute\?\.\(BUTTON_ATTR\) !== 'true'/);
});
