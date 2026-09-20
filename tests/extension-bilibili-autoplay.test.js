const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '..', 'extension', 'content', 'sites', 'bilibili.js'),
  'utf8'
);

test('Bilibili content script disables the continuous-play toggle', () => {
  assert.match(source, /function disableContinuousPlayback\(\)/);
  assert.match(source, /querySelectorAll\('\.continuous-btn'\)/);
  assert.match(source, /querySelector\('\.switch-btn'\)/);
  assert.match(source, /classList\?\.contains\('on'\)/);
  assert.match(source, /if \(enabled\) toggle\.click\(\)/);
  assert.match(source, /new MutationObserver/);
});
