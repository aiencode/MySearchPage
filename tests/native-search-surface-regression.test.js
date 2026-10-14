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
    reconcileDouyinSearchEntry() {},
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
    'extension/diagnostics/xhs-entry-check.js', 'extension/diagnostics/xhs-return-check.js',
    'extension/diagnostics/douyin-return-check.js', 'extension/diagnostics/bing-entry-check.js', 'tests/xhs-layout-preview.html',
    'extension/diagnostics/google-home-check.js',
    'tests/native-search-caret-preview.html', 'tests/native-search-caret-target-preview.html', 'tests/native-search-caret-handoff.browser.cjs']) {
    assert.equal(fs.existsSync(path.resolve(__dirname, '..', file)), false, file);
  }
  const sources = `${source}\n${read('extension/shared/mysearch-navigation.js')}\n${read('extension/navigation/navigation.js')}`;
  assert.doesNotMatch(sources, /windows\.update\s*\(|window\.focus\s*\(|bring_to_front|delivery_mode.*foreground/);
  assert.doesNotMatch(html, /diagnostics\/(?:native-search-caret|xhs-entry-check|xhs-return-check|douyin-return-check|bing-entry-check|google-home-check)/);
});

test('TC-NS-17 小红书替换根保留搜索区域布局属性，不继承原生事件或隐藏标记', () => {
  const owner = new Element('div', { class: 'input-box header-search', id: 'search-area',
    style: 'position:absolute;left:50%;transform:translateX(-50%);width:calc(100% - 480px)',
    onclick: 'nativeSearch()', 'data-testid': 'search-bar', role: 'search' });
  const document = { createElement: tag => new Element(tag) };
  const site = redirect.getTargetSite('www.xiaohongshu.com');
  assert.equal(site.preserveOwnerLayout, true);
  assert.ok(site.ownerSelectors.includes('.input-box'));
  const root = redirect.createReplacementRoot(document, owner, site);
  assert.equal(root.getAttribute('class'), 'input-box header-search');
  assert.ok(root.className.includes('msp-native-search-entry'));
  assert.equal(root.getAttribute('id'), 'search-area');
  assert.equal(root.getAttribute('style'), owner.getAttribute('style'));
  assert.equal(root.getAttribute('data-msp-native-search-layout'), 'preserve');
  for (const attr of ['onclick', 'data-testid', 'role']) assert.equal(root.hasAttribute(attr), false, attr);
  for (const [name, value] of Object.entries({position:'absolute',width:'calc(100% - 480px)',margin:'0 auto',flex:'1 1 0%',left:'50%',transform:'translateX(-50%)'})) root.style.setProperty(name, value);
  for (let cycle = 0; cycle < 3; cycle++) redirect.setReplacementRootStyle(root);
  assert.equal(root.style.getPropertyValue('position'), 'absolute');
  assert.equal(root.style.getPropertyValue('width'), 'calc(100% - 480px)');
  assert.equal(root.style.getPropertyValue('margin'), '0 auto');
  assert.equal(root.style.getPropertyValue('flex'), '1 1 0%');
  assert.equal(root.style.getPropertyValue('left'), '50%');
  assert.equal(root.style.getPropertyValue('transform'), 'translateX(-50%)');
});

test('TC-NS-17 保留布局仅限小红书，其他站点仍使用原通用定位', () => {
  const document = { createElement: tag => new Element(tag) };
  for (const host of ['www.douyin.com', 'www.google.com', 'www.youtube.com', 'www.bilibili.com']) {
    const root = redirect.createReplacementRoot(document, new Element('div', { class: 'native-search', id: 'native', style:'position:absolute' }), redirect.getTargetSite(host));
    assert.equal(root.hasAttribute('data-msp-native-search-layout'), false, host);
    assert.equal(root.hasAttribute('id'), false, host);
    redirect.setReplacementRootStyle(root);
    assert.equal(root.style.getPropertyValue('position'), 'relative', host);
  }
  const css = read('extension/content/styles/native-search-redirect.css');
  const generic = css.slice(css.indexOf('[data-msp-native-search-root="true"] {'), css.indexOf('[data-msp-native-search-root="true"]:not('));
  assert.doesNotMatch(generic, /position:|width:\s*auto|flex:\s*0|margin:\s*0/);
  assert.match(css, /\[data-msp-native-search-root="true"\]:not\(\[data-msp-native-search-layout="preserve"\]\)/);
  assert.match(css, /data-msp-native-search-active="xiaohongshu.com"[\s\S]*?--msp-search-width: 100%/);
});

