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

test('Douyin 提升到完整视觉 shell，但不会吞掉无关顶部控件', () => {
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
    visualShell
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
