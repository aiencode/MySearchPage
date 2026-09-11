'use strict';

// Offline real-Chromium regression for the first painted frames of an
// Xiaohongshu same-document detail return. Excluded from tests/*.test.js.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sites, cardMarkup, pageMarkup } =
  require('./fixtures/search-media/sites.js');

const TC = 'TC-01a07543-5a8d-7139-9902-83790c4f8d9c';
const site = sites.find(item => item.id === 'xiaohongshu');
const extension = path.resolve(__dirname, '../extension');
const required = name => {
  if (!process.env[name]) {
    throw new Error(`EXECUTION_ERROR: required environment variable ${name}`);
  }
  return process.env[name];
};
const report = {
  tc: TC,
  scenario: 'xiaohongshu same-document return paint frames',
  startedAt: new Date().toISOString(),
  frames: [],
  requests: [],
  pageErrors: [],
  cleanup: {},
};
let context;
let output;
let profile;
let temporary;

function hashes(directory) {
  const result = {};
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else {
        result[path.relative(directory, full)] =
          crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      }
    }
  }
  visit(directory);
  return result;
}

function removeOwned(directory) {
  if (!directory || !fs.existsSync(directory)) return;
  const resolved = fs.realpathSync(directory);
  const parent = fs.realpathSync(output);
  if (!resolved.toLowerCase().startsWith((parent + path.sep).toLowerCase()) ||
      !['profile', 'temporary'].includes(path.basename(resolved))) {
    throw new Error(`EXECUTION_ERROR: cleanup containment failed: ${resolved}`);
  }
  fs.rmSync(resolved, {
    recursive: true,
    force: false,
    maxRetries: 8,
    retryDelay: 250,
  });
  report.cleanup[path.basename(resolved)] = !fs.existsSync(resolved);
}

const localImage = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="72">' +
  '<rect width="128" height="72" fill="#777"/></svg>'
).toString('base64');

