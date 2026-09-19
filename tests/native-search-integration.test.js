const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(
  path.join(ROOT, relativePath),
  'utf8'
);

test('替换脚本复用现有全站内容脚本和高风险域名策略', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));
  const entry = manifest.content_scripts.find(item =>
    item.js?.includes(
      'content/native-search-redirect-runtime.js'
    )
  );

  assert.ok(entry);
  assert.deepEqual(entry.matches, ['<all_urls>']);
  const styleEntry = manifest.content_scripts.find(item =>
    item.css?.includes('content/styles/native-search-redirect.css')
  );
  assert.ok(styleEntry);
  assert.deepEqual(styleEntry.matches, [
    '*://*.bilibili.com/*',
    '*://*.douyin.com/*',
    '*://*.youtube.com/*',
    '*://*.xiaohongshu.com/*',
  ]);
  assert.match(read('extension/shared/mysearch-navigation.js'), /navigation\/navigation\.html/);
  assert.match(read('extension/background/ua-controller.js'), /OPEN_MYSEARCH_PAGE/);
  assert.match(
    read(
      'extension/content/native-search-redirect-runtime.js'
    ),
    /douyin-owner-with-submit/
  );
  assert.match(
    read('extension/navigation/navigation.js'),
    /MYSEARCH_FOCUS_HASH/
  );
});

test('Bilibili 原生搜索所在的顶部容器不会再被插件隐藏', () => {
  assert.doesNotMatch(
    read('extension/content/sites/bilibili.js'),
    /^\s*['"]\.bili-header__bar['"],?\s*$/m
  );
  assert.doesNotMatch(
    read('extension/content/styles/bilibili-mobile.css'),
    /\.bili-header__bar\s*\{[\s\S]*?display:\s*none\s*!important;[\s\S]*?\}/
  );
});
