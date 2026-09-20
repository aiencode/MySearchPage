'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const extensionRoot = path.join(projectRoot, 'extension');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function pngDimensions(relativePath) {
  const data = fs.readFileSync(path.join(projectRoot, relativePath));
  assert.deepEqual([...data.subarray(0, 8)], [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ], `${relativePath} must be a PNG`);
  assert.equal(data.toString('ascii', 12, 16), 'IHDR', `${relativePath} must contain IHDR`);
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20),
  };
}

test('extension manifest icons use their declared dimensions', () => {
  const manifest = JSON.parse(read('extension/manifest.json'));

  for (const [declaredSize, relativePath] of Object.entries(manifest.icons || {})) {
    const dimensions = pngDimensions(path.posix.join('extension', relativePath));
    assert.equal(dimensions.width, Number(declaredSize), relativePath);
    assert.equal(dimensions.height, Number(declaredSize), relativePath);
  }

  for (const [declaredSize, relativePath] of Object.entries(manifest.action?.default_icon || {})) {
    const dimensions = pngDimensions(path.posix.join('extension', relativePath));
    assert.equal(dimensions.width, Number(declaredSize), relativePath);
    assert.equal(dimensions.height, Number(declaredSize), relativePath);
  }

  assert.equal(fs.existsSync(extensionRoot), true);
});