function localize(html) {
  return html
    .replace(/https:\/\/media\.invalid\/[^\s"<>]+/g, localImage)
    .replace(/<video([^>]*)\s+src="[^"]*"/g, '<video$1');
}

function fixtureRuntime(configuration) {
  const state = window.__returnFixture = {
    done: false,
    failure: null,
    frames: [],
    waiting: null,
    resume: null,
    usedViewTransition: false,
  };
  let root = document.querySelector('[data-test-results]');
  let portal = null;
  let sequence = 1;

  function makeCard(label) {
    const template = document.createElement('template');
    template.innerHTML = configuration.card
      .replaceAll('原标题 1', `原标题 ${label}`)
      .replaceAll('原作者 1', `原作者 ${label}`)
      .replaceAll('原摘要 1', `原摘要 ${label}`)
      .replaceAll('原统计 123', `原统计 ${label}`);
    const card = template.content.firstElementChild;
    card.setAttribute('data-return-sequence', String(sequence++));
    return card;
  }

  while (root.children.length < 3) root.appendChild(makeCard(`initial-${sequence}`));

  function nativeLayout(target, enlargeSelected = false) {
    target.style.display = 'block';
    target.style.position = 'relative';
    target.style.height = `${Math.max(1, target.children.length) * 600}px`;
    [...target.children].forEach((card, index) => {
      card.style.position = 'absolute';
      card.style.width = '340px';
      card.style.height = '560px';
      card.style.transform =
        `translate(0px, ${index * 600}px) scale(${enlargeSelected && index === 0 ? 1.8 : 1})`;
    });
  }
  nativeLayout(root);

  const nextFrame = () =>
    new Promise(resolve => requestAnimationFrame(() => resolve()));

  function visible(element) {
    if (!element?.isConnected) return false;
    for (let node = element; node?.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || style.display === 'none' ||
          style.visibility === 'hidden' || style.opacity === '0') return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function rectangle(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      width: rect.width,
      height: rect.height,
      top: rect.top + scrollY,
      left: rect.left + scrollX,
      display: style.display,
      flexWrap: style.flexWrap,
      position: style.position,
      transform: style.transform,
    };
  }

  function inspect(label) {
    const cards = [...root.querySelectorAll('[data-test-card]')];
    const pseudoAnimations = document.getAnimations({ subtree: true })
      .map(animation => animation.effect?.pseudoElement || null)
      .filter(Boolean);
    return {
      label,
      url: location.href,
      pathname: location.pathname,
      guardActive:
        document.documentElement.hasAttribute('data-mysearch-media-return-guard'),
      root: rectangle(root),
      cards: cards.map(card => ({
        rectangle: rectangle(card),
        media: [...card.querySelectorAll('[data-test-media]')].map(media => ({
          tag: media.tagName,
          visible: visible(media),
          rectangle: rectangle(media),
        })),
      })),
      clone: portal?.isConnected ? {
        visible: visible(portal),
        rectangle: rectangle(portal),
        media: [...portal.querySelectorAll('[data-test-media]')].map(media => ({
          tag: media.tagName,
          visible: visible(media),
          rectangle: rectangle(media),
        })),
      } : null,
      detail: document.querySelector('[data-test-detail]') ? {
        visible: visible(document.querySelector('[data-test-detail]')),
        imageVisible: visible(document.querySelector('[data-detail-image]')),
      } : null,
      pseudoAnimations,
    };
  }

  async function checkpoint(label, captured = null) {
    const frame = captured || inspect(label);
    state.frames.push(frame);
    state.waiting = label;
    await new Promise(resolve => {
      state.resume = () => {
        state.waiting = null;
        state.resume = null;
        resolve();
      };
    });
  }

  async function closeAndReturn() {
    try {
      await checkpoint('before-close');
      const detail = document.querySelector('[data-test-detail]');
      const source = root.querySelector('[data-test-card]');
      source.style.viewTransitionName = 'selected-note';

      let synchronousCloseFrame = null;
      const mutate = () => {
        detail.setAttribute('aria-hidden', 'true');

        portal = source.cloneNode(true);
        portal.setAttribute('data-test-return-clone', '');
        Object.assign(portal.style, {
          position: 'fixed',
          top: '60px',
          left: '120px',
          width: '680px',
          height: '720px',
          transform: 'scale(1.8)',
          zIndex: '99999',
        });
        document.body.appendChild(portal);

        const replacement = document.createElement('div');
        replacement.className = 'feeds-container';
        replacement.setAttribute('data-test-results', '');
        replacement.append(
          makeCard('rebuilt-selected'),
          makeCard('rebuilt-neighbour-1'),
          makeCard('rebuilt-neighbour-2')
        );
        nativeLayout(replacement, true);
        detail.remove();
        root.replaceWith(replacement);
        root = replacement;

        // Captured in the same task as the site mutation, before the content
        // script MutationObserver can perform a new per-node reconciliation.
        synchronousCloseFrame = inspect('after-close-sync');
      };

      if (typeof document.startViewTransition === 'function') {
        state.usedViewTransition = true;
        const transition = document.startViewTransition(mutate);
        await transition.updateCallbackDone;
      } else {
        mutate();
      }
      await checkpoint('after-close-sync', synchronousCloseFrame);

      await nextFrame();
      await checkpoint('detail-path-frame-1');

      history.replaceState({}, '', configuration.searchUrl);
      dispatchEvent(new PopStateEvent('popstate'));
      const synchronousSearchFrame = inspect('search-path-sync');
      await checkpoint('search-path-sync', synchronousSearchFrame);

      await nextFrame();
      await checkpoint('search-path-frame-1');

      const fresh = makeCard('first-search-frame');
      fresh.style.position = 'absolute';
      fresh.style.width = '340px';
      fresh.style.height = '560px';
      fresh.style.transform = 'scale(2)';
      root.appendChild(fresh);
      nativeLayout(root, true);
      const synchronousFreshFrame =
        inspect('search-first-frame-fresh-card-sync');
      await checkpoint(
        'search-first-frame-fresh-card-sync',
        synchronousFreshFrame
      );

      await nextFrame();
      await checkpoint('search-path-frame-2');

      portal.remove();
      portal = null;
      await nextFrame();
      await checkpoint('post-clone-removal-frame-1');
      await nextFrame();
      await checkpoint('post-clone-removal-frame-2');

      history.replaceState({}, '', configuration.outsideUrl);
      dispatchEvent(new PopStateEvent('popstate'));
      await nextFrame();
      await nextFrame();
      await checkpoint('outside-path');
      state.done = true;
    } catch (error) {
      state.failure = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
      state.done = true;
    }
  }

  document.querySelector('[data-test-open-detail]')
    .addEventListener('click', () => {
      const detail = document.createElement('div');
      detail.className = 'note-detail-mask';
      detail.setAttribute('role', 'dialog');
      detail.setAttribute('data-test-detail', '');
      detail.innerHTML =
        '<article class="note-container">' +
        '<button data-test-close-detail>关闭详情</button>' +
        '<h1>用户主动观看详情</h1>' +
        `<img data-detail-image src="${configuration.image}">` +
        '<video data-detail-video controls></video>' +
        '</article>';
      document.body.appendChild(detail);
      history.pushState({}, '', configuration.detailUrl);
      detail.querySelector('[data-test-close-detail]')
        .addEventListener('click', closeAndReturn, { once: true });
    });
}

function markup() {
  let html = localize(pageMarkup(site))
    .replace(
      '<button data-test-load>',
      '<button data-test-open-detail>打开详情</button><button data-test-load>'
    )
    .replace(
      '</head>',
      `<link rel="icon" href="data:,"><style>
body{margin:0;padding-top:32px;font:16px Arial}
img,video,picture{display:block;width:128px;height:72px}
[data-test-open-detail]{position:fixed;top:0;left:0;z-index:100000}
[data-test-detail]{position:fixed;inset:20px;background:white;z-index:10000}
[data-detail-image],[data-detail-video]{width:256px;height:144px}
</style></head>`
    );
  const configuration = {
    card: localize(cardMarkup(site)),
    image: localImage,
    searchUrl: site.search,
    detailUrl: site.detail,
    outsideUrl: site.outside,
  };
  return html.replace(
    '</body>',
    `<script>(${fixtureRuntime.toString()})(${
      JSON.stringify(configuration).replaceAll('<', '\\u003c')
    });</script></body>`
  );
}

(async () => {
  const artifactRoot = path.resolve(required('MYSEARCHPAGE_BROWSER_ARTIFACTS'));
  const executable = required('MYSEARCHPAGE_CHROMIUM_BINARY');
  const playwrightModule = required('MYSEARCHPAGE_PLAYWRIGHT_MODULE');
  if (process.platform === 'win32' && !/^E:\\/i.test(artifactRoot)) {
    throw new Error('EXECUTION_ERROR: browser artifacts must use E: on this host');
  }

  output = path.join(
    artifactRoot,
    'xhs-return-' +
      new Date().toISOString().replace(/[:.]/g, '-') + '-' +
      crypto.randomBytes(3).toString('hex')
  );
  profile = path.join(output, 'profile');
  temporary = path.join(output, 'temporary');
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(temporary, { recursive: true });
  fs.mkdirSync(path.join(output, 'frames'), { recursive: true });
  process.env.TEMP = temporary;
  process.env.TMP = temporary;

  report.output = output;
  report.productBefore = hashes(extension);
  report.testBefore = crypto.createHash('sha256')
    .update(fs.readFileSync(__filename)).digest('hex');

  let failure = null;
  try {
    const { chromium } = require(playwrightModule);
    context = await chromium.launchPersistentContext(profile, {
      executablePath: executable,
      headless: true,
      timeout: 20000,
      viewport: { width: 1200, height: 900 },
      ignoreDefaultArgs: ['--disable-extensions', '--headless'],
      args: [
        '--headless=new',
        `--load-extension=${extension}`,
        `--disable-extensions-except=${extension}`,
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
        '--disable-background-networking',
        '--no-first-run',
      ],
    });

    await context.route('**/*', async route => {
      const target = route.request().url();
      if (target === site.search) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: markup(),
        });
        return;
      }
      if (target.startsWith('chrome-extension://')) {
        await route.continue();
        return;
      }
      report.requests.push({
        method: route.request().method(),
        url: target,
      });
      await route.abort();
    });

    const worker = context.serviceWorkers()[0] ||
      await context.waitForEvent('serviceworker', {
        timeout: 10000,
        predicate: item => item.url().startsWith('chrome-extension://'),
      });
    const domains = [...new Set(sites.map(item => item.domain))];
    await worker.evaluate(settings => chrome.storage.local.set({
      searchMediaSettings: settings,
    }), Object.fromEntries(domains.map(domain => [
      domain,
      domain === 'xiaohongshu.com',
    ])));

    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => report.pageErrors.push(error.message));
    await page.goto(site.search, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const media = [...document.querySelectorAll(
        '[data-test-results] [data-test-media]'
      )];
      return media.length > 0 &&
        media.every(node => getComputedStyle(node).display === 'none');
    }, null, { polling: 20 });

    await page.locator('[data-test-open-detail]').click();
    await page.locator('[data-test-detail]').waitFor();
    await page.waitForFunction(() => {
      const image = document.querySelector('[data-detail-image]');
      if (!image) return false;
      const style = getComputedStyle(image);
      const rect = image.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        rect.width > 0 && rect.height > 0;
    }, null, { polling: 20 });
    await page.waitForTimeout(300);

    const expectedLabels = [
      'before-close',
      'after-close-sync',
      'detail-path-frame-1',
      'search-path-sync',
      'search-path-frame-1',
      'search-first-frame-fresh-card-sync',
      'search-path-frame-2',
      'post-clone-removal-frame-1',
      'post-clone-removal-frame-2',
      'outside-path',
    ];

    await page.locator('[data-test-close-detail]').click({ noWaitAfter: true });
    for (const label of expectedLabels) {
      await page.waitForFunction(expected => {
        const fixture = window.__returnFixture;
        return fixture?.waiting === expected || fixture?.failure;
      }, label, { polling: 20, timeout: 15000 });

      const fixtureState = await page.evaluate(() => ({
        failure: window.__returnFixture.failure,
        frame: window.__returnFixture.frames.at(-1),
        usedViewTransition: window.__returnFixture.usedViewTransition,
      }));
      if (fixtureState.failure) {
        throw new Error(
          `EXECUTION_ERROR: fixture failed: ${JSON.stringify(fixtureState.failure)}`
        );
      }
      assert.equal(fixtureState.frame.label, label);

      const screenshot = path.join(
        output,
        'frames',
        `${String(report.frames.length + 1).padStart(2, '0')}-${label}.png`
      );
      await page.screenshot({ path: screenshot });
      report.frames.push({
        ...fixtureState.frame,
        screenshot: path.relative(output, screenshot),
        usedViewTransition: fixtureState.usedViewTransition,
      });
      await page.evaluate(() => {
        const resume = window.__returnFixture.resume;
        if (typeof resume !== 'function') {
          throw new Error('fixture checkpoint has no resume function');
        }
        resume();
      });
    }
    await page.waitForFunction(() => window.__returnFixture.done, null, {
      polling: 20,
    });

    const byLabel = Object.fromEntries(
      report.frames.map(frame => [frame.label, frame])
    );
    assert.ok(byLabel['before-close'].detail?.visible);
    assert.ok(byLabel['before-close'].detail?.imageVisible);
    assert.equal(byLabel['after-close-sync'].pathname, '/explore/fixture-note');
    assert.equal(byLabel['detail-path-frame-1'].pathname, '/explore/fixture-note');
    assert.equal(byLabel['search-path-sync'].pathname, '/search_result');

    const guardedLabels = expectedLabels.slice(0, -1);
    for (const label of guardedLabels) {
      const frame = byLabel[label];
      assert.ok(frame.root, `${label}: missing result root`);
      assert.equal(frame.root.display, 'flex', `${label}: root was not flex`);
      assert.equal(frame.root.flexWrap, 'wrap', `${label}: root did not wrap`);
      assert.ok(frame.cards.length >= 3, `${label}: surrounding cards missing`);
      for (const card of frame.cards) {
        assert.equal(card.rectangle.transform, 'none',
          `${label}: result card retained native/FLIP transform`);
        assert.ok(card.rectangle.width <= 341,
          `${label}: result card was enlarged`);
        assert.ok(card.media.length > 0, `${label}: card has no media sample`);
        assert.ok(card.media.every(media => !media.visible),
          `${label}: result media became visible`);
      }
      if (frame.clone) {
        assert.equal(frame.clone.visible, false,
          `${label}: detached selected-card clone became visible`);
        assert.ok(frame.clone.media.every(media => !media.visible),
          `${label}: detached clone media became visible`);
      }
      assert.ok(
        frame.pseudoAnimations.every(name => !name.includes('selected-note')),
        `${label}: named View Transition snapshot remained active`
      );
    }

    assert.equal(byLabel['after-close-sync'].guardActive, true);
    assert.equal(byLabel['search-path-sync'].guardActive, true);
    assert.equal(byLabel['search-path-frame-1'].guardActive, true,
      'return guard ended before one protected search paint');
    assert.equal(byLabel['post-clone-removal-frame-2'].guardActive, false,
      'return guard did not release after two stable frames');

    const outside = byLabel['outside-path'];
    assert.equal(outside.guardActive, false);
    assert.equal(outside.root.display, 'block');
    assert.ok(outside.cards.flatMap(card => card.media)
      .every(media => media.visible),
    'return guard leaked into another non-search path');
    assert.deepEqual(report.requests, []);
    assert.deepEqual(report.pageErrors, []);
    report.status = 'PASS';
  } catch (error) {
    failure = error;
    report.status = 'FAIL';
    report.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  } finally {
    if (context) await context.close().catch(error => {
      report.cleanup.contextCloseError = error.message;
    });
    report.productAfter = hashes(extension);
    report.testAfter = crypto.createHash('sha256')
      .update(fs.readFileSync(__filename)).digest('hex');
    try {
      assert.deepEqual(report.productAfter, report.productBefore);
      assert.equal(report.testAfter, report.testBefore);
      removeOwned(profile);
      removeOwned(temporary);
    } catch (error) {
      if (!failure) failure = error;
      report.status = 'FAIL';
      report.cleanup.error = error.message;
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify(report, null, 2)
    );
    console.log(JSON.stringify({
      status: report.status,
      output,
      frames: report.frames.length,
      error: report.error || report.cleanup.error || null,
    }));
  }
  if (failure) throw failure;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