test('TC-NS-17 二次搜索复用入口时同步新owner布局，自有节点不重置布局', () => {
  const site = redirect.getTargetSite('www.xiaohongshu.com');
  const root = redirect.createReplacementRoot({ createElement: tag => new Element(tag) },
    new Element('div', { class: 'input-box desktop', id: 'old-search', style: 'left:50%' }), site);
  const nextOwner = new Element('div', { class: 'input-box mobile', style: 'left:120px;width:200px' });
  redirect.applySearchOwnerLayout(root, nextOwner, site);
  assert.ok(root.className.includes('input-box mobile'));
  assert.equal(root.hasAttribute('id'), false);
  assert.equal(root.getAttribute('style'), nextOwner.getAttribute('style'));
  const child = root.appendChild(new Element('input'));
  redirect.applySearchOwnerLayout(root, child, site);
  assert.equal(root.getAttribute('style'), nextOwner.getAttribute('style'));
  assert.ok(root.className.includes('input-box mobile'));
  assert.match(source, /applySearchOwnerLayout\(currentRoot, owner, targetSite, windowRef\.location\?\.href\);\s*setReplacementRootStyle\(currentRoot\)/);
});

test('TC-NS-17 小红书Vue样式作用域（包括空属性）保留，二次搜索不继承旧scope', () => {
  const site = redirect.getTargetSite('www.xiaohongshu.com');
  const owner = new Element('div', { class: 'input-box', 'data-v-4439d232': '', 'data-v-parent': '', 'data-testid': 'search-bar', onclick: 'search()' });
  const root = redirect.createReplacementRoot({ createElement: tag => new Element(tag) }, owner, site);
  assert.equal(root.hasAttribute('data-v-4439d232'), true);
  assert.equal(root.getAttribute('data-v-4439d232'), '');
  assert.equal(root.hasAttribute('data-v-parent'), true);
  assert.equal(root.hasAttribute('onclick'), false);
  assert.equal(root.hasAttribute('data-testid'), false);
  redirect.applySearchOwnerLayout(root, new Element('div', { class: 'input-box', 'data-v-next': '' }), site);
  assert.equal(root.hasAttribute('data-v-4439d232'), false);
  assert.equal(root.hasAttribute('data-v-parent'), false);
  assert.equal(root.hasAttribute('data-v-next'), true);
});

function xhsCleanup() {
  const doc = new Element('div'); const root = doc.appendChild(new Element('div', { 'data-msp-native-search-root': 'true' }));
  const field = root.appendChild(new Element('input', { 'data-msp-native-search-button': 'true' }));
  const docEvents = new Map(); const winEvents = new Map();
  const add = map => (type, callback) => map.set(type, callback);
  const remove = map => type => map.delete(type);
  const sandbox = { targetSite: redirect.getTargetSite('www.xiaohongshu.com'), documentRef: doc, destroyed: false,
    ROOT_ATTR: redirect.ROOT_ATTR, documentGuardsInstalled: false, documentGuardEntries: [],
    safeMatches, safeQueryAll, removeElement: node => node.parentNode?.removeChild(node),
    currentReplacementRoot: () => root, popupSelectors: () => sandbox.targetSite.popupSelectors,
    purgeTrackedDynamicPopups: () => 0, armPopupSweepWindow() {},
    windowRef: { addEventListener: add(winEvents), removeEventListener: remove(winEvents) } };
  doc.addEventListener = add(docEvents); doc.removeEventListener = remove(docEvents);
  const api = loadFunctions(source, [
    ['purgeNativeSearchResidue', 'function purgeXiaohongshuOnReturn('],
    ['purgeXiaohongshuOnReturn', 'function purgePopupSubtree('],
    ['purgePopupSubtree', 'function considerDynamicPopup('],
    ['purgeAllPopups', 'function popupSweepTick('],
    ['stopOriginalHover', 'function installDocumentGuards('],
    ['installDocumentGuards', 'function removeDocumentGuards('],
    ['removeDocumentGuards', 'function redirectToMySearchPage('],
  ], sandbox);
  return { ...api, doc, root, field, docEvents, winEvents, sandbox };
}

