'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const redirect = require('../extension/content/native-search-redirect-runtime.js');
const { read, loadFunctions, Element } = require('./native-search-test-support.cjs');
const vm = require('node:vm');
const ruleContext = vm.createContext({ URL });
vm.runInContext(read('extension/shared/blocking-rules.js'), ruleContext);
const source = read('extension/content/blocking-controller.js');
const INTERACTIVE_SELECTOR = 'a[href], button, input, textarea, [role="button"]';
function harness(host = 'www.douyin.com') {
  const head = new Element('head'); const body = new Element('body');
  const document = { head, body, documentElement: new Element('html'), createElement: tag => new Element(tag), getElementById: () => null };
  const sandbox = {
    global: { document, MySearchNativeRedirect: redirect, location: { href: `https://${host}/` } },
    isElement: value => value instanceof Element, domain: () => host,
    rules: { highRiskDomains: ['douyin.com'], blockedKeywords: ['搜索', 'BLOCKME'] },
    rulesApi: ruleContext.MySearchBlockingRules,
    depthAdapterEntry: () => null, searchMediaCardSelector: () => '.known-card', searchMediaRootSelector: () => '.results',
    isBlockingNoticeNode: () => false, isCompactTextComponent: element => element.tagName === 'SPAN',
    INTERACTIVE_SELECTOR, CANDIDATE_SELECTOR: `${INTERACTIVE_SELECTOR}, span`,
    pageMatch: null, detailRootForElement: () => null,
    isVisiblePageElement: () => true, genericBlockingComponentForElement: element => element,
    fallbackResultCardForElement: () => null,
    ensurePageStateCurrent() {}, currentPageBlockingMatch: () => sandbox.pageMatch,
    isLikelyClickable: element => element.matches(INTERACTIVE_SELECTOR),
    textForElement: element => element.textContent,
    findUrlMatch: url => url?.includes('/forbidden') ? '/forbidden' : null,
    canCreateDocumentNodes: () => true, documentAppendTarget: () => head,
    blockedCards: new Set(), blockedCardStates: new WeakMap(),
    BLOCKED_ATTR: 'data-mysearch-blocked', BLOCKED_CARD_ATTR: 'data-mysearch-blocked-card',
    BLOCKED_CARD_KIND_ATTR: 'data-mysearch-blocked-card-kind', BLOCKED_CARD_VALUE_ATTR: 'data-mysearch-blocked-card-value',
    BLOCKED_CARD_PLACEHOLDER_CLASS: 'mysearch-blocked-card-placeholder',
    BLOCKED_CARD_LEAF_PLACEHOLDER_ATTR: 'data-mysearch-blocked-leaf-placeholder',
  };
  for (const [, name, , value] of source.matchAll(/\bconst ([A-Z_][A-Z0-9_]*)\s*=\s*(['"])([^'"\n]*)\2\s*;/g)) {
    sandbox[name] = value;
  }
  const api = loadFunctions(source, [
    ['isSearchRedirectControl', 'function containsSearchRedirectControl('],
    ['containsSearchRedirectControl', 'function isSharedControlContainer('],
    ['isSharedControlContainer', 'function isBlockingPageContainer('],
    ['isBlockingPageContainer', 'function isCompactTextComponent('],
    ['resultCardForElement', 'function resultCardsInElement('],
    ['isGenericBlockingCandidate', 'function genericResultCardForElement('],
    ['getInteractionMatch', 'function allowDeduplicatedAttempt('],
    ['makeBlockedCardPlaceholder', 'function hideBlockedCard('],
    ['hideBlockedCard', 'function restoreBlockedCards('],
    ['restoreBlockedCards', 'function processMatchedElement('],
    ['installStyle', 'function renderPageNotice('],
  ], sandbox);
  return { ...api, sandbox, head, body };
}

for (const host of ['www.douyin.com', 'www.google.com', 'www.google.com.hk']) {
  test(`TC-NS-01 ${host}: 原生搜索与插件入口被识别为受保护控件`, () => {
    const h = harness(host);
    const attrs = host.includes('douyin') ? { 'data-e2e': 'searchbar-input' } : { name: 'q' };
    const native = new Element(host.includes('douyin') ? 'input' : 'textarea', attrs);
    assert.equal(h.isSearchRedirectControl(native), true);
    assert.equal(h.isGenericBlockingCandidate(native), false);
    const root = new Element('div', { 'data-msp-native-search-root': 'true' });
    const entry = root.appendChild(new Element('input', { 'data-msp-native-search-button': 'true' }));
    const inner = root.appendChild(new Element('span')); inner.textContent = '搜索';
    for (const node of [root, entry, inner]) {
      assert.equal(h.isSearchRedirectControl(node), true);
      assert.equal(h.getInteractionMatch(node), null);
      assert.equal(h.hideBlockedCard(node, { kind: 'keyword', value: '搜索' }), false);
      assert.equal(h.resultCardForElement(node), null);
    }
    if (host.includes('douyin')) assert.equal(h.isSearchRedirectControl(new Element('button', { 'data-e2e': 'searchbar-button' })), true);
    assert.equal(h.isSearchRedirectControl(new Element('input', { name: 'unrelated' })), false);
  });
}

test('TC-NS-02 搜索祖先与多控件共享外壳不能整块替换，兄弟关键词不阻断收藏', () => {
  const h = harness();
  const shell = new Element('div', { role: 'button' });
  const blocked = shell.appendChild(new Element('button')); blocked.textContent = 'BLOCKME';
  const safe = shell.appendChild(new Element('button')); safe.textContent = '收藏';
  shell.textContent = 'BLOCKME 收藏';
  assert.equal(h.isSharedControlContainer(shell), true);
  assert.equal(h.isGenericBlockingCandidate(shell), false);
  assert.equal(h.hideBlockedCard(shell, { kind: 'keyword', value: 'BLOCKME' }), false);
  assert.equal(h.getInteractionMatch(safe), null);
  assert.equal(h.getInteractionMatch(blocked).value, 'BLOCKME');
  const ancestor = new Element('div');
  ancestor.appendChild(new Element('input', { 'data-msp-native-search-button': 'true' }));
  assert.equal(h.containsSearchRedirectControl(ancestor), true);
  assert.equal(h.isBlockingPageContainer(ancestor), true);
  const nested = new Element('div'); const single = nested.appendChild(new Element('button')); single.appendChild(new Element('input'));
  assert.equal(h.isSharedControlContainer(nested), false, 'nested controls are one interactive branch, not two siblings');
});

test('TC-NS-03 已知结果卡片与语义卡片不被误当导航外壳；普通URL和整页规则仍阻断', () => {
  const h = harness();
  for (const tag of ['article', 'li', 'div']) {
    const card = new Element(tag); card.appendChild(new Element('button')); card.appendChild(new Element('a', { href: '/content' }));
    if (tag === 'div') card.exactMatches.add('.known-card');
    assert.equal(h.isSharedControlContainer(card, { name: 'douyin' }), false);
  }
  const results = new Element('div'); results.exactMatches.add('.results');
  const component = results.appendChild(new Element('div')); component.appendChild(new Element('button')); component.appendChild(new Element('button'));
  assert.equal(h.isSharedControlContainer(component, { name: 'douyin' }), false);
  const link = new Element('a', { href: '/forbidden/path' }); link.textContent = '普通链接';
  assert.equal(h.getInteractionMatch(link).kind, 'url');
  const entry = new Element('input', { 'data-msp-native-search-button': 'true' });
  h.sandbox.pageMatch = { kind: 'url', value: 'whole-page' };
  assert.equal(h.getInteractionMatch(entry), h.sandbox.pageMatch);
});

for (const tag of ['div', 'input', 'img']) {
  test(`TC-NS-04 ${tag}: 屏蔽/重复扫描/恢复保留原节点，不按旧尺寸生成占位`, () => {
    const h = harness(); const parent = new Element('div');
    const node = parent.appendChild(new Element(tag, { title: 'BLOCKME', tabindex: '0', href: '/forbidden' }));
    node.style.setProperty('width', '950px'); node.style.setProperty('height', '280px');
    const original = tag === 'div' ? node.appendChild(new Element('span')) : null;
    if (original) original.textContent = 'BLOCKME';
    assert.equal(h.hideBlockedCard(node, { kind: 'keyword', value: 'BLOCKME' }), true);
    const placeholder = tag === 'div' ? node.children[0] : parent.children[0];
    assert.equal(placeholder.textContent, '已屏蔽');
    assert.equal(placeholder.style.getPropertyValue('width'), '');
    assert.equal(placeholder.style.getPropertyValue('height'), '');
    assert.equal(h.hideBlockedCard(node, { kind: 'keyword', value: 'BLOCKME' }), true);
    assert.equal(tag === 'div' ? node.children.length : parent.children.length, 1);
    h.restoreBlockedCards();
    assert.equal(parent.children[0], node);
    assert.equal(node.getAttribute('title'), 'BLOCKME');
    assert.equal(node.getAttribute('tabindex'), '0');
    assert.equal(node.hasAttribute('data-mysearch-blocked-card'), false);
    if (original) assert.equal(node.children[0], original);
  });
}

test('TC-NS-04 实际注入的容器/叶子CSS收缩旧尺寸并降低图层（不替代像素验收）', () => {
  const h = harness(); h.installStyle();
  const css = h.head.children[0].textContent;
  const block = selector => {
    const start = css.indexOf(selector); assert.ok(start >= 0, selector);
    const open = css.indexOf('{', start), close = css.indexOf('}', open);
    return css.slice(open + 1, close);
  };
  const container = block('[data-mysearch-blocked-card] {');
  for (const declaration of ['width: fit-content', 'height: auto', 'min-height: 0', 'flex: 0 0 auto', 'inset: auto', 'z-index: 0', 'padding: 0', 'transform: none']) {
    assert.ok(container.includes(`${declaration} !important;`), declaration);
  }
  const leaf = block('.mysearch-blocked-card-placeholder[data-mysearch-blocked-leaf-placeholder]');
  assert.match(leaf, /width: fit-content !important;/);
  assert.match(leaf, /flex: 0 0 auto !important;/);
  assert.ok(css.includes('@media (max-width: 768px)'));
  assert.ok(css.includes('@media (max-width: 480px)'));
  assert.doesNotMatch(css, /width: 950px|height: 280px|blocked-card-inline-size/);
  const entryCss = read('extension/content/styles/native-search-redirect.css');
  assert.match(entryCss, /\[data-msp-native-search-root="true"\] \{[\s\S]*?z-index: 1 !important;/);
});
