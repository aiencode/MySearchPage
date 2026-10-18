'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.MYSEARCHPAGE_JSDOM_MODULE || 'jsdom');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

async function harness(t, markup, keyword = 'picot', blockedKeywords = [], overrides = {}) {
  const dom = new JSDOM(`<!doctype html><html><head><title>${keyword} - 小红书搜索</title></head><body>${markup}</body></html>`, {
    url: `https://www.xiaohongshu.com/search_result/?keyword=${encodeURIComponent(keyword)}&type=51`, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const window = dom.window;
  window.chrome = {
    runtime: { lastError: null, getURL: value => `chrome-extension://fixture/${value}`, sendMessage(message, callback) {
      callback?.(message.type === 'GET_BLOCKING_RULES' ? { success: true, rules: {
        blockedKeywords, blockedUrlPatterns: [], blockedAuthors: [], highRiskDomains: ['xiaohongshu.com'],
        homepageRules: { 'xiaohongshu.com': { allowHomepage: false } },
        ...overrides,
      } } : { success: true, enabled: true });
    } },
    storage: { onChanged: { addListener() {} } },
  };
  window.eval(read('extension/shared/blocking-rules.js'));
  window.eval(read('extension/content/search-media-adapters.js'));
  let source = read('extension/content/blocking-controller.js');
  // Test-only inspection of production component-selection functions.
  assert.equal(source.split('  init();').length, 2, 'test hook must target exactly one production init call');
  source = source.replace('  init();', '  global.testBlocking = { resultCardForElement, hideBlockedCard, dispose() { observer?.disconnect(); queuedNodes.clear(); } };\n  init();');
  window.eval(source);
  t.after(async () => {
    window.testBlocking.dispose();
    await new Promise(resolve => setImmediate(resolve));
    window.close();
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  return window;
}

for (const keyword of ['picot', '资料检索', '冷压端子']) {
  test(`Xiaohongshu startup homepage navigation cannot replace the app root: ${keyword}`, async t => {
    const w = await harness(t, '<div id="app" data-v-app><a id="home" href="/explore"><svg></svg><span>发现</span></a><div class="search-layout" id="search-host"></div></div>', keyword);
    assert.ok(w.document.querySelector('#search-host'), 'empty search host must survive before results hydrate');
    assert.ok(w.document.querySelector('#app > #search-host'));
    assert.equal(w.document.querySelector('#app').hasAttribute('data-mysearch-blocked-card'), false);
    assert.equal(w.document.documentElement.hasAttribute('data-mysearch-page-gate'), false);
    const card = w.document.createElement('section');
    card.className = 'note-item'; card.id = 'ordinary-note';
    card.innerHTML = '<a href="/explore/note123"><img alt="资料封面"><h2>普通资料</h2></a>';
    w.document.querySelector('#search-host').appendChild(card);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(w.document.querySelector('#ordinary-note h2'));
    assert.equal(card.hasAttribute('data-mysearch-blocked-card'), false);
    assert.equal(w.document.querySelectorAll('#app > .mysearch-blocked-card-placeholder').length, 0);
  });
}

test('Xiaohongshu result-root and layout containers stay intact while a matched note is replaced', async t => {
  const w = await harness(t, '<div id="app"><div class="search-layout"><main id="content"><div class="feeds-container" id="results"><a id="feed-home" href="/explore"><svg></svg><span>发现</span></a><section class="note-item" id="blocked-note"><a href="/explore/note123"><h2>BLOCKME 资料</h2><img></a></section><section class="note-item" id="allowed-note"><a href="/explore/note456"><h2>普通资料</h2><img></a></section></div></main></div></div>', 'picot', ['BLOCKME']);
  assert.ok(w.document.querySelector('#allowed-note h2'));
  assert.ok(w.document.querySelector('#blocked-note .mysearch-blocked-card-placeholder'));
  for (const selector of ['#app', '.search-layout', '#content', '#results']) {
    const container = w.document.querySelector(selector);
    assert.ok(container, selector);
    assert.equal(container.hasAttribute('data-mysearch-blocked-card'), false, selector);
    assert.equal(w.testBlocking.hideBlockedCard(container, { kind: 'keyword', value: 'BLOCKME' }), false, `replacement guard: ${selector}`);
  }
  assert.ok(w.document.querySelector('#allowed-note h2'));
});

test('a non-semantic page layout containing search content is not promoted from its homepage icon', async t => {
  const w = await harness(t, '<div class="outer-layout" id="layout"><a href="/explore"><svg></svg><span>发现</span></a><main><div id="search-results"></div></main></div>');
  assert.ok(w.document.querySelector('#search-results'));
  assert.equal(w.document.querySelector('#layout').hasAttribute('data-mysearch-blocked-card'), false);
});

test('Xiaohongshu inner non-semantic shell must not become a card before any results root exists', async t => {
  const w = await harness(t, '<div id="app"><div class="container" id="inner-shell"><a href="/explore"><svg></svg><span>发现</span></a><div id="pending-results"></div></div></div>');
  assert.ok(w.document.querySelector('#pending-results'));
  assert.equal(w.document.querySelector('#inner-shell').hasAttribute('data-mysearch-blocked-card'), false);
});

test('TC-REG-XHS-002 deeply nested untyped shells cannot be promoted from a homepage icon', async t => {
  const w = await harness(t, '<div id="shell"><div id="inner"><div id="leaf-shell">' +
    '<a id="home" href="/explore"><svg></svg><span>发现</span></a>' +
    '<div id="pending"></div></div></div></div>');
  assert.ok(w.document.querySelector('#pending'), 'results mounting point survives before any named search root exists');
  for (const id of ['shell', 'inner', 'leaf-shell']) {
    assert.equal(w.document.getElementById(id).hasAttribute('data-mysearch-blocked-card'), false);
  }
  assert.equal(w.testBlocking.resultCardForElement(w.document.getElementById('home'))?.id, 'home',
    'a navigation match may select itself, never a parent shell');
});

for (const [kind, overrides, content] of [
  ['keyword', { blockedKeywords: ['BLOCKME'] }, '<h2>BLOCKME 笔记</h2>'],
  ['url', { blockedUrlPatterns: ['/explore/blocked-note'] }, '<h2>普通标题</h2>'],
  ['author', { blockedAuthors: ['BLOCKAUTHOR'] }, '<h2>普通标题</h2><span class="author">BLOCKAUTHOR</span>'],
]) {
  test(`TC-REG-XHS-003 ${kind} match replaces only its note and removes its actionable targets`, async t => {
    const w = await harness(t, '<div id="app"><main><div class="feeds-container" id="results">' +
      `<section class="note-item" id="blocked"><a href="/explore/blocked-note">${content}<img alt="封面"></a></section>` +
      '<section class="note-item" id="safe"><a href="/explore/safe-note"><h2>普通资料</h2><img></a></section>' +
      '</div></main></div>', 'picot', [], overrides);
    const blocked = w.document.getElementById('blocked');
    assert.equal(blocked.getAttribute('data-mysearch-blocked-card-kind'), kind);
    assert.equal(blocked.querySelectorAll('.mysearch-blocked-card-placeholder').length, 1);
    assert.equal(blocked.querySelectorAll('a[href], h2, img, .author').length, 0,
      'original title, media, author and clickable note targets must be removed');
    assert.equal(w.document.querySelector('#safe a')?.getAttribute('href'), '/explore/safe-note');
    assert.equal(w.document.querySelector('#safe h2')?.textContent, '普通资料');
    assert.equal(w.document.getElementById('results').hasAttribute('data-mysearch-blocked-card'), false);
    assert.equal(w.document.documentElement.hasAttribute('data-mysearch-page-gate'), false);
  });
}

test('TC-REG-XHS-004 subsequent result batches preserve previous safe notes and keep placeholders local', async t => {
  const w = await harness(t, '<div id="app"><div class="search-layout"><div class="feeds-container" id="results"></div></div></div>',
    'picot', ['BLOCKME']);
  const results = w.document.getElementById('results');
  for (let batch = 1; batch <= 3; batch++) {
    results.insertAdjacentHTML('beforeend',
      `<section class="note-item" id="safe-${batch}"><a href="/explore/safe-${batch}"><h2>普通资料 ${batch}</h2><img></a></section>` +
      `<section class="note-item" id="blocked-${batch}"><a href="/explore/blocked-${batch}"><h2>BLOCKME ${batch}</h2><img></a></section>`);
    const deadline = Date.now() + 1000;
    while (!w.document.querySelector(`#blocked-${batch} .mysearch-blocked-card-placeholder`) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(results.querySelectorAll('.mysearch-blocked-card-placeholder').length, batch);
    for (let previous = 1; previous <= batch; previous++) {
      assert.equal(results.querySelector(`#safe-${previous} h2`)?.textContent, `普通资料 ${previous}`);
      assert.ok(results.querySelector(`#safe-${previous} a[href="/explore/safe-${previous}"]`));
      assert.equal(results.querySelector(`#blocked-${previous} a[href]`), null);
    }
    assert.equal(results.hasAttribute('data-mysearch-blocked-card'), false);
    assert.equal(w.document.getElementById('app').hasAttribute('data-mysearch-blocked-card'), false);
  }
});
