'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.MYSEARCHPAGE_JSDOM_MODULE || 'jsdom');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

async function harness(t, markup, keyword = 'picot', blockedKeywords = []) {
  const dom = new JSDOM(`<!doctype html><html><head><title>${keyword} - 小红书搜索</title></head><body>${markup}</body></html>`, {
    url: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&type=51`, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const window = dom.window;
  window.chrome = {
    runtime: { lastError: null, getURL: value => `chrome-extension://fixture/${value}`, sendMessage(message, callback) {
      callback?.(message.type === 'GET_BLOCKING_RULES' ? { success: true, rules: {
        blockedKeywords, blockedUrlPatterns: [], blockedAuthors: [], highRiskDomains: ['xiaohongshu.com'],
        homepageRules: { 'xiaohongshu.com': { allowHomepage: false } },
      } } : { success: true, enabled: true });
    } },
    storage: { onChanged: { addListener() {} } },
  };
  window.eval(read('extension/shared/blocking-rules.js'));
  window.eval(read('extension/content/search-media-adapters.js'));
  let source = read('extension/content/blocking-controller.js');
  // Test-only inspection of production component-selection functions.
  source = source.replace('  init();', '  global.testBlocking = { resultCardForElement, hideBlockedCard };\n  init();');
  window.eval(source);
  t.after(() => window.close());
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
