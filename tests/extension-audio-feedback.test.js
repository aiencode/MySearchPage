const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerPath = path.resolve(
  __dirname,
  '..',
  'extension',
  'content',
  'blocking-controller.js'
);
const source = fs.readFileSync(controllerPath, 'utf8');

function loadPlayBeep(globalObject) {
  const start = source.indexOf('  function playBeep() {');
  const end = source.indexOf('\n  function showTemporaryNotice', start);
  assert.notEqual(start, -1, 'playBeep should exist');
  assert.notEqual(end, -1, 'playBeep should have a stable boundary');
  const functionSource = source.slice(start, end).trim();
  return new Function(
    'global',
    `return (${functionSource});`
  )(globalObject);
}

test('does not create AudioContext without an active user gesture', () => {
  let constructorCalls = 0;
  const globalObject = {
    navigator: { userActivation: { isActive: false } },
    AudioContext: class {
      constructor() {
        constructorCalls += 1;
      }
    },
  };

  loadPlayBeep(globalObject)();

  assert.equal(constructorCalls, 0);
});
