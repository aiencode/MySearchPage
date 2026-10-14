'use strict';
// Deliberately small semantic fixture, NOT a browser DOM/layout implementation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
function between(source, name, nextMarker) {
  const token = `function ${name}(`;
  let start = source.indexOf(token);
  assert.notEqual(start, -1, `Production function missing: ${name}`);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const end = source.indexOf(nextMarker, start + token.length);
  assert.ok(end > start, `Production boundary missing: ${name} -> ${nextMarker}`);
  return source.slice(start, end).trim();
}
function loadFunctions(source, entries, sandbox) {
  const context = vm.createContext(sandbox);
  const definitions = entries.map(([name, next]) => between(source, name, next)).join('\n');
  return vm.runInContext(`${definitions}\n({${entries.map(([name]) => name).join(',')}})`, context, { timeout: 500 });
}
class Style {
  constructor() { this.values = new Map(); this.writes = 0; }
  getPropertyValue(name) { return this.values.get(name)?.value || ''; }
  getPropertyPriority(name) { return this.values.get(name)?.priority || ''; }
  setProperty(name, value, priority = '') { this.writes++; this.values.set(name, { value, priority }); }
  removeProperty(name) { this.values.delete(name); }
}
class Element {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag.toUpperCase(); this.nodeType = 1;
    this.attrs = new Map(Object.entries(attrs)); this.children = []; this.childNodes = this.children;
    this.parentElement = this.parentNode = null; this.dataset = {}; this.style = new Style();
    this.textContent = ''; this.exactMatches = new Set(); this.attributeWrites = 0;
    this.rect = { width: 200, height: 30 }; this.computed = { display: 'block', visibility: 'visible' };
  }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  hasAttribute(name) { return this.attrs.has(name); }
  setAttribute(name, value) { this.attributeWrites++; this.attrs.set(name, value); }
  removeAttribute(name) { this.attrs.delete(name); }
  matches(selector) {
    return selector.split(',').some(raw => {
      const part = raw.trim();
      if (this.exactMatches.has(part)) return true;
      if (/^[a-zA-Z]+$/.test(part)) return this.tagName === part.toUpperCase();
      const attr = part.match(/^(\w+)?\[([\w-]+)(?:="([^"]*)")?\]$/);
      return Boolean(attr && (!attr[1] || this.tagName === attr[1].toUpperCase()) && this.hasAttribute(attr[2]) &&
        (attr[3] === undefined || this.getAttribute(attr[2]) === attr[3]));
    });
  }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  appendChild(node) { node.parentNode?.removeChild(node); this.children.push(node); node.parentNode = node.parentElement = this; return node; }
  removeChild(node) { const i = this.children.indexOf(node); assert.ok(i >= 0); this.children.splice(i, 1); node.parentNode = node.parentElement = null; return node; }
  replaceChild(next, previous) { const i = this.children.indexOf(previous); assert.ok(i >= 0); next.parentNode?.removeChild(next); this.children[i] = next; next.parentNode = next.parentElement = this; previous.parentNode = previous.parentElement = null; return previous; }
  insertBefore(node, sibling) { if (!sibling) return this.appendChild(node); const i = this.children.indexOf(sibling); assert.ok(i >= 0); node.parentNode?.removeChild(node); this.children.splice(i, 0, node); node.parentNode = node.parentElement = this; return node; }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  getBoundingClientRect() { return this.rect; }
}
module.exports = { read, between, loadFunctions, Element, Style };
