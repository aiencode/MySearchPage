'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require(process.env.MYSEARCHPAGE_JSDOM_MODULE || 'jsdom');
const redirect = require(process.env.MYSEARCHPAGE_NATIVE_REDIRECT_SOURCE || '../extension/content/native-search-redirect-runtime.js');
const site = redirect.getTargetSite('www.douyin.com', ['douyin.com']);

function setup(wrappers, marked = false) {
  const dom = new JSDOM(`<header><div id="portal-host">${wrappers.map((name, i) =>
    `<div class="${name}" data-fixture-wrapper="${i}">`).join('')}
    <div id="search-shell" ${marked ? 'data-e2e="searchbar-container"' : ''}>
      <div id="search-unit"><input data-e2e="searchbar-input"><button data-e2e="searchbar-button">搜索</button></div>
    </div>${'</div>'.repeat(wrappers.length)}</div></header><section id="results">原结果</section>`);
  return { dom, document: dom.window.document };
}

for (const wrappers of [[], ['dynamic'], ['search-shell', 'search-wrapper', 'random']]) {
  test(`TC-DY-DETAIL-REPEAT-002/003 unmarked ${wrappers.length + 1} wrappers are not replacement owners`, t => {
    const { dom, document } = setup(wrappers);
    t.after(() => dom.window.close());
    const host = document.querySelector('#portal-host');
    const ancestors = Array.from(document.querySelectorAll('[data-fixture-wrapper], #search-shell'));
    const input = document.querySelector('input');
    assert.equal(host.querySelectorAll('video,canvas,[aria-label="关闭详情"]').length, 0,
      'regression must be detected before any player or close control exists');
    const owner = redirect.findDouyinSearchOwner(input, site);
    assert.equal(owner, document.querySelector('#search-unit'));
    assert.ok(!ancestors.includes(owner));
    // Perform the actual replacement selected by the product and mount later.
    owner.replaceWith(document.createElement('button'));
    host.append(document.createElement('video'));
    assert.equal(document.querySelector('#portal-host'), host, 'same object, not a recreated lookalike');
    assert.ok(ancestors.every(node => node.isConnected), 'every unmarked wrapper remains connected');
    assert.equal(document.querySelector('video').parentElement, host);
  });
}

for (const [name, marker] of [
  ['data-e2e', ['data-e2e', 'searchbar-container']],
  ['form role', ['role', 'search']],
]) {
  test(`TC-DY-DETAIL-REPEAT-004 explicit ${name} owner is still replaceable`, t => {
    const { dom, document } = setup([], true);
    t.after(() => dom.window.close());
    let shell = document.querySelector('#search-shell');
    if (name === 'form role') {
      const form = document.createElement('form');
      form.setAttribute(...marker);
      form.append(...shell.childNodes);
      shell.replaceWith(form);
      shell = form;
    }
    assert.equal(redirect.findDouyinSearchOwner(document.querySelector('input'), site), shell);
    shell.replaceWith(document.createElement('button'));
    assert.ok(document.querySelector('#portal-host').isConnected);
    assert.ok(document.querySelector('#results').isConnected);
  });
}

test('TC-DY-DETAIL-REPEAT-004 marked shared shell cannot swallow an unrelated close control', t => {
  const { dom, document } = setup([], true);
  t.after(() => dom.window.close());
  const shell = document.querySelector('#search-shell');
  const close = document.createElement('button');
  close.setAttribute('aria-label', '关闭搜索结果');
  shell.prepend(close);
  const owner = redirect.findDouyinSearchOwner(document.querySelector('input'), site);
  assert.equal(owner, document.querySelector('#search-unit'));
  owner.replaceWith(document.createElement('button'));
  assert.ok(close.isConnected);
  assert.ok(shell.isConnected);
});
