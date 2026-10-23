'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.MYSEARCHPAGE_JSDOM_MODULE || 'jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '..', 'extension', file), 'utf8');
const origin = 'https://www.xiaohongshu.com';
const first = '/explore/6ab0c52a000000003a02d5e0';
const second = '/explore/6ab4b34a000000001802b79f';
const wait = () => new Promise(resolve => setTimeout(resolve, 25));
async function fixture(t, { entry = first, home = '/explore', explicit = [], homepageAllowed = false } = {}) {
  const dom = new JSDOM('<!doctype html><title>普通帖子 A</title><header><a id="homepage" href="/explore">首页</a></header><main class="feeds-container"><button id="first">帖子 A</button><button id="second">帖子 B</button></main>', { url: origin + entry, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const messages = [];
  const seed = { back: '/search_result?keyword=safe', current: entry, forward: null, replaced: true, position: 17, scroll: { left: 3, top: 24 }, marker: { keep: 'whole-state' } };
  w.history.replaceState(seed, '', entry);
  let logicalRoute = entry;
  w.chrome = { runtime: { getURL: value => value, sendMessage(message, callback) {
    messages.push(message);
    callback?.(message.type === 'GET_BLOCKING_RULES' ? { success: true, rules: { blockedKeywords: [], blockedUrlPatterns: explicit, blockedAuthors: [], highRiskDomains: ['xiaohongshu.com'], homepageRules: { 'xiaohongshu.com': { allowHomepage: homepageAllowed } } } } : { success: true, enabled: true });
  } }, storage: { onChanged: { addListener() {} } } };
  w.HTMLMediaElement.prototype.pause = function () {};
  w.open = () => ({ opened: true });
  function show(notePath, direct) {
    w.document.querySelector('.note-detail-mask')?.remove();
    const detail = w.document.createElement('article');
    detail.className = 'note-detail-mask';
    detail.dataset.noteId = notePath.split('/').at(-1);
    detail.innerHTML = `<h1>${notePath === first ? '普通帖子 A' : '普通帖子 B'}</h1><button id="close">关闭帖子</button>`;
    w.document.body.append(detail);
    w.document.title = notePath === first ? '普通帖子 A' : '普通帖子 B';
    detail.querySelector('#close').onclick = () => {
      detail.remove(); w.document.title = '小红书 - 社区';
      if (direct) {
        // Native direct-link close: router.replace commits its internal route even
        // if an extension silently cancels the underlying replaceState call.
        const next = { ...w.history.state, current: home, replaced: true };
        w.history.replaceState(next, '', home);
        logicalRoute = home;
      } else w.history.back();
    };
  }
  w.addEventListener('popstate', () => {
    logicalRoute = w.location.pathname;
    if (/^\/explore\/.+/.test(w.location.pathname)) show(w.location.pathname, true);
    else { w.document.querySelector('.note-detail-mask')?.remove(); w.document.title = '小红书 - 社区'; }
  });
  for (const [id, notePath] of [['first', first], ['second', second]]) w.document.getElementById(id).onclick = () => {
    // The site's normal note provider writes back/current without changing its
    // logical collection route, then really goes back when the modal closes.
    w.history.pushState({ back: logicalRoute, current: notePath }, '', notePath);
    show(notePath, false);
  };
  if (entry === first) show(first, true);
  w.eval(read('shared/blocking-rules.js'));
  w.eval(read('content/search-media-adapters.js'));
  w.eval(read('content/blocking-page-hook.js'));
  w.eval(read('content/blocking-controller.js').replace('  init();', '  global.disposeTest = () => { observer?.disconnect(); queuedNodes.clear(); };\n  init();'));
  t.after(async () => { w.disposeTest(); await wait(); w.close(); });
  await wait();
  const closeNormal = async () => {
    const popped = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('normal close did not return through history')), 1000);
      w.addEventListener('popstate', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    w.document.querySelector('#close').click(); await popped; await wait();
  };
  return { w, seed, messages, closeNormal, gated: () => w.document.documentElement.hasAttribute('data-mysearch-page-gate') };
}
for (const card of ['first', 'second']) test(`direct refresh → close → ${card} → back does not reopen the original post`, async t => {
  const h = await fixture(t);
  h.w.document.querySelector('#close').click();
  await wait();
  assert.equal(h.w.location.pathname, '/explore', 'the native close must atomically replace the original entry');
  assert.deepEqual(JSON.parse(JSON.stringify(h.w.history.state)), { ...h.seed, current: '/explore' });
  assert.equal(h.gated(), false, 'returning to the already-mounted background is not a new homepage entry');
  h.w.document.getElementById(card).click(); await wait();
  assert.equal(h.w.document.querySelectorAll('.note-detail-mask').length, 1);
  assert.equal(h.w.history.state.back, '/explore');
  await h.closeNormal();
  assert.equal(h.w.location.pathname, '/explore');
  assert.equal(h.w.document.querySelectorAll('.note-detail-mask').length, 0, 'one close must not reveal post A');
  assert.equal(h.gated(), false);
  assert.equal(h.w.document.getElementById('homepage').dispatchEvent(new h.w.MouseEvent('click', { bubbles: true, cancelable: true })), false, 'explicit homepage entry remains blocked');
  assert.equal(h.w.open('/explore'), null, 'window.open does not inherit the in-document return permission');
  const next = { ...h.w.history.state, scroll: { left: 0, top: 100 }, extra: 'preserved' };
  h.w.history.replaceState(next, '', '/explore');
  assert.equal(h.w.history.state.extra, 'preserved', 'repeated native background bookkeeping remains valid');
});
test('keyword-search entry still opens and closes normal notes without a direct-link exemption', async t => {
  const h = await fixture(t, { entry: '/search_result?keyword=safe' });
  h.w.document.getElementById('second').click(); await wait(); await h.closeNormal();
  assert.equal(h.w.location.pathname, '/search_result');
  assert.equal(h.w.document.querySelectorAll('.note-detail-mask').length, 0);
  assert.equal(h.gated(), false);
});
test('homepage replace while the note is still visible remains blocked', async t => {
  const h = await fixture(t);
  h.w.history.replaceState({}, '', '/explore');
  assert.equal(h.w.location.pathname, first);
});
test('return exception cannot bypass an explicit URL rule', async t => {
  const h = await fixture(t, { home: '/explore?blocked=1', explicit: ['blocked=1'] });
  h.w.document.querySelector('#close').click(); await wait();
  assert.equal(h.w.location.pathname, first);
});
test('return exception requires an already-mounted visible collection', async t => {
  const h = await fixture(t); h.w.document.querySelector('main').remove();
  h.w.document.querySelector('#close').click(); await wait();
  assert.equal(h.w.location.pathname, first);
});
test('fresh homepage document receives no permission from a previous note return', async t => {
  const h = await fixture(t, { entry: '/explore' });
  assert.equal(h.gated(), true);
});
