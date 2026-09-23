'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(
  path.join(ROOT, relativePath),
  'utf8'
);

function cssBlocks(source) {
  const blocks = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = pattern.exec(source))) {
    blocks.push({
      selector: match[1].trim(),
      declarations: match[2],
    });
  }

  return blocks;
}

test('Douyin mobile layout never forces player/xgplayer height to auto', () => {
  const css = read(
    'extension/content/styles/douyin-mobile.css'
  );
  const playerBlocks = cssBlocks(css).filter(block =>
    /player|xgplayer/i.test(block.selector)
  );

  assert.ok(
    playerBlocks.length > 0,
    '测试必须实际找到 Douyin player/xgplayer CSS 规则'
  );

  for (const block of playerBlocks) {
    assert.doesNotMatch(
      block.declarations,
      /height\s*:\s*auto\s*!important/i,
      `播放器规则不得强制 height:auto：${block.selector}`
    );
  }
});

test('Douyin runtime transform leaves player height and aspect ratio to the site', () => {
  const source = read(
    'extension/content/sites/douyin.js'
  );

  assert.match(
    source,
    /function optimizeVideoPlayer\(\)/
  );
  assert.match(
    source,
    /player\.style\.maxWidth\s*=\s*['"]100%['"]/
  );
  assert.doesNotMatch(
    source,
    /player\.style\.height\s*=\s*['"]auto['"]/
  );
  assert.doesNotMatch(
    source,
    /player\.style\.aspectRatio\s*=/
  );
});
