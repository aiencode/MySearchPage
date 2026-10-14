'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const redirect = require('../extension/content/native-search-redirect-runtime.js');
const { read, loadFunctions, Element } = require('./native-search-test-support.cjs');
const source = read('extension/content/native-search-redirect-runtime.js');
const safeMatches = (element, selector) => Boolean(element?.matches(selector));
const safeQuery = (element, selector) => element?.querySelector(selector) || null;
const safeQueryAll = (element, selector) => element?.querySelectorAll(selector) || [];
function scanner(host) {
  const root = new Element('div'); const replaced = []; const observed = [];
  const sandbox = {
    targetSite: redirect.getTargetSite(host, []), documentRef: root, destroyed: false, observer: null,
    safeMatches, safeQueryAll, BUTTON_ATTR: redirect.BUTTON_ATTR,
    windowRef: { getComputedStyle: node => node.computed, MutationObserver: class {
      constructor(callback) { sandbox.callback = callback; }
      observe(_node, options) { observed.push(options); }
    } }, global: {},
    purgePopupSubtree() {}, purgeDynamicPopupSubtree() {}, purgeAllPopups() {}, reconcileSearchShells() {},
    isRenderedSearchControl: redirect.isRenderedSearchControl,
    collectObserverBatchPlan: redirect.collectObserverBatchPlan,
    findSearchOwner: input => input.parentNode,
    replaceOwner(owner, input) { replaced.push({ owner, input }); return true; },
  };
  root.documentElement = root;
  const api = loadFunctions(source, [
    ['collectSearchInputs', 'function scan('], ['scan', 'function installObserver('], ['installObserver', 'function activate('],
  ], sandbox);
  return { ...api, sandbox, root, replaced, observed };
}
for (const host of ['www.google.com', 'www.google.com.hk']) {
  test(`TC-NS-05 ${host}: input/textarea隐藏副本不能抢走可见入口，顺序反转也成立`, () => {
    for (const tag of ['input', 'textarea']) for (const reversed of [false, true]) {
      const h = scanner(host);
      const visible = new Element('form'); const shown = visible.appendChild(new Element(tag, { name: 'q' }));
      const hidden = new Element('form', { hidden: '' }); const dormant = hidden.appendChild(new Element(tag, { name: 'q' }));
      for (const node of reversed ? [hidden, visible] : [visible, hidden]) h.root.appendChild(node);
      h.root.appendChild(new Element('input', { name: 'unrelated' }));
      assert.equal(h.scan(), 1);
      assert.deepEqual(h.replaced.map(item => item.input), [shown]);
      hidden.removeAttribute('hidden'); h.replaced.length = 0;
      assert.equal(h.scan(hidden), 1);
      assert.equal(h.replaced[0].input, dormant);
    }
  });
}

test('TC-NS-06 生产Observer过滤身份属性，新增name=q的原节点进入扫描', () => {
  const h = scanner('www.google.com');
  const form = h.root.appendChild(new Element('form')); const input = form.appendChild(new Element('textarea'));
  assert.equal(h.scan(), 0);
  h.installObserver();
  for (const attr of ['name', 'type', 'role', 'placeholder', 'aria-label', 'data-e2e']) assert.ok(h.observed[0].attributeFilter.includes(attr), attr);
  input.setAttribute('name', 'q');
  h.sandbox.callback([{ type: 'attributes', attributeName: 'name', target: input }]);
  assert.equal(h.replaced.length, 1);
  assert.equal(h.replaced[0].input, input);
});

test('TC-NS-09 自有只读控件即使匹配原生选择器也不能再次移除或替换', () => {
  const h = scanner('www.google.com');
  const form = h.root.appendChild(new Element('form'));
  const entry = form.appendChild(new Element('input', { name: 'q', 'data-msp-native-search-button': 'true' }));
  assert.equal(h.collectSearchInputs(h.root).size, 0);
  assert.equal(h.scan(), 0);
  assert.equal(form.children[0], entry);
  assert.equal(h.replaced.length, 0);
});

function shells() {
  const header = new Element('header'); const shell = header.appendChild(new Element('div', { class: 'ghost-search' }));
  shell.style.setProperty('display', 'flex', 'important');
  const entry = shell.appendChild(new Element('div', { 'data-msp-native-search-root': 'true' }));
  const input = entry.appendChild(new Element('input', { 'data-msp-native-search-button': 'true' }));
  const emptyPortal = shell.appendChild(new Element('div'));
  const styles = [];
  const sandbox = {
    targetSite: redirect.getTargetSite('www.douyin.com'), searchShellStates: new Map(), searchShellStyle: null,
    currentReplacementRoot: () => entry, safeMatches, safeQuery, safeQueryAll,
    DOUYIN_OWNER_STOP_TAGS: new Set(['HTML', 'BODY', 'HEADER', 'NAV', 'MAIN', 'ASIDE']),
    DOUYIN_OWNER_GUARD_SELECTOR: 'a[href], button, input, textarea, select, [role="button"], img, video, svg, [onclick]',
    matchesAnySelector: (node, selectors) => selectors?.some(selector => safeMatches(node, selector)),
    SHELL_ATTR: 'data-msp-native-search-shell', ACTIVE_ATTR: redirect.ACTIVE_ATTR,
    windowRef: { getComputedStyle: node => ({ ...node.computed, display: node.style.getPropertyValue('display') || node.computed.display }) },
    documentRef: { createElement: tag => new Element(tag), head: { appendChild: node => styles.push(node) } },
  };
  const api = loadFunctions(source, [
    ['douyinControlMetadata', 'function isDouyinCloseControl('],
    ['isDouyinCloseControl', 'function directChildWithin('],
    ['isDouyinSearchRelatedControl', 'function canExpandDouyinSearchOwner('],
    ['restoreSearchShell', 'function reconcileSearchShells('],
    ['reconcileSearchShells', 'function setActiveSite('],
  ], sandbox);
  return { ...api, sandbox, header, shell, entry, input, emptyPortal, styles };
}

