'use strict';

// Bounded negative control: remove only the proven portal-owner guard in a
// temporary copy and require both structural and browser regressions to fail.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sourcePath = path.resolve(__dirname, '../extension/content/native-search-redirect-runtime.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const guard = `    if (!matchesAnySelector(candidate, targetSite?.ownerSelectors)) {
      return false;
    }
`;
assert.equal(source.split(guard).length - 1, 1, 'expected exactly one portal guard; update negative control if implementation changes');
assert.ok(process.env.MYSEARCHPAGE_PLAYWRIGHT_MODULE && process.env.MYSEARCHPAGE_CHROMIUM_BINARY,
  'set MYSEARCHPAGE_PLAYWRIGHT_MODULE and MYSEARCHPAGE_CHROMIUM_BINARY');
const scratch = fs.mkdtempSync(path.join(process.env.PI_SCRATCH_DIR || os.tmpdir(), 'douyin-portal-negative-'));
try {
  const mutant = path.join(scratch, 'native-search-redirect-runtime.js');
  fs.writeFileSync(mutant, source.replace(guard, ''));
  function run(args) {
    const result = spawnSync(process.execPath, args, {
      env: { ...process.env, MYSEARCHPAGE_NATIVE_REDIRECT_SOURCE: mutant },
      encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, 'timeout or crash is not evidence of regression detection');
    assert.equal(result.status, 1, 'old logic must fail assertions, not pass or fail to launch');
    return result.stdout + result.stderr;
  }
  const unit = run(['--test', '--test-reporter=tap', '--test-concurrency=1', path.join(__dirname, 'native-search-redirect-douyin-portal.test.js')]);
  assert.match(unit, /# fail 5\b/, 'all five portal-owner boundary cases must reject old logic');
  assert.match(unit, /# pass 1\b/, 'the unrelated-close-control boundary remains valid');
  for (const depth of [1, 2, 4]) assert.match(unit, new RegExp('not ok \\d+ - TC-DY-DETAIL-REPEAT-002/003 unmarked ' + depth + ' wrappers'));
  assert.match(unit, /^ok \d+ - TC-DY-DETAIL-REPEAT-004 marked shared shell/m);
  console.log('PASS negative control: old logic fails 5 portal-owner boundary tests; unrelated-close-control test still passes.');
  const browser = run([path.join(__dirname, 'native-search-redirect-douyin-portal.browser.cjs')]);
  assert.match(browser, /AssertionError/);
  assert.match(browser, /initial search replacement detached the future portal host/,
    'failure must be the reproduced portal detachment, not a media/toolchain error');
  console.log('PASS negative control: browser rejects detached future portal host before a player exists.');
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
  assert.equal(fs.readFileSync(sourcePath, 'utf8'), source, 'production source must remain untouched');
}
