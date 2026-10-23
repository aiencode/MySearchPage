'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.MYSEARCHPAGE_JSDOM_MODULE || 'jsdom');
const redirect = require('../extension/content/native-search-redirect-runtime.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const settle = () => new Promise(resolve => setTimeout(resolve, 25));
const sites = [
  { name: 'xiaohongshu', search: 'https://www.xiaohongshu.com/search_result?keyword=safe', detail: '/explore/safe200', old: '/explore/old100', markup: '<div id="detail" class="note-detail-mask" data-note-id="safe200" style="display:none"><h1>普通资料</h1><button id="action">继续阅读</button></div>' },
  { name: 'douyin', search: 'https://www.douyin.com/search/safe', detail: '/video/200', old: '/video/100', markup: '<div id="detail" data-e2e="modal-video-container" data-aweme-id="200" style="display:none"><h1>普通资料</h1><button id="action">继续阅读</button></div>' },
];
async function harness(t, site, { title = 'BLOCKME 上个页面', rules = { blockedKeywords: ['BLOCKME'] }, url = site.search } = {}) {
  const dom = new JSDOM(`<!doctype html><title>${title}</title><div class="search-result-list"><a id="safe" href="${site.detail}">普通资料</a><a id="blocked" href="${site.old}">指定阻断地址</a></div>${site.markup}`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  // jsdom does not invalidate getComputedStyle after CSSOM mutations (unlike Chromium).
  // Invalidate only its test-document cache when the gate rule's declaration changes.
  const computedStyle = w.getComputedStyle.bind(w);
  let gateVisibility;
  let styleEpoch = 0;
  w.getComputedStyle = element => {
    const gateRule = Array.from(w.document.querySelector('#mysearch-blocking-style')?.sheet?.cssRules || [])
      .find(rule => rule.selectorText?.includes('body > *:not(#mysearch-blocking-notice)'));
    const nextVisibility = gateRule?.style?.getPropertyValue('visibility');
    if (nextVisibility !== gateVisibility) {
      gateVisibility = nextVisibility;
      w.document.documentElement.setAttribute('data-test-cssom-cache', String(++styleEpoch));
    }
    return computedStyle(element);
  };
  const messages = [];
  w.HTMLMediaElement.prototype.pause = function () {};
  w.chrome = { runtime: { getURL: x => x, sendMessage(message, callback) {
    messages.push(message);
    callback?.(message.type === 'GET_BLOCKING_RULES' ? { success: true, rules: { blockedKeywords: [], blockedUrlPatterns: [], blockedAuthors: [], highRiskDomains: [], ...rules } } : { success: true, enabled: true });
  } }, storage: { onChanged: { addListener() {} } } };
  w.eval(read('extension/shared/blocking-rules.js'));
  w.eval(read('extension/content/search-media-adapters.js'));
  w.eval(read('extension/content/blocking-page-hook.js'));
  w.eval(read('extension/content/blocking-controller.js').replace('  init();', '  global.disposeTest = () => { observer?.disconnect(); queuedNodes.clear(); };\n  init();'));
  t.after(async () => { w.disposeTest(); await settle(); w.close(); });
  await settle();
  return { w, messages, detail: w.document.querySelector('#detail'), gated: () => w.document.documentElement.hasAttribute('data-mysearch-page-gate') };
}
for (const site of sites) {
  for (const order of ['route-first', 'title-first']) test(`${site.name}: ${order} detail transition does not inherit an old blocked title`, async t => {
    const h = await harness(t, site);
    assert.equal(h.gated(), false);
    if (order === 'title-first') h.w.document.title = '普通新资料';
    h.w.document.querySelector('.search-result-list').style.display = 'none';
    h.w.history.pushState({}, '', site.detail);
    assert.equal(h.gated(), false, 'the route commit must not attribute the previous title to the new URL');
    h.detail.style.display = 'block';
    if (order === 'route-first') {
      await settle();
      assert.equal(h.gated(), false, 'the old title must not even temporarily gate the new detail');
      h.w.document.title = '普通新资料';
    }
    await settle();
    assert.equal(h.gated(), false);
    assert.equal(h.w.document.querySelector('#action').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, cancelable: true })), true);
    assert.equal(h.messages.some(message => message.event?.type === 'click'), false, 'safe transition must not record a blocked attempt');
  });
  test(`${site.name}: restored results ignore a stale detail URL but still block an explicit matching destination`, async t => {
    const h = await harness(t, site, { title: '普通结果', url: new URL(site.old, site.search).href, rules: { blockedUrlPatterns: [site.old] } });
    assert.equal(h.gated(), false);
    assert.equal(h.w.document.querySelector('#safe').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, cancelable: true })), true);
    assert.equal(h.w.document.querySelector('#blocked').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, cancelable: true })), false);
  });
  test(`${site.name}: an actual current blocked title still gates and a corrected title releases the gate`, async t => {
    const h = await harness(t, site, { title: '普通资料' });
    h.w.history.pushState({}, '', site.detail);
    h.detail.style.display = 'block';
    h.w.document.title = 'BLOCKME 当前资料';
    await settle();
    assert.equal(h.gated(), true, 'a genuinely updated blocked title must still block');
    h.w.history.replaceState({}, '', site.detail + '?tab=comments#reply');
    await settle();
    assert.equal(h.gated(), true, 'query/hash changes on the same content cannot release a real title block');
    h.w.document.title = '普通资料已更正';
    await settle();
    assert.equal(h.gated(), false, 'title gates cannot outlive their actual rule evidence');
  });
  test(`${site.name}: a new detail's own heading confirms a genuinely blocked unchanged title`, async t => {
    const h = await harness(t, site);
    h.detail.querySelector('h1').textContent = 'BLOCKME 上个页面';
    h.w.document.querySelector('.search-result-list').style.display = 'none';
    h.w.history.pushState({}, '', site.detail);
    h.detail.style.display = 'block';
    await settle();
    assert.equal(h.gated(), true, 'unchanged document titles need current content evidence, not unconditional exemption');
  });
}
for (const kind of ['note-detail-mask', 'video-detail-modal']) test(`${kind}: search popup sweeping cannot delete a content detail or its descendants`, () => {
  const dom = new JSDOM(`<div id="replacement"></div><div id="wrapper"><div class="${kind}" role="dialog"><h1>小说热榜</h1><div id="copy" style="position:absolute">猜你想搜：普通资料</div></div></div>`);
  const w = dom.window;
  const root = w.document.querySelector('#replacement');
  root.getBoundingClientRect = () => ({ left: 100, right: 300, top: 20, bottom: 56 });
  for (const node of w.document.querySelectorAll('#wrapper, [role="dialog"], #copy')) {
    node.getBoundingClientRect = () => ({ left: 0, right: 1200, top: 0, bottom: 800 });
    node.style.position = 'fixed';
    assert.equal(redirect.isLikelyDynamicSearchPopup(node, root, w), false, `content node ${node.id || kind} is not a search popup`);
  }
  dom.window.close();
});