test('TC-NS-07 生产外壳协调重复3轮后不留装饰、不重复写入且保留portal节点', () => {
  const h = shells(); h.reconcileSearchShells();
  const writes = h.shell.style.writes; const attrs = h.shell.attributeWrites;
  for (let cycle = 0; cycle < 3; cycle++) h.reconcileSearchShells();
  assert.equal(h.shell.style.getPropertyValue('display'), 'contents');
  assert.equal(h.shell.style.writes, writes);
  assert.equal(h.shell.attributeWrites, attrs);
  assert.equal(h.styles.length, 1);
  assert.match(h.styles[0].textContent, /::before/); assert.match(h.styles[0].textContent, /::after/);
  assert.match(h.styles[0].textContent, /display: none !important; content: none !important;/);
  assert.equal(h.shell.parentNode, h.header);
  assert.equal(h.emptyPortal.parentNode, h.shell);
  assert.equal(h.input.parentNode, h.entry);
  assert.equal(h.header.hasAttribute('data-msp-native-search-shell'), false);
});

for (const [tag, attrs] of [['video', {}], ['canvas', {}], ['div', { 'data-e2e': 'modal-video-container' }]]) {
  test(`TC-NS-08 ${tag}: 挂载详情恢复原display/priority，移除后再收起`, () => {
    const h = shells(); h.reconcileSearchShells();
    const detail = h.shell.appendChild(new Element(tag, attrs));
    h.reconcileSearchShells();
    assert.equal(h.shell.style.getPropertyValue('display'), 'flex');
    assert.equal(h.shell.style.getPropertyPriority('display'), 'important');
    assert.equal(h.shell.hasAttribute('data-msp-native-search-shell'), false);
    assert.equal(detail.parentNode, h.shell);
    h.shell.removeChild(detail); h.reconcileSearchShells();
    assert.equal(h.shell.style.getPropertyValue('display'), 'contents');
    assert.equal(h.styles.length, 1);
  });
}

test('TC-NS-08 关闭/头像/收藏/对话框边界都不能收起，无入口时恢复且不覆盖站点新样式', () => {
  for (const control of [new Element('button', { 'aria-label': '关闭搜索' }), new Element('img', { alt: '头像' }), new Element('a', { href: '/favorite' })]) {
    const h = shells(); h.shell.appendChild(control); h.reconcileSearchShells();
    assert.equal(h.shell.hasAttribute('data-msp-native-search-shell'), false);
    assert.equal(control.parentNode, h.shell);
  }
  const dialog = shells(); dialog.shell.setAttribute('role', 'dialog'); dialog.reconcileSearchShells();
  assert.equal(dialog.shell.hasAttribute('data-msp-native-search-shell'), false);
  const h = shells(); h.reconcileSearchShells();
  h.shell.style.setProperty('display', 'grid');
  h.sandbox.currentReplacementRoot = () => null;
  h.reconcileSearchShells();
  assert.equal(h.shell.style.getPropertyValue('display'), 'grid');
  assert.equal(h.sandbox.searchShellStates.size, 0);
  assert.equal(h.shell.hasAttribute('data-msp-native-search-shell'), false);
});

test('TC-NS-16 解析器加载顺序、manifest文件存在及临时诊断回收契约', () => {
  const html = read('extension/navigation/navigation.html');
  const refs = [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match => match[1]);
  const parser = refs.indexOf('../shared/mysearch-navigation.js');
  assert.ok(parser >= 0 && parser < refs.indexOf('navigation.js'));
  for (const ref of refs) assert.ok(fs.existsSync(path.resolve(__dirname, '../extension/navigation', ref)), ref);
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  for (const script of manifest.content_scripts) for (const file of [...(script.js || []), ...(script.css || [])]) {
    assert.ok(fs.existsSync(path.resolve(__dirname, '../extension', file)), file);
  }
  for (const file of ['extension/diagnostics/native-search-caret.html', 'extension/diagnostics/native-search-caret.js',
    'tests/native-search-caret-preview.html', 'tests/native-search-caret-target-preview.html', 'tests/native-search-caret-handoff.browser.cjs']) {
    assert.equal(fs.existsSync(path.resolve(__dirname, '..', file)), false, file);
  }
  const sources = `${source}\n${read('extension/shared/mysearch-navigation.js')}\n${read('extension/navigation/navigation.js')}`;
  assert.doesNotMatch(sources, /windows\.update\s*\(|window\.focus\s*\(|bring_to_front|delivery_mode.*foreground/);
  assert.doesNotMatch(html, /diagnostics\/native-search-caret/);
});
