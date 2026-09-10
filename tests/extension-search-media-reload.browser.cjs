'use strict';

// Explicit, offline-only browser entry point; intentionally excluded from *.test.js.
// TC expectations come from S-19, not from the observed storage or product internals.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sites, cardMarkup, pageMarkup } = require('./fixtures/search-media/sites.js');
const TC = 'TC-01a075d4-7247-7610-8711-52d5eb4d3283';
const targets = ['bilibili', 'douyin', 'youtube-mobile', 'xiaohongshu'].map(id => sites.find(site => site.id === id));
const labels = { 'bilibili.com': '哔哩哔哩', 'douyin.com': '抖音', 'youtube.com': 'YouTube', 'xiaohongshu.com': '小红书' };
const extension = path.resolve(__dirname, '../extension');
const required = name => { if (!process.env[name]) throw new Error('EXECUTION_ERROR: required environment variable ' + name); return process.env[name]; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { tc: TC, startedAt: new Date().toISOString(), scenarios: [], requests: [], errors: [], cleanup: {} };
let context, output, profile, temporary, activeScenario;
const routes = new Map();

function event(type, data) {
  const line = JSON.stringify({ at: new Date().toISOString(), type, data });
  if (output) fs.appendFileSync(path.join(output, 'events.jsonl'), line + '\n');
  if (['scenario', 'execution-error', 'finished'].includes(type)) {
    console.log(line);
    if (output) fs.appendFileSync(path.join(output, 'run.log'), line + '\n');
  }
}
function hashes(directory) {
  const entries = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else entries[path.relative(directory, file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  }
  visit(directory); return entries;
}
function check(scene, label, assertion) {
  scene.assertions++;
  try { assertion(); }
  catch (error) {
    if (!(error instanceof assert.AssertionError)) throw error;
    const failure = { label, message: error.message, actual: error.actual, expected: error.expected };
    scene.failures.push(failure); event('behavior-failure', { scenario: scene.name, ...failure });
  }
}

// These are fixture operations in the page's normal world. They never inject or
// restart extension scripts and never synthesize storage callbacks or reloads.
function fixtureRuntime(configuration) {
  const fixture = window.__reloadFixture = {
    documentToken: crypto.randomUUID(), originalDocument: document, loads: 0,
    untrustedLoads: 0, pending: 0, failures: [], media: new Map(), streams: [],
  };
  let sequence = 1;
  const results = document.querySelector('[data-test-results]');
  const makeStream = video => {
    if (fixture.media.has(video)) return fixture.media.get(video);
    video.removeAttribute('src');
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 36;
    const paint = canvas.getContext('2d'); let frame = 0;
    const draw = () => { paint.fillStyle = `rgb(${frame++ % 255},90,150)`; paint.fillRect(0, 0, 64, 36); };
    draw(); const timer = setInterval(draw, 30);
    const stream = canvas.captureStream(30);
    const audio = new AudioContext(); const oscillator = audio.createOscillator();
    const gain = audio.createGain(); gain.gain.value = 0.04;
    const destination = audio.createMediaStreamDestination();
    oscillator.connect(gain).connect(destination); oscillator.start();
    destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
    const analyser = audio.createAnalyser(); analyser.fftSize = 256;
    audio.createMediaStreamSource(stream).connect(analyser);
    video.srcObject = stream;
    const item = { video, stream, audio, oscillator, analyser, timer, pauses: 0, plays: 0, frame };
    video.addEventListener('pause', () => item.pauses++);
    video.addEventListener('playing', () => item.plays++);
    fixture.media.set(video, item); fixture.streams.push(item);
    return item;
  };
  const play = async video => {
    const item = makeStream(video); await item.audio.resume();
    try { await video.play(); } catch (error) {
      // Extension pausing a result can legitimately abort play(). The final real
      // paused/muted/time state is asserted, rather than treating this as a pass.
      if (error.name !== 'AbortError') fixture.failures.push({ name: error.name, message: error.message });
    }
  };
  const run = operation => {
    fixture.pending++;
    Promise.resolve().then(operation).catch(error => fixture.failures.push({ name: error.name, message: error.message }))
      .finally(() => fixture.pending--);
  };
  fixture.playPreviews = () => Promise.all([...document.querySelectorAll('[data-test-preview]')].map(play));
  document.querySelector('[data-test-play-previews]')?.addEventListener('click', () => run(fixture.playPreviews));
  const layOut = () => {
    if (configuration.siteId !== 'xiaohongshu' || !results) return;
    results.style.height = `${results.children.length * 600}px`;
    [...results.children].forEach((card, index) => {
      card.style.position = 'absolute'; card.style.width = '340px';
      card.style.transform = `translate(0px, ${index * 600}px)`;
    });
  };
  layOut();
  document.querySelector('[data-test-load]')?.addEventListener('click', click => {
    fixture.loads++; if (!click.isTrusted) fixture.untrustedLoads++;
    const template = document.createElement('template');
    template.innerHTML = configuration.card.replaceAll('原标题 1', `原标题 ${++sequence}`).replaceAll('原作者 1', `原作者 ${sequence}`);
    results.append(template.content); layOut(); run(fixture.playPreviews);
  });
  document.querySelector('[data-test-open-detail]')?.addEventListener('click', () => {
    if (!document.querySelector('[data-test-detail]')) {
      const detail = document.createElement('div');
      detail.className = 'note-detail-mask'; detail.setAttribute('role', 'dialog'); detail.setAttribute('data-test-detail', '');
      detail.innerHTML = '<article class="note-container"><h1>用户主动观看详情</h1><img data-detail-image src="' + configuration.image + '"><video data-detail-video controls></video></article>';
      document.body.append(detail);
      history.pushState({}, '', configuration.popupPath);
    }
    run(() => play(document.querySelector('[data-detail-video]')));
  });
  document.querySelector('[data-test-play-detail]')?.addEventListener('click', () => run(() => play(document.querySelector('[data-detail-video]'))));
  window.addEventListener('pagehide', () => {
    for (const item of fixture.streams) {
      clearInterval(item.timer); item.stream.getTracks().forEach(track => track.stop()); item.audio.close();
    }
  }, { once: true });
}

const localImage = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="72"><rect width="128" height="72" fill="#3986a8"/></svg>').toString('base64');
function localize(html) {
  return html.replace(/https:\/\/media\.invalid\/[^\s"<>]+/g, localImage)
    .replace(/<video([^>]*)\s+src="[^"]*"/g, '<video$1');
}
function markup(site, kind, popupPath) {
  let html = kind === 'detail'
    ? '<!doctype html><html><head><title>Offline detail</title></head><body><button data-test-play-detail>播放详情</button><article data-test-detail><h1>用户主动观看详情</h1><img data-detail-image src="' + localImage + '"><video data-detail-video controls></video></article></body></html>'
    : localize(pageMarkup(site)).replace('<button data-test-load>', '<button data-test-play-previews>触发原生预览</button><button data-test-open-detail>打开详情弹窗</button><button data-test-load>');
  html = html.replace('</head>', `<style>
    body{margin:0;padding-top:28px;font:16px Arial}img,video,picture{display:block;width:128px;height:72px}
    ytm-video-with-context-renderer,ytm-media-item,ytm-thumbnail-cover{display:block}
    [data-test-results]{position:relative} [data-test-card]{box-sizing:border-box}
    [data-test-detail]{position:fixed;right:0;bottom:0;background:white;width:270px;z-index:1000}
    [data-detail-video]{width:256px;height:144px} [data-detail-image]{width:128px;height:72px}
    [data-test-play-previews],[data-test-load],[data-test-open-detail],[data-test-play-detail]{position:fixed;top:0;z-index:10000}
    [data-test-play-previews],[data-test-play-detail]{left:0}[data-test-load]{left:150px}[data-test-open-detail]{left:300px}
  </style></head>`);
  const config = { siteId: site.id, card: localize(cardMarkup(site)), image: localImage, popupPath };
  return html.replace('</body>', `<script>(${fixtureRuntime.toString()})(${JSON.stringify(config).replaceAll('<', '\\u003c')});</script></body>`);
}

async function trackPage(scene, url, html, role) {
  routes.set(url, html);
  const page = await context.newPage(); page.setDefaultTimeout(7000); page.setDefaultNavigationTimeout(10000);
  const session = await context.newCDPSession(page); const worlds = new Map();
  session.on('Runtime.executionContextCreated', ({ context: world }) => worlds.set(world.id, world));
  session.on('Runtime.executionContextDestroyed', ({ executionContextId }) => worlds.delete(executionContextId));
  session.on('Runtime.executionContextsCleared', () => worlds.clear());
  await session.send('Runtime.enable');
  const item = { page, session, worlds, role, navigations: [], pageErrors: [], scene };
  scene.pages.push(item);
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) item.navigations.push(frame.url()); });
  page.on('pageerror', error => { item.pageErrors.push(error.message); event('pageerror', { scenario: scene.name, role, message: error.message }); });
  page.on('console', message => { if (message.type() === 'error') event('console-error', { scenario: scene.name, role, text: message.text(), location: message.location() }); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return item;
}
async function gesture(item, selector) {
  await item.page.bringToFront();
  await item.page.locator(selector).click({ noWaitAfter: true });
  await item.page.waitForFunction(() => window.__reloadFixture?.pending === 0, null, { polling: 20 });
  const failures = await item.page.evaluate(() => window.__reloadFixture.failures);
  if (failures.length) throw new Error('EXECUTION_ERROR: real media fixture failed: ' + JSON.stringify(failures));
}
async function snapshot(item) {
  const state = await item.page.evaluate(() => {
    const fixture = window.__reloadFixture;
    if (!fixture) throw new Error('Fixture/document disappeared');
    const visible = element => {
      for (let node = element; node?.nodeType === 1; node = node.parentElement) {
        const css = getComputedStyle(node);
        if (node.hidden || css.display === 'none' || css.visibility === 'hidden' || css.opacity === '0') return false;
      }
      const rect = element.getBoundingClientRect(); return element.isConnected && rect.width > 0 && rect.height > 0;
    };
    const rectangle = element => {
      const rect = element.getBoundingClientRect(); const css = getComputedStyle(element);
      return { width: rect.width, height: rect.height, top: rect.top + scrollY, left: rect.left + scrollX, display: css.display,
        aspectRatio: css.aspectRatio, position: css.position, transform: css.transform };
    };
    const mediaState = video => {
      const item = fixture.media.get(video); const values = new Float32Array(item?.analyser.fftSize || 1);
      item?.analyser.getFloatTimeDomainData(values);
      return { visible: visible(video), paused: video.paused, muted: video.muted, autoplay: video.autoplay,
        time: video.currentTime, volume: video.volume, pauses: item?.pauses, plays: item?.plays,
        audioEnergy: Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length),
        audioState: item?.audio.state, tracks: item?.stream.getTracks().map(track => ({ kind: track.kind, enabled: track.enabled, state: track.readyState })) || [] };
    };
    return { token: fixture.documentToken, sameDocument: fixture.originalDocument === document, url: location.href,
      userAgent: navigator.userAgent, loads: fixture.loads, untrustedLoads: fixture.untrustedLoads,
      cards: [...document.querySelectorAll('[data-test-card]')].map(card => ({ rectangle: rectangle(card),
        media: [...card.querySelectorAll('[data-test-media]')].map(element => ({ tag: element.tagName, visible: visible(element), rectangle: rectangle(element) })),
        slots: [...card.querySelectorAll('[data-test-media-slot],[data-test-mixed-cover]')].map(element => rectangle(element)),
        text: [...card.querySelectorAll('[data-test-text]')].map(element => ({ text: element.textContent, visible: visible(element) })),
        links: [...card.querySelectorAll('[data-test-link]')].map(element => ({ href: element.href, target: element.target, visible: visible(element) })),
        previews: [...card.querySelectorAll('[data-test-preview]')].map(mediaState) })),
      root: document.querySelector('[data-test-results]') ? rectangle(document.querySelector('[data-test-results]')) : null,
      detail: document.querySelector('[data-detail-video]') ? mediaState(document.querySelector('[data-detail-video]')) : null,
      detailImageVisible: document.querySelector('[data-detail-image]') ? visible(document.querySelector('[data-detail-image]')) : null };
  });
  state.worlds = [];
  for (const world of item.worlds.values()) {
    if (world.auxData?.isDefault) continue;
    try {
      const response = await item.session.send('Runtime.evaluate', { contextId: world.id, returnByValue: true,
        expression: '({runtimeId:globalThis.chrome?.runtime?.id,hasSettings:!!globalThis.SearchMediaSettings,href:location.href})' });
      state.worlds.push({ name: world.name, value: response.result.value, exception: response.exceptionDetails });
    } catch (error) { state.worlds.push({ name: world.name, inspectionError: error.message }); }
  }
  state.navigations = [...item.navigations]; return state;
}
function resultChecks(scene, phase, actual, native, enabled, wantedCards) {
  const prefix = phase + (enabled ? ' enabled' : ' disabled');
  check(scene, prefix + ' expected result count', () => assert.equal(actual.cards.length, wantedCards));
  for (let index = 0; index < Math.min(actual.cards.length, wantedCards); index++) {
    const card = actual.cards[index], reference = native.cards[index] || native.cards[0];
    const label = prefix + ' card ' + index;
    check(scene, label + ' text and real links preserved', () => {
      assert.deepEqual(card.text, reference.text); assert.deepEqual(card.links, reference.links);
      assert.ok(card.text.every(text => text.visible)); assert.ok(card.links.every(link => link.visible));
    });
    check(scene, label + ' media visibility', () => {
      assert.equal(card.media.length, reference.media.length);
      assert.ok(card.media.length > 0); assert.ok(card.media.every(media => media.visible === !enabled));
    });
    check(scene, label + ' actual media layout', () => {
      if (enabled) {
        assert.ok(card.rectangle.height < reference.rectangle.height, 'card retains native media height');
        assert.equal(card.slots.length, reference.slots.length);
        card.slots.forEach((slot, slotIndex) => assert.ok(slot.height < reference.slots[slotIndex].height, 'media container not collapsed'));
        assert.ok(card.slots.every(slot => slot.display === 'none' || slot.aspectRatio === 'auto'), 'aspect ratio constraint remains');
      } else {
        for (const property of ['width', 'height', 'position', 'transform']) assert.equal(card.rectangle[property], reference.rectangle[property]);
        assert.deepEqual(card.slots, reference.slots);
        card.media.forEach((media, mediaIndex) => {
          for (const property of ['width', 'height']) assert.equal(media.rectangle[property], reference.media[mediaIndex].rectangle[property]);
        });
      }
    });
    check(scene, label + ' real preview playback and audio track', () => {
      assert.ok(card.previews.length > 0);
      for (const preview of card.previews) {
        assert.equal(preview.paused, enabled); assert.equal(preview.muted, enabled);
        assert.ok(preview.tracks.some(track => track.kind === 'audio' && track.enabled && track.state === 'live'));
        assert.ok(preview.tracks.some(track => track.kind === 'video' && track.state === 'live'));
        if (enabled) assert.equal(preview.autoplay, false);
        else { assert.equal(preview.autoplay, true); assert.ok(preview.time > 0); assert.ok(preview.audioEnergy > 0.005); }
      }
    });
  }
  if (scene.site.id === 'xiaohongshu') check(scene, prefix + ' waterfall extent', () => {
    if (enabled) assert.ok(actual.root.height < native.root.height, 'waterfall root retains native reserved height');
    else assert.equal(actual.root.height, native.root.height);
  });
}
function continuityChecks(scene, label, current, initial) {
  check(scene, label + ' original document and navigation unchanged', () => {
    assert.equal(current.token, initial.token); assert.equal(current.sameDocument, true);
    assert.deepEqual(current.navigations, initial.navigations); assert.equal(current.url, initial.url);
    assert.equal(current.userAgent, initial.userAgent); assert.equal(current.untrustedLoads, 0);
  });
}
function detailChecks(scene, phase, current, previous, nativeCurrent, nativePrevious) {
  check(scene, phase + ' native detail playback control remains viable', () => {
    assert.equal(nativeCurrent.detail.paused, false); assert.ok(nativeCurrent.detail.time > nativePrevious.detail.time);
    assert.ok(nativeCurrent.detail.audioEnergy > 0.005);
  });
  check(scene, phase + ' detail continues without pause/mute/reset', () => {
    assert.ok(current.detail.visible && current.detailImageVisible);
    assert.equal(current.detail.paused, false); assert.equal(current.detail.muted, false); assert.ok(current.detail.volume > 0);
    assert.equal(current.detail.pauses, previous.detail.pauses); assert.ok(current.detail.time > previous.detail.time);
    assert.ok(current.detail.audioEnergy > 0.005); assert.equal(current.detail.audioState, 'running');
    assert.ok(current.detail.tracks.some(track => track.kind === 'audio' && track.enabled && track.state === 'live'));
  });
}
async function currentWorker(previous) {
  const present = context.serviceWorkers().find(worker => worker !== previous && worker.url().startsWith('chrome-extension://'));
  return present || context.waitForEvent('serviceworker', { timeout: 10000, predicate: worker => worker !== previous && worker.url().startsWith('chrome-extension://') });
}
async function optionsPage(scene, extensionId) {
  const page = await context.newPage(); scene.pages.push({ page, role: 'options', pageErrors: [] });
  page.setDefaultTimeout(7000);
  await page.goto(`chrome-extension://${extensionId}/${report.manifest.options_page}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.getByRole('heading', { name: '搜索结果图片与预览', exact: true }).waitFor();
  return page;
}
async function choose(options, domain, enabled) {
  await options.bringToFront();
  const checkbox = options.getByRole('checkbox', { name: labels[domain], exact: true });
  if (enabled) await checkbox.check(); else await checkbox.uncheck();
  await options.waitForFunction(label => [...document.querySelectorAll('input[type=checkbox]')].some(element =>
    [...element.labels || []].some(item => item.textContent.trim() === label) && !element.disabled), labels[domain], { polling: 20 });
}
async function readStorage(worker) { return worker.evaluate(() => chrome.storage.local.get(null)); }

async function runScenario(site, sequence, index) {
  const scene = { name: `${TC} S-19 ${site.id} sequence-${sequence}`, site, sequence, assertions: 0, failures: [], points: [], pages: [] };
  report.scenarios.push(scene); activeScenario = scene.name;
  const popup = ['douyin', 'xiaohongshu'].includes(site.id);
  scene.detailMode = popup ? 'same-document URL-changing dialog' : 'separate detail document';
  const other = targets[(targets.indexOf(site) + 1) % targets.length];
  const initialEnabled = sequence === 'A';
  // Both enabled and disabled other-site controls are exercised across the 8 cases.
  const otherEnabled = index % 2 === 0;
  let worker = await currentWorker(); const extensionId = new URL(worker.url()).host;
  const expectedSettings = Object.fromEntries(targets.map(target => [target.domain, target.domain === site.domain ? initialEnabled : target.domain === other.domain ? otherEnabled : true]));
  const ua = { globalEnabled: false, uaRules: Object.fromEntries(targets.map(target => [target.domain, {
    enabled: false, uiTransform: false, uaMode: 'desktop', presetKey: 'chrome_windows', customUA: null,
  }])) };
  try {
    await worker.evaluate(value => chrome.storage.local.set(value), { ...ua, searchMediaSettings: expectedSettings });
    const popupPath = new URL(site.detail).pathname;
    const native = await trackPage(scene, `https://baseline.invalid/${site.id}/${sequence}/search`, markup(site, 'search', popupPath), 'native-search');
    const old = await trackPage(scene, site.search, markup(site, 'search', popupPath), 'old-search');
    const otherPage = await trackPage(scene, other.search, markup(other, 'search', new URL(other.detail).pathname), 'other-search');
    const otherNative = await trackPage(scene, `https://baseline.invalid/${other.id}/${sequence}/other`, markup(other, 'search', '/detail'), 'other-native');
    let detail = old, nativeDetail = native;
    if (popup) {
      await gesture(old, '[data-test-open-detail]'); await gesture(native, '[data-test-open-detail]');
    } else {
      detail = await trackPage(scene, site.detail, markup(site, 'detail'), 'detail-document');
      nativeDetail = await trackPage(scene, `https://baseline.invalid/${site.id}/${sequence}/detail`, markup(site, 'detail'), 'native-detail');
      await gesture(detail, '[data-test-play-detail]'); await gesture(nativeDetail, '[data-test-play-detail]');
    }
    for (const page of [native, old, otherPage, otherNative]) await gesture(page, '[data-test-play-previews]');
    await delay(350);
    const initial = await snapshot(old), initialOther = await snapshot(otherPage), initialDetail = await snapshot(detail);
    const initialNative = await snapshot(native);
    let previousDetail = initialDetail, previousNativeDetail = await snapshot(nativeDetail);
    scene.initial = { old: initial, other: initialOther, detail: initialDetail, nativeDetail: previousNativeDetail, storage: await readStorage(worker) };
    resultChecks(scene, 'before reload old', initial, initialNative, initialEnabled, 1);
    resultChecks(scene, 'before reload other', initialOther, await snapshot(otherNative), otherEnabled, 1);
    check(scene, 'precondition real extension isolated world', () => assert.ok(initial.worlds.some(world => world.value?.runtimeId === extensionId)));
    check(scene, 'precondition native detail playing', () => { assert.equal(initialDetail.detail.paused, false); assert.ok(initialDetail.detail.time > 0); });

    const replacementPromise = currentWorker(worker);
    scene.reload = { oldWorker: worker.url(), extensionId, invoked: true };
    try { await worker.evaluate(() => chrome.runtime.reload()); }
    catch (error) { scene.reload.oldContextLoss = error.message; }
    const replacement = await replacementPromise;
    scene.reload.newWorker = replacement.url(); scene.reload.newWorkerObject = replacement !== worker;
    worker = replacement;
    const options = await optionsPage(scene, extensionId);
    scene.reload.restoredManifest = await worker.evaluate(() => chrome.runtime.getManifest());
    check(scene, 'actual extension reload completed with same identity', () => {
      assert.ok(scene.reload.newWorkerObject); assert.equal(new URL(worker.url()).host, extensionId);
      assert.equal(scene.reload.restoredManifest.version, report.manifest.version);
    });
    const phases = [{ label: 'after reload', enabled: initialEnabled, toggle: false },
      ...(sequence === 'A' ? [{ label: 'switch false', enabled: false, toggle: true }, { label: 'switch true', enabled: true, toggle: true }]
        : [{ label: 'switch true', enabled: true, toggle: true }])];
    let expectedLoads = 0;
    for (const phase of phases) {
      if (phase.toggle) { await choose(options, site.domain, phase.enabled); expectedSettings[site.domain] = phase.enabled; }
      await gesture(native, '[data-test-load]'); await gesture(old, '[data-test-load]'); expectedLoads++;
      // Every observation opens an independent current-state document and checks
      // original + dynamically loaded old cards. Old documents are never replaced.
      const fresh = await trackPage(scene, site.search, markup(site, 'search', popupPath), 'fresh-' + phase.label);
      for (const page of [old, native, fresh, otherPage]) await gesture(page, '[data-test-play-previews]');
      await delay(500);
      const nativeState = await snapshot(native), state = await snapshot(old), freshState = await snapshot(fresh);
      const currentDetail = await snapshot(detail), currentNativeDetail = await snapshot(nativeDetail);
      const currentOther = await snapshot(otherPage), storage = await readStorage(worker);
      const point = { phase: phase.label, expectedEnabled: phase.enabled, expectedSettings: { ...expectedSettings }, storage,
        old: state, fresh: freshState, other: currentOther, native: nativeState, detail: currentDetail, nativeDetail: currentNativeDetail };
      scene.points.push(point); event('observation', { scenario: scene.name, ...point });
      check(scene, phase.label + ' independently expected storage and real checkbox', () => assert.deepEqual(storage.searchMediaSettings, expectedSettings));
      const actualChecked = await options.getByRole('checkbox', { name: labels[site.domain], exact: true }).isChecked();
      check(scene, phase.label + ' options reflects intended choice', () => assert.equal(actualChecked, phase.enabled));
      check(scene, phase.label + ' UA settings unchanged', () => assert.deepEqual({ globalEnabled: storage.globalEnabled, uaRules: storage.uaRules }, ua));
      resultChecks(scene, phase.label + ' old+dynamic', state, nativeState, phase.enabled, expectedLoads + 1);
      resultChecks(scene, phase.label + ' fresh', freshState, initialNative, phase.enabled, 1);
      resultChecks(scene, phase.label + ' other site', currentOther, await snapshot(otherNative), otherEnabled, 1);
      continuityChecks(scene, phase.label + ' old', state, initial);
      continuityChecks(scene, phase.label + ' other', currentOther, initialOther);
      continuityChecks(scene, phase.label + ' detail', currentDetail, initialDetail);
      check(scene, phase.label + ' only explicit native load', () => assert.equal(state.loads, expectedLoads));
      detailChecks(scene, phase.label, currentDetail, previousDetail, currentNativeDetail, previousNativeDetail);
      previousDetail = currentDetail; previousNativeDetail = currentNativeDetail;
      await fresh.page.close();
    }
    check(scene, 'no unexpected request or extension-requested result load', () => assert.deepEqual(report.requests.filter(request => request.scenario === scene.name && request.action === 'abort'), []));
    check(scene, 'no runtime page exception', () => assert.deepEqual(scene.pages.flatMap(page => page.pageErrors), []));
  } catch (error) {
    scene.executionError = { name: error.name, message: error.message, stack: error.stack };
    event('execution-error', { scenario: scene.name, ...scene.executionError });
  } finally {
    for (const page of scene.pages) if (!page.page.isClosed()) await page.page.close().catch(error => event('page-close-error', { message: error.message }));
    delete scene.pages;
    scene.status = scene.executionError ? 'EXECUTION_ERROR' : scene.failures.length ? 'BEHAVIOR_FAILURE' : 'PASS';
    event('scenario', { name: scene.name, status: scene.status, assertions: scene.assertions, failures: scene.failures.length, observations: scene.points.length });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  }
}

function removeOwned(directory) {
  if (!directory || !fs.existsSync(directory)) return;
  const resolved = fs.realpathSync(directory), parent = fs.realpathSync(output);
  if (!resolved.toLowerCase().startsWith((parent + path.sep).toLowerCase()) || !['profile', 'temporary'].includes(path.basename(resolved))) throw new Error('Cleanup containment check failed: ' + resolved);
  report.cleanup[path.basename(resolved) + 'Resolved'] = resolved;
  fs.rmSync(resolved, { recursive: true, force: false, maxRetries: 8, retryDelay: 250 });
  report.cleanup[path.basename(resolved) + 'Removed'] = !fs.existsSync(resolved);
}

(async () => {
  const artifactRoot = path.resolve(required('MYSEARCHPAGE_BROWSER_ARTIFACTS'));
  const executable = required('MYSEARCHPAGE_CHROMIUM_BINARY');
  if (process.platform === 'win32' && !/^E:\\/i.test(artifactRoot)) throw new Error('EXECUTION_ERROR: this host requires E: artifacts/profile/temp');
  output = path.join(artifactRoot, 'reload-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex'));
  fs.mkdirSync(output, { recursive: true });
  profile = path.join(output, 'profile'); temporary = path.join(output, 'temporary');
  fs.mkdirSync(profile); fs.mkdirSync(temporary);
  process.env.TEMP = temporary; process.env.TMP = temporary;
  const { chromium } = require(required('MYSEARCHPAGE_PLAYWRIGHT_MODULE'));
  report.output = output; report.executable = executable; report.productBefore = hashes(extension);
  report.testBefore = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
  report.manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
  try {
    context = await chromium.launchPersistentContext(profile, { executablePath: executable, headless: true, timeout: 20000,
      viewport: { width: 1200, height: 900 }, ignoreDefaultArgs: ['--disable-extensions', '--headless'],
      args: ['--headless=new', '--load-extension=' + extension, '--disable-extensions-except=' + extension,
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', '--disable-background-networking', '--no-first-run',
        '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required'] });
    report.browserVersion = context.browser().version();
    await context.route('**/*', route => {
      const request = route.request(), url = request.url();
      if (/^(chrome-extension|chrome|about|data|blob):/.test(url)) return route.continue();
      const body = routes.get(url);
      if (body && request.isNavigationRequest() && request.resourceType() === 'document') {
        report.requests.push({ scenario: activeScenario, url, action: 'fulfill-local-fixture' });
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body });
      }
      report.requests.push({ scenario: activeScenario, url, action: 'abort', resourceType: request.resourceType() });
      return route.abort('blockedbyclient');
    });
    let index = 0;
    for (const site of targets) for (const sequence of ['A', 'B']) await runScenario(site, sequence, index++);
  } catch (error) { report.errors.push({ message: error.message, stack: error.stack }); event('execution-error', report.errors.at(-1)); }
  finally {
    if (context) {
      try { await context.close(); report.cleanup.browserClosed = true; }
      catch (error) { report.cleanup.error = 'Browser close failed: ' + error.message; }
    }
    try { removeOwned(profile); removeOwned(temporary); } catch (error) { report.cleanup.error = error.message; }
    report.productAfter = hashes(extension); report.productUnchanged = JSON.stringify(report.productAfter) === JSON.stringify(report.productBefore);
    report.testAfter = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
    report.endedAt = new Date().toISOString();
    report.summary = { total: report.scenarios.length, passed: report.scenarios.filter(scene => scene.status === 'PASS').length,
      behaviorFailed: report.scenarios.filter(scene => scene.status === 'BEHAVIOR_FAILURE').length,
      executionErrors: report.scenarios.filter(scene => scene.status === 'EXECUTION_ERROR').length + report.errors.length,
      productUnchanged: report.productUnchanged, testUnchanged: report.testBefore === report.testAfter, output };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    event('finished', report.summary);
    if (report.summary.total !== 8 || report.summary.passed !== 8 || report.summary.executionErrors || !report.productUnchanged || report.cleanup.error) process.exitCode = 1;
  }
})().catch(error => { console.error('EXECUTION_ERROR:', error.stack); process.exitCode = 1; });