test('TC-NS-18 小红书.sug-pad和头部原生搜索/清空节点清除，不删新框及侧栏', () => {
  const h = xhsCleanup();
  const pad = h.doc.appendChild(new Element('div')); pad.exactMatches.add('.sug-pad');
  const icons = h.doc.appendChild(new Element('div')); icons.exactMatches.add('header .input-button');
  const magnifier = h.doc.appendChild(new Element('button')); magnifier.exactMatches.add('header .min-width-search-icon');
  const sidebar = h.doc.appendChild(new Element('aside'));
  h.purgeAllPopups();
  for (const node of [pad, icons, magnifier]) assert.equal(node.parentNode, null);
  assert.equal(h.root.parentNode, h.doc);
  assert.equal(h.field.parentNode, h.root);
  assert.equal(sidebar.parentNode, h.doc);
});

test('TC-NS-18 visibility/pageshow/focus回页事件反复清除迟到建议，停用后解除监听', () => {
  const h = xhsCleanup(); h.installDocumentGuards();
  assert.ok(h.docEvents.has('pointerdown')); assert.ok(h.docEvents.has('focus'));
  for (const [map, type] of [[h.docEvents, 'visibilitychange'], [h.winEvents, 'pageshow'], [h.winEvents, 'focus']]) {
    const pad = h.doc.appendChild(new Element('div')); pad.exactMatches.add('.sug-pad');
    map.get(type)();
    assert.equal(pad.parentNode, null, type);
    assert.equal(h.field.parentNode, h.root);
  }
  let prevented = false;
  h.stopOriginalHover({ target: h.field, preventDefault() { prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.equal(prevented, false, 'preserve native caret positioning');
  h.removeDocumentGuards();
  assert.equal(h.docEvents.size, 0); assert.equal(h.winEvents.size, 0);
  const css = read('extension/content/styles/native-search-redirect.css');
  const start = css.indexOf(' .sug-pad,');
  assert.ok(start >= 0);
  const block = css.slice(start, css.indexOf('}', start));
  assert.match(block, /display: none !important/);
  assert.match(block, /pointer-events: none !important/);
});

function douyinReturnFixture({ nativeCssHidden = false } = {}) {
  const doc = new Element('document'); doc.nodeType = 9;
  const make = (tag, attrs = {}) => {
    const node = new Element(tag, attrs);
    Object.defineProperty(node, 'isConnected', { get: () => doc.contains(node) });
    node.addEventListener = () => {};
    return node;
  };
  doc.documentElement = doc.appendChild(make('html'));
  doc.head = doc.documentElement.appendChild(make('head'));
  const body = doc.documentElement.appendChild(make('body'));
  const list = body.appendChild(make('main'));
  const header = list.appendChild(make('header'));
  const results = list.appendChild(make('section'));
  const detail = body.appendChild(make('section', { hidden: '', 'data-e2e': 'feed-active-video' }));
  const owner = parent => {
    const box = parent.appendChild(make('div', { 'data-e2e': 'searchbar-container' }));
    const input = box.appendChild(make('input', { 'data-e2e': 'searchbar-input' })); input.value = 'agi架构';
    box.appendChild(make('button', { 'data-e2e': 'searchbar-button' }));
    return box;
  };
  const initialOwner = owner(header);
  if (nativeCssHidden) {
    const input = initialOwner.querySelector('input');
    input.computed.display = 'none'; input.rect = { width: 0, height: 0 };
  }
  let callback;
  doc.createElement = tag => make(tag);
  doc.createComment = text => { const node = make('comment'); node.nodeType = 8; node.textContent = text; return node; };
  doc.addEventListener = doc.removeEventListener = () => {};
  const win = { location: { hostname: 'www.douyin.com', href: 'https://www.douyin.com/search/agi%E6%9E%B6%E6%9E%84' },
    getComputedStyle: node => ({ ...node.computed, display: node.style.getPropertyValue('display') || node.computed.display }),
    addEventListener() {}, removeEventListener() {},
    MutationObserver: class { constructor(cb) { callback = cb; } observe() {} disconnect() {} },
  };
  const controller = redirect.createController({ window: win, document: doc,
    chrome: { runtime: { sendMessage(_message, done) { done({ rules: { highRiskDomains: ['douyin.com'] } }); } } } });
  controller.start();
  const entry = () => doc.querySelector('[data-msp-native-search-root="true"]');
  const flush = target => callback([{ type: 'childList', target, addedNodes: [], removedNodes: [] }]);
  return { doc, body, list, header, results, detail, initialOwner, owner, make, controller, entry, flush };
}

test('TC-NS-19 抖音隐藏的播放层原生input不能抢走列表入口', () => {
  const h = douyinReturnFixture(); const root = h.entry();
  h.owner(h.detail); h.flush(h.detail);
  assert.equal(h.entry(), root);
  assert.equal(root.parentNode, h.header);
  assert.equal(redirect.isRenderedSearchControl(root, { getComputedStyle: n => n.computed }), true);
  h.controller.destroy();
});

for (const closeMode of ['unmount', 'hide']) {
  test(`TC-NS-19 抖音关闭播放层(${closeMode})后无原生input重建也恢复同一入口`, () => {
    const h = douyinReturnFixture(); const root = h.entry(); const field = root.querySelector('input');
    field.selectionStart = field.selectionEnd = 3;
    h.list.setAttribute('hidden', ''); h.detail.removeAttribute('hidden');
    h.owner(h.detail); h.flush(h.body);
    assert.equal(root.parentNode, h.detail);
    h.list.removeAttribute('hidden');
    if (closeMode === 'unmount') h.body.removeChild(h.detail);
    else h.detail.setAttribute('hidden', '');
    h.flush(h.body);
    assert.equal(h.entry(), root);
    assert.equal(root.parentNode, h.header);
    assert.equal(field.value, 'agi架构');
    assert.equal(field.selectionStart, 3);
    assert.equal(h.doc.querySelectorAll('[data-msp-native-search-root="true"]').length, 1);
    assert.equal(h.results.parentNode, h.list);
    h.controller.destroy();
  });
}

test('TC-NS-19 只隐藏列表期间不强行造框，原区域卸载后不挂到body', () => {
  const h = douyinReturnFixture(); const root = h.entry();
  h.list.setAttribute('hidden', ''); h.flush(h.body);
  assert.equal(root.parentNode, h.header);
  h.body.removeChild(h.list); h.flush(h.body);
  assert.equal(h.entry(), null);
  assert.equal(h.body.querySelectorAll('[data-msp-native-search-root="true"]').length, 0);
  h.controller.destroy();
});

test('TC-NS-19 多轮播放返回不重复入口，停用时恢复原生owner并回收锚点', () => {
  const h = douyinReturnFixture(); const root = h.entry();
  for (let cycle = 0; cycle < 3; cycle++) {
    h.list.setAttribute('hidden', ''); h.detail.removeAttribute('hidden');
    h.owner(h.detail); h.flush(h.body);
    h.list.removeAttribute('hidden'); h.detail.setAttribute('hidden', ''); h.flush(h.body);
    assert.equal(h.entry(), root);
    assert.equal(root.parentNode, h.header);
    assert.equal(h.doc.querySelectorAll('[data-msp-native-search-root="true"]').length, 1);
  }
  h.controller.destroy();
  assert.equal(h.initialOwner.parentNode, h.header);
  assert.equal(h.doc.querySelector('[data-msp-native-search-root="true"]'), null);
  const comments = node => node.children.reduce((n, child) => n + (child.nodeType === 8 ? 1 : 0) + comments(child), 0);
  assert.equal(comments(h.doc), 0);
});

test('TC-NS-19 原生input已被扩展CSS隐藏但owner可见时仍创建新框', () => {
  const h = douyinReturnFixture({ nativeCssHidden: true });
  assert.ok(h.entry());
  assert.equal(h.entry().parentNode, h.header);
  h.controller.destroy();
});

test('TC-NS-19 站点清空头部子节点时复用原框，不覆盖其他控件', () => {
  const h = douyinReturnFixture(); const root = h.entry();
  for (const node of [...h.header.children]) h.header.removeChild(node);
  const close = h.header.appendChild(h.make('button', { 'aria-label': '返回列表' }));
  h.flush(h.header);
  assert.equal(h.entry(), root);
  assert.equal(root.parentNode, h.header);
  assert.equal(close.parentNode, h.header);
  h.controller.destroy();
});

test('TC-NS-19 display:contents搜索外壳不阻碍原位置恢复，恢复后扫描不循环写入', () => {
  const h = douyinReturnFixture(); const root = h.entry();
  h.header.style.setProperty('display', 'contents'); h.header.rect = { width: 0, height: 0 };
  h.header.removeChild(root); h.flush(h.header);
  assert.equal(h.entry(), root);
  const writes = root.style.writes;
  for (let cycle = 0; cycle < 3; cycle++) h.flush(h.header);
  assert.equal(root.style.writes, writes);
  assert.equal(h.doc.querySelectorAll('[data-msp-native-search-root="true"]').length, 1);
  h.controller.destroy();
});

test('TC-NS-19 原列表头部卸载后重建owner也复用脱离DOM的原输入框', () => {
  const h = douyinReturnFixture(); const root = h.entry(); const field = root.querySelector('input');
  field.selectionStart = field.selectionEnd = 3;
  h.list.removeChild(h.header); h.flush(h.list);
  assert.equal(h.entry(), null);
  const nextHeader = h.list.appendChild(h.make('header'));
  h.owner(nextHeader); h.flush(nextHeader);
  assert.equal(h.entry(), root);
  assert.equal(root.parentNode, nextHeader);
  assert.equal(field.value, 'agi架构'); assert.equal(field.selectionStart, 3);
  assert.equal(h.doc.querySelectorAll('[data-msp-native-search-root="true"]').length, 1);
  h.controller.destroy();
});

for (const host of ['www.bing.com', 'cn.bing.com']) {
  test(`TC-NS-20 ${host}: 无高风险规则也识别必应首页/结果页input与textarea`, () => {
    const site = redirect.getTargetSite(host, []);
    assert.equal(site?.siteDomain, 'bing.com');
    assert.equal(site.redirectAlways, true);
    for (const tag of ['input', 'textarea']) {
      const h = scanner(host);
      const box = h.root.appendChild(new Element('div', { class: 'b_searchboxForm' }));
      const field = box.appendChild(new Element(tag, { id: 'sb_form_q', name: 'q' }));
      const hidden = h.root.appendChild(new Element('div', { hidden: '' }));
      hidden.appendChild(new Element(tag, { name: 'q' }));
      h.root.appendChild(new Element('input', { name: 'unrelated' }));
      assert.equal(h.scan(), 1);
      assert.equal(h.replaced[0].input, field);
    }
    assert.equal(redirect.getTargetSite('notbing.com', []), null);
    assert.equal(redirect.DEFAULT_HIGH_RISK_DOMAINS.includes('bing.com'), false);
  });
}

test('TC-NS-20 必应替换最窄搜索外壳，不移除结果和账户控件，停用恢复原框', () => {
  const doc = new Element('document'); doc.nodeType = 9;
  const make = (tag, attrs = {}) => { const n = new Element(tag, attrs); n.addEventListener = () => {}; return n; };
  doc.documentElement = doc.appendChild(make('html'));
  doc.head = doc.documentElement.appendChild(make('head'));
  const body = doc.documentElement.appendChild(make('body'));
  const form = body.appendChild(make('form', { id: 'sb_form', action: '/search' }));
  const account = body.appendChild(make('a', { id: 'id_l', href: '/account' }));
  const box = form.appendChild(make('div', { class: 'b_searchboxForm' }));
  box.exactMatches.add('.b_searchboxForm');
  const native = box.appendChild(make('textarea', { id: 'sb_form_q', name: 'q' })); native.value = '必应 测试';
  box.appendChild(make('input', { id: 'sb_form_go', type: 'submit' }));
  const results = body.appendChild(make('main', { id: 'b_results' }));
  const suggestions = body.appendChild(make('div', { id: 'sw_as' }));
  suggestions.exactMatches.add('#sw_as');
  const sidebar = body.appendChild(make('aside'));
  doc.createElement = tag => make(tag); doc.addEventListener = doc.removeEventListener = () => {};
  const win = { location: { hostname: 'cn.bing.com', href: 'https://cn.bing.com/search?q=%E5%BF%85%E5%BA%94' },
    getComputedStyle: n => n.computed, addEventListener() {}, removeEventListener() {},
    MutationObserver: class { observe() {} disconnect() {} } };
  const controller = redirect.createController({ window: win, document: doc,
    chrome: { runtime: { sendMessage(_message, done) { done({ rules: { highRiskDomains: [] } }); } } } });
  controller.start();
  const root = doc.querySelector('[data-msp-native-search-root="true"]');
  assert.ok(root); assert.equal(root.parentNode, form);
  assert.equal(root.querySelector('input').value, '必应 测试');
  assert.equal(root.querySelector('input').readOnly, true);
  assert.equal(native.parentNode, box); assert.equal(box.parentNode, null);
  assert.equal(suggestions.parentNode, null);
  for (const n of [account, results, sidebar]) assert.equal(n.parentNode, body);
  controller.destroy();
  assert.equal(box.parentNode, form); assert.equal(root.parentNode, null);
});

test('TC-NS-20 必应注入替换样式，首页与结果页建议层仅在激活时隐藏', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const styles = manifest.content_scripts.find(s => s.css?.includes('content/styles/native-search-redirect.css'));
  assert.ok(styles.matches.includes('*://*.bing.com/*'));
  const css = read('extension/content/styles/native-search-redirect.css');
  assert.match(css, /html\[data-msp-native-search-active="bing\.com"\] #sw_as/);
  assert.match(css, /html\[data-msp-native-search-active="bing\.com"\] #sa_ul/);
});

for (const host of ['www.google.com', 'www.google.com.hk']) {
  test(`TC-NS-21 ${host}: 仅空关键词首页和webhp居中，不改变结果/图片页`, () => {
    const site = redirect.getTargetSite(host, []);
    const doc = { createElement: tag => new Element(tag) };
    const owner = new Element('form', { role: 'search' });
    for (const path of ['/', '/?hl=zh-CN', '/webhp?hl=zh-CN', '/?q=', '/search?q=hello', '/?q=hello', '/imghp']) {
      const root = redirect.createReplacementRoot(doc, owner, site, `https://${host}${path}`);
      redirect.setReplacementRootStyle(root);
      const home = ['/', '/?hl=zh-CN', '/webhp?hl=zh-CN', '/?q='].includes(path);
      assert.equal(root.getAttribute('data-msp-native-search-layout'), home ? 'google-home' : null, path);
      assert.equal(root.style.getPropertyValue('margin'), home ? '0 auto' : '0', path);
      assert.equal(root.style.getPropertyValue('display'), home ? 'flex' : 'inline-flex', path);
      assert.equal(root.style.getPropertyValue('width'), home ? 'fit-content' : 'auto', path);
    }
  });
}

test('TC-NS-21 Google生产控制器按页面布局创建新框，转到结果页复用时解除居中', () => {
  const doc = new Element('document'); doc.nodeType = 9;
  const make = (tag, attrs = {}) => { const n = new Element(tag, attrs); n.addEventListener = () => {}; return n; };
  doc.documentElement = doc.appendChild(make('html'));
  doc.head = doc.documentElement.appendChild(make('head'));
  const body = doc.documentElement.appendChild(make('body'));
  const home = body.appendChild(make('main'));
  const owner = home.appendChild(make('form', { role: 'search' }));
  owner.appendChild(make('textarea', { name: 'q' }));
  const logo = body.appendChild(make('div', { id: 'logo' }));
  doc.createElement = tag => make(tag); doc.addEventListener = doc.removeEventListener = () => {};
  const win = { location: { hostname: 'www.google.com', href: 'https://www.google.com/' },
    getComputedStyle: n => n.computed, addEventListener() {}, removeEventListener() {},
    MutationObserver: class { observe() {} disconnect() {} } };
  const controller = redirect.createController({ window: win, document: doc,
    chrome: { runtime: { sendMessage(_message, done) { done({ rules: { highRiskDomains: [] } }); } } } });
  controller.start();
  const root = doc.querySelector('[data-msp-native-search-root="true"]');
  assert.ok(root); assert.equal(root.parentNode, home);
  assert.equal(root.getAttribute('data-msp-native-search-layout'), 'google-home');
  assert.equal(root.style.getPropertyValue('margin'), '0 auto');
  assert.equal(logo.parentNode, body);
  win.location.href = 'https://www.google.com/search?q=hello';
  const header = body.appendChild(make('header'));
  const nextOwner = header.appendChild(make('form', { role: 'search' }));
  const field = nextOwner.appendChild(make('input', { name: 'q' })); field.value = 'hello';
  controller.scan(nextOwner);
  assert.equal(root.parentNode, header);
  assert.equal(root.getAttribute('data-msp-native-search-layout'), null);
  assert.equal(root.style.getPropertyValue('margin'), '0');
  assert.equal(root.style.getPropertyValue('width'), 'auto');
  assert.equal(root.style.getPropertyValue('align-self'), '');
  assert.equal(root.style.getPropertyValue('max-width'), '');
  assert.equal(root.querySelector('input').value, 'hello');
  assert.equal(doc.querySelectorAll('[data-msp-native-search-root="true"]').length, 1);
  controller.destroy();
});

test('TC-NS-21 首页居中CSS仅作用于Google标记，桌面与移动输入尺寸仍复用通用断点', () => {
  const css = read('extension/content/styles/native-search-redirect.css');
  assert.match(css, /html\[data-msp-native-search-active\^="google\."\][\s\S]*?\[data-msp-native-search-layout="google-home"\][\s\S]*?margin: 0 auto !important/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?--msp-search-font-size: 12px/);
});
