'use strict';

/*
 * Dependency-free migration contracts.  The root navigation page is the
 * observable baseline.  The sole permitted subtraction is Gitee; browser
 * interactions are checked separately through the TC-MIG manual comparison.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const LEGACY_PAGE = path.join(ROOT, 'mysearch.html');
const LEGACY_SITES = path.join(ROOT, 'SiteUrls.json');
const LEGACY_PINYIN = path.join(ROOT, 'pinyin_dict_firstletter.js');
const EXTENSION = path.join(ROOT, 'extension');
const NAVIGATION = path.join(EXTENSION, 'navigation');
const NAVIGATION_PAGE = path.join(NAVIGATION, 'navigation.html');

const GITEE_IDS = new Set([
  'sync-gitee', 'sync-from-gitee', 'gitee-config', 'upload-history',
  'download-history', 'upload-sites-config', 'download-sites-config',
]);
const GENERIC_SYNC_MARKERS = [
  'sync-button', 'sync-form', 'sync-endpoint', 'sync-token', 'syncEndpoint',
  'syncToken', 'syncExecutor', 'syncConfig',
];
const SORT_IDS = [
  'sort-by-name', 'sort-by-time', 'sort-by-length', 'sort-by-first-time',
  'sort-by-count',
];
const LEGACY_DYNAMIC_TEMPLATE_IDS = new Set(['open-settings', 'import-config-btn']);
const OPTIONS_OWNED_IDS = new Set([
  'settings-modal', 'settings-search', 'settings-actions', 'add-site-row',
  'delete-selected-rows', 'save-settings', 'toggle-context', 'toggle-require',
  'export-config', 'import-config', 'config-file-input', 'sites-table',
  'sites-table-colgroup', 'sites-table-header', 'sites-table-body',
]);
const fileTextCache = new Map();
const functionDeclarationCache = new Map();
let cachedNavigationSources;

function readRequired(file, label) {
  assert.ok(fs.existsSync(file), label + ' must exist at ' + path.relative(ROOT, file));
  if (!fileTextCache.has(file)) fileTextCache.set(file, fs.readFileSync(file, 'utf8'));
  return fileTextCache.get(file);
}

function compact(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function matchAll(source, pattern) {
  return [...source.matchAll(pattern)];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');
}

function idsIn(html) {
  return new Set(matchAll(html, /\bid\s*=\s*["']([^"']+)["']/gi).map((match) => match[1]));
}

function staticMarkupIds(html) {
  return idsIn(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
}

function scriptReferences(html) {
  return matchAll(html, /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)
    .map((match) => match[1]);
}

function stylesheetReferences(html) {
  return matchAll(html, /<link\b[^>]*\brel\s*=\s*["']stylesheet["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)
    .map((match) => match[1]);
}

function inlineStyles(html) {
  return matchAll(html, /<style\b[^>]*>([\s\S]*?)<\/style>/gi).map((match) => match[1]);
}

function localAsset(pageDirectory, reference) {
  assert.doesNotMatch(reference, /^(?:https?:)?\/\//i, 'navigation page must not depend on remote asset ' + reference);
  return path.resolve(pageDirectory, reference.replace(/[?#].*$/, ''));
}

function navigationSources() {
  if (cachedNavigationSources) return cachedNavigationSources;
  const html = readRequired(NAVIGATION_PAGE, 'canonical extension navigation entry');
  const scripts = scriptReferences(html).map((reference) =>
    readRequired(localAsset(NAVIGATION, reference), 'script ' + reference),
  );
  cachedNavigationSources = { html, scripts, text: [html, ...scripts].join('\n') };
  return cachedNavigationSources;
}

function navigationStyles(html) {
  const linked = stylesheetReferences(html).map((reference) =>
    readRequired(localAsset(NAVIGATION, reference), 'stylesheet ' + reference),
  );
  return [...inlineStyles(html), ...linked].join('\n');
}

function recursivelyRead(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...recursivelyRead(full));
    else files.push({ file: full, text: fs.readFileSync(full, 'utf8') });
  }
  return files;
}

function canStartRegexLiteral(source, slashIndex) {
  let previousIndex = slashIndex - 1;
  while (previousIndex >= 0 && /\s/.test(source[previousIndex])) previousIndex -= 1;
  if (previousIndex < 0) return true;
  if (/[([{:;,=!?&|+\-*%^~<>]/.test(source[previousIndex])) return true;
  const precedingWord = source.slice(0, previousIndex + 1).match(/([A-Za-z_$][\w$]*)$/);
  return Boolean(precedingWord && /^(?:return|throw|case|delete|typeof|void|new|in|of|yield|await)$/.test(precedingWord[1]));
}

function skipRegexLiteral(source, slashIndex) {
  let characterClass = false;
  for (let index = slashIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '[') {
      characterClass = true;
      continue;
    }
    if (character === ']') {
      characterClass = false;
      continue;
    }
    if (character === '/' && !characterClass) return index;
    if (character === '\n') break;
  }
  return slashIndex;
}

function findClosingDelimiter(source, openIndex, openCharacter, closeCharacter) {
  assert.equal(source[openIndex], openCharacter, 'delimiter scan must start at an opening delimiter');
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '/' && next !== '/' && next !== '*' && canStartRegexLiteral(source, index)) {
      index = skipRegexLiteral(source, index);
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character.charCodeAt(0) === 96) {
      quote = character;
      continue;
    }
    if (character === openCharacter) depth += 1;
    if (character === closeCharacter) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error('unclosed ' + openCharacter + ' delimiter');
}

function functionDeclarations(source) {
  if (functionDeclarationCache.has(source)) return functionDeclarationCache.get(source);
  const declarations = [];
  const declaration = /(?:^|[;\n]\s*)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  for (const match of matchAll(source, declaration)) {
    const name = match[1];
    const parametersOpen = source.indexOf('(', match.index);
    const parametersClose = findClosingDelimiter(source, parametersOpen, '(', ')');
    const bodyOpen = source.indexOf('{', parametersClose);
    if (bodyOpen === -1) continue;
    const bodyClose = findClosingDelimiter(source, bodyOpen, '{', '}');
    declarations.push({
      name,
      start: match.index,
      end: bodyClose + 1,
      body: source.slice(bodyOpen + 1, bodyClose),
    });
  }
  functionDeclarationCache.set(source, declarations);
  return declarations;
}

function isGiteeDeclaration(declaration) {
  return /gitee|sync|(?:upload|download)(?:History|SitesConfig)/i.test(
    declaration.name + '\n' + declaration.body,
  );
}

function nonGiteeDeclarations(source) {
  return functionDeclarations(source).filter((declaration) => !isGiteeDeclaration(declaration));
}

function functionBody(source, name) {
  const declaration = functionDeclarations(source).find((item) => item.name === name);
  assert.ok(declaration, 'function ' + name + '() must be declared');
  return declaration.body;
}

function functionCallCount(source, name) {
  return matchAll(source, new RegExp('\\b' + escapeRegExp(name) + '\\s*\\(', 'g')).length;
}

function callsDirectlyOrThroughDeclaredFunction(source, fragment, name, visited = new Set()) {
  if (new RegExp('\\b' + escapeRegExp(name) + '\\s*\\(').test(fragment)) return true;
  for (const call of meaningfulCalls(fragment)) {
    if (visited.has(call)) continue;
    const declaration = functionDeclarations(source).find((item) => item.name === call);
    if (declaration) {
      visited.add(call);
      if (callsDirectlyOrThroughDeclaredFunction(source, declaration.body, name, visited)) return true;
    }
  }
  return false;
}

function documentListenerFragments(source, eventName) {
  const quoteClass = '["' + "'" + ']';
  const pattern = new RegExp(
    'document\\.addEventListener\\s*\\(\\s*' + quoteClass + escapeRegExp(eventName) + quoteClass + '\\s*,',
    'g',
  );
  return matchAll(source, pattern).map((match) =>
    listenerCallbackBody(source, match.index + match[0].lastIndexOf('addEventListener')),
  );
}

function variableNamesForId(source, id) {
  const quoteClass = '["' + "'" + ']';
  const idLiteral = quoteClass + escapeRegExp(id) + quoteClass;
  const selectorLiteral = quoteClass + '#' + escapeRegExp(id) + quoteClass;
  const declaration = new RegExp(
    '(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:document\\.)?(?:getElementById\\s*\\(\\s*' +
      idLiteral + '\\s*\\)|querySelector\\s*\\(\\s*' + selectorLiteral + '\\s*\\))',
    'g',
  );
  return new Set(matchAll(source, declaration).map((match) => match[1]));
}

function listenerCallbackBody(source, listenerStart) {
  const open = source.indexOf('(', listenerStart);
  const close = findClosingDelimiter(source, open, '(', ')');
  const eventComma = source.indexOf(',', open + 1);
  assert.ok(eventComma > open && eventComma < close, 'event listener must have a callback argument');
  let callbackStart = eventComma + 1;
  while (/\s/.test(source[callbackStart] || '')) callbackStart += 1;
  const functionExpression = /^(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\(/.exec(
    source.slice(callbackStart, close),
  );
  if (functionExpression) {
    const parametersOpen = callbackStart + functionExpression[0].lastIndexOf('(');
    const parametersClose = findClosingDelimiter(source, parametersOpen, '(', ')');
    let bodyStart = parametersClose + 1;
    while (/\s/.test(source[bodyStart] || '')) bodyStart += 1;
    assert.equal(source[bodyStart], '{', 'function listener callback must have a body');
    const bodyClose = findClosingDelimiter(source, bodyStart, '{', '}');
    return source.slice(bodyStart + 1, bodyClose);
  }
  const arrow = source.indexOf('=>', callbackStart);
  if (arrow !== -1 && arrow < close) {
    let bodyStart = arrow + 2;
    while (/\s/.test(source[bodyStart] || '')) bodyStart += 1;
    if (source[bodyStart] === '{') {
      const bodyClose = findClosingDelimiter(source, bodyStart, '{', '}');
      return source.slice(bodyStart + 1, bodyClose);
    }
    return source.slice(bodyStart, close).replace(/,\s*\{[\s\S]*$/, '');
  }
  const functionBodyStart = source.indexOf('{', callbackStart);
  if (functionBodyStart !== -1 && functionBodyStart < close) {
    const bodyClose = findClosingDelimiter(source, functionBodyStart, '{', '}');
    return source.slice(functionBodyStart + 1, bodyClose);
  }
  const namedCallback = source.slice(callbackStart, close).trim().replace(/,\s*\{[\s\S]*$/, '');
  return /^[A-Za-z_$][\w$]*$/.test(namedCallback) ? namedCallback + '(' : namedCallback;
}

function listenerFragments(source, id, eventName) {
  const listenerStarts = [];
  const quoteClass = '["' + "'" + ']';
  const idLiteral = quoteClass + escapeRegExp(id) + quoteClass;
  const selectorLiteral = quoteClass + '#' + escapeRegExp(id) + quoteClass;
  const suffix = '\\.addEventListener\\s*\\(\\s*' + quoteClass + escapeRegExp(eventName) + quoteClass + '\\s*,';
  const direct = new RegExp(
    '(?:document\\.)?(?:getElementById\\s*\\(\\s*' + idLiteral + '\\s*\\)|querySelector\\s*\\(\\s*' +
      selectorLiteral + '\\s*\\))\\s*' + suffix,
    'g',
  );
  listenerStarts.push(...matchAll(source, direct).map((match) => match.index + match[0].lastIndexOf('addEventListener')));
  for (const variable of variableNamesForId(source, id)) {
    const byVariable = new RegExp('\\b' + escapeRegExp(variable) + '\\s*' + suffix, 'g');
    listenerStarts.push(...matchAll(source, byVariable).map((match) => match.index + match[0].lastIndexOf('addEventListener')));
  }
  return listenerStarts.map((listenerStart) => listenerCallbackBody(source, listenerStart));
}

function meaningfulCalls(fragment) {
  const ignored = new Set([
    'addEventListener', 'preventDefault', 'stopPropagation', 'if', 'for',
    'while', 'switch', 'catch', 'function', 'setTimeout',
  ]);
  return new Set(
    matchAll(fragment, /(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*\(/g)
      .map((match) => match[1])
      .filter((name) => !ignored.has(name)),
  );
}

function assertBinding(source, id, eventName, label) {
  const fragments = listenerFragments(source, id, eventName);
  assert.ok(fragments.length > 0, label + ' must bind #' + id + ' to ' + eventName);
  return fragments;
}

function assertBindingPreserved(legacy, migrated, id, eventName, label) {
  const legacyFragments = assertBinding(legacy, id, eventName, 'legacy baseline ' + label);
  const migratedFragments = assertBinding(migrated, id, eventName, label);
  const calls = [...new Set(legacyFragments.flatMap((fragment) => [...meaningfulCalls(fragment)]))];
  assert.ok(calls.length > 0, 'legacy baseline ' + label + ' must invoke an action from its ' + eventName + ' binding');
  for (const call of calls) {
    assert.ok(
      migratedFragments.some((fragment) => new RegExp('\\b' + escapeRegExp(call) + '\\s*\\(').test(fragment)),
      label + ' must preserve ' + call + '() from the legacy ' + eventName + ' binding',
    );
  }
}

function boundLegacyIds(source, filter, events) {
  return [...idsIn(source)]
    .filter((id) => !GITEE_IDS.has(id) && !/gitee/i.test(id) && filter.test(id))
    .filter((id) => events.some((eventName) => listenerFragments(source, id, eventName).length > 0));
}

function conditionalBranches(functionSource) {
  const branches = [];
  const conditional = /\b(?:else\s+)?if\s*\(/g;
  for (const match of matchAll(functionSource, conditional)) {
    const conditionOpen = functionSource.indexOf('(', match.index);
    const conditionClose = findClosingDelimiter(functionSource, conditionOpen, '(', ')');
    let bodyOpen = conditionClose + 1;
    while (/\s/.test(functionSource[bodyOpen] || '')) bodyOpen += 1;
    if (functionSource[bodyOpen] !== '{') continue;
    const bodyClose = findClosingDelimiter(functionSource, bodyOpen, '{', '}');
    branches.push({
      condition: functionSource.slice(conditionOpen + 1, conditionClose),
      body: functionSource.slice(bodyOpen + 1, bodyClose),
      bodyOpen,
      bodyClose,
    });
  }
  return branches;
}

function matchingShortcutBranches(handlerBody, tokens, requireCtrl) {
  const branches = conditionalBranches(handlerBody);
  const matching = branches.filter((branch) => {
    const ancestors = branches
      .filter((candidate) => candidate.bodyOpen < branch.bodyOpen && candidate.bodyClose >= branch.bodyClose)
      .sort((left, right) => left.bodyOpen - right.bodyOpen);
    const conditionPath = [...ancestors.map((item) => item.condition), branch.condition].join('\n');
    const matchesKey = tokens.some((token) => conditionPath.includes(token));
    return matchesKey && (!requireCtrl || /ctrlKey/.test(conditionPath));
  });
  return matching.filter((branch) => !matching.some(
    (candidate) => branch.bodyOpen < candidate.bodyOpen && branch.bodyClose >= candidate.bodyClose,
  ));
}

function stateOrFocusMarkers(branchBody) {
  const markers = [];
  if (/\.(?:focus|blur|select|setSelectionRange)\s*\(/.test(branchBody)) markers.push('focus');
  if (/\b(?:value|selectionStart|selectionEnd)\b\s*(?:=|\+\+|--)/.test(branchBody)) markers.push('input-selection');
  if (/\b(?:[A-Za-z_$][\w$]*(?:Focus|Cursor|Selected|Active|Index)|(?:current|cursor|selected|focus|active)[A-Za-z_$][\w$]*)\b(?:\.[A-Za-z_$][\w$]*)?\s*(?:=|\+\+|--|\+=|-=)/i.test(branchBody)) {
    markers.push('focus-state');
  }
  if (/\bclassList\.(?:add|remove|toggle)\s*\(/.test(branchBody)) markers.push('visual-state');
  return markers;
}

function assertShortcutPreserved(legacy, migrated, label, tokens, requireCtrl) {
  const legacyHandler = functionBody(legacy, 'handleGlobalKeyDown');
  const migratedHandler = functionBody(migrated, 'handleGlobalKeyDown');
  const legacyBranches = matchingShortcutBranches(legacyHandler, tokens, requireCtrl);
  assert.ok(legacyBranches.length > 0, 'legacy handleGlobalKeyDown must contain ' + label + ' condition');

  const migratedBranches = matchingShortcutBranches(migratedHandler, tokens, requireCtrl);
  assert.ok(migratedBranches.length > 0, 'migrated handleGlobalKeyDown must contain ' + label + ' condition');
  for (const legacyBranch of legacyBranches) {
    const legacyCalls = [...meaningfulCalls(legacyBranch.body)].filter(
      (call) => !['focus', 'blur', 'select', 'setSelectionRange', 'add', 'remove', 'toggle'].includes(call),
    );
    const legacyMarkers = stateOrFocusMarkers(legacyBranch.body);
    if (legacyCalls.length === 0 && legacyMarkers.length === 0) {
      assert.ok(
        migratedBranches.some((candidate) => !/preventDefault\s*\(/.test(legacyBranch.body)
          || /preventDefault\s*\(/.test(candidate.body)),
        'migrated ' + label + ' must retain the legacy guard branch',
      );
      continue;
    }
    const migratedBranch = migratedBranches.find((candidate) => {
      const preservesPreventDefault = !/preventDefault\s*\(/.test(legacyBranch.body)
        || /preventDefault\s*\(/.test(candidate.body);
      if (legacyCalls.length > 0) {
        return preservesPreventDefault
          && legacyCalls.every((call) => new RegExp('\\b' + escapeRegExp(call) + '\\s*\\(').test(candidate.body));
      }
      return preservesPreventDefault && stateOrFocusMarkers(candidate.body).length > 0;
    });
    assert.ok(migratedBranch,
      'migrated ' + label + ' branch must retain legacy action calls or state/focus statements in the same branch');
    if (/preventDefault\s*\(/.test(legacyBranch.body)) {
      assert.match(migratedBranch.body, /preventDefault\s*\(/,
        'migrated ' + label + ' branch must retain preventDefault() with its action');
    }
  }
}

test('TC-MIG-001: canonical new-tab and direct entry use navigation.html', () => {
  const manifest = JSON.parse(readRequired(path.join(EXTENSION, 'manifest.json'), 'extension manifest'));
  assert.equal(
    manifest.chrome_url_overrides?.newtab,
    'navigation/navigation.html',
    'MV3 new-tab override must point to the canonical direct navigation page',
  );
  const { html, text } = navigationSources();
  assert.match(html, /id=["']search-input["']/i, 'canonical page must be an interactive navigation page');
  assert.doesNotMatch(html, /id=["']settings-modal["']/i,
    'canonical navigation page must not keep a second operable settings modal');
  assert.match(text, /settingsBtn\.id\s*=\s*["']settings["']/,
    'canonical navigation page must retain its settings toolbar entry');
  assert.match(text, /chrome\.runtime\.openOptionsPage\s*\(/,
    'the settings toolbar entry must open the extension options page');
  assert.match(text, /localStorage|indexedDB/i, 'both entry paths must share local persisted navigation state');
});

test('TC-MIG-002: legacy non-Gitee structure and three responsive layout tiers are retained', () => {
  const legacyHtml = readRequired(LEGACY_PAGE, 'legacy navigation source');
  const { html } = navigationSources();
  const migratedIds = staticMarkupIds(html);
  for (const id of staticMarkupIds(legacyHtml)) {
    if (!GITEE_IDS.has(id) && !/gitee/i.test(id) &&
        !LEGACY_DYNAMIC_TEMPLATE_IDS.has(id) && !OPTIONS_OWNED_IDS.has(id)) {
      assert.ok(migratedIds.has(id), 'non-Gitee legacy control #' + id + ' must remain in navigation.html');
    }
  }

  const migratedCss = compact(navigationStyles(html));
  assert.match(migratedCss, /\.fixed-header/,
    'navigation must retain the fixed search/button header layout');
  assert.match(migratedCss, /\.history-item/,
    'navigation must retain visible history-item layout');
  assert.match(migratedCss, /@media\s*\([^)]*max-width\s*:\s*768px/i,
    'navigation must retain its 768px responsive tier');
  assert.match(migratedCss, /@media\s*\([^)]*max-width\s*:\s*480px/i,
    'navigation must retain its 480px responsive tier');
});

test('TC-MIG-003: defaults and pinyin remain shared while site-setting persistence moves to options', () => {
  const { html, text } = navigationSources();
  const optionsHtml = readRequired(path.join(EXTENSION, 'options', 'options.html'), 'extension options page');
  const optionsJs = readRequired(path.join(EXTENSION, 'options', 'options.js'), 'extension options controller');
  assert.equal(
    readRequired(path.join(NAVIGATION, 'SiteUrls.json'), 'bundled SiteUrls defaults'),
    readRequired(LEGACY_SITES, 'legacy SiteUrls defaults'),
    'default site configuration must preserve legacy ordering and fields byte-for-byte',
  );
  assert.equal(
    readRequired(path.join(NAVIGATION, 'pinyin_dict_firstletter.js'), 'bundled pinyin dictionary'),
    readRequired(LEGACY_PINYIN, 'legacy pinyin dictionary'),
    'pinyin first-letter dictionary must be bundled unchanged',
  );
  assert.match(html, /<script\b[^>]*\bsrc=["'][^"']*pinyin_dict_firstletter\.js["']/i,
    'canonical page must load the bundled pinyin dictionary');
  assert.match(text, /SiteUrls\.json/i, 'site initialization must consume the bundled defaults');
  assert.match(text, /localStorage/i, 'site/history local persistence must remain available');
  assert.match(text, /indexedDB/i, 'legacy IndexedDB persistence must remain available');
  assert.match(optionsHtml, /pinyin_dict_firstletter\.js/i,
    'options site filtering must load the same pinyin dictionary');
  assert.match(optionsJs, /MySiteConfigDB/,
    'site-setting persistence must move to options without changing the shared database');
  assert.match(optionsJs, /siteConfig/,
    'site-setting persistence must keep the shared store contract');
  assert.match(text, /data-site|dataset\.site/i,
    'migrated page must retain dynamic site-button identity handling');
});

test('TC-MIG-004: main search controls preserve non-Gitee click and keyboard action bindings', () => {
  const legacy = readRequired(LEGACY_PAGE, 'legacy navigation source');
  const { text } = navigationSources();
  const navigationOnlyControls = [
    'save-only', 'all-sites', 'common-sites', 'foreign-sites', 'search-input',
  ];
  for (const id of navigationOnlyControls) {
    for (const eventName of ['click', 'keydown']) {
      if (listenerFragments(legacy, id, eventName).length > 0) {
        assertBindingPreserved(legacy, text, id, eventName, 'main search control #' + id);
      }
    }
  }
  assert.match(text, /window\.open|open\(/, 'migrated search actions must retain an external navigation call');
});

test('TC-MIG-005: quick search binds input and Enter to performQuickSearch with pinyin support', () => {
  const legacy = readRequired(LEGACY_PAGE, 'legacy navigation source');
  const { text } = navigationSources();
  assertBindingPreserved(legacy, text, 'quick-search-input', 'input', 'quick search input');
  assert.match(text, /\bfunction\s+performQuickSearch\s*\(/,
    'quick search must retain performQuickSearch()');
  assert.match(text, /\bpinyin/i, 'quick search must retain pinyin lookup logic');
  assertShortcutPreserved(legacy, text, 'quick-search Enter', ['Enter'], false);
  assert.match(text, /ArrowUp|ArrowDown/, 'quick search must retain candidate cursor movement');
  assert.match(text, /highlight/, 'quick search must retain match highlighting');
  assert.match(text, /cursor-highlight/, 'quick search must retain cursor highlighting');
});

test('TC-MIG-006: handleGlobalKeyDown is document-bound and every legacy shortcut branch retains its action call', () => {
  const legacy = readRequired(LEGACY_PAGE, 'legacy navigation source');
  const { text } = navigationSources();
  assert.match(text, /\bfunction\s+handleGlobalKeyDown\s*\(/,
    'global keyboard state machine must retain handleGlobalKeyDown()');
  assert.match(
    text,
    /document\.addEventListener\s*\(\s*["']keydown["']\s*,\s*handleGlobalKeyDown\s*\)/,
    'document keydown must bind handleGlobalKeyDown directly',
  );

  const shortcuts = [
    ['Ctrl+F3', ['F3'], true],
    ['Ctrl+F5', ['F5'], true],
    ['Ctrl+F6', ['F6'], true],
    ['Ctrl+F9', ['F9'], true],
    ['Ctrl+F10', ['F10'], true],
    ['F7', ['F7'], false],
    ['Ctrl+Delete', ['Delete'], true],
    ['Ctrl+-', ['"-"', "'-'"], true],
    ['Tab', ['Tab'], false],
    ['Ctrl+Tab', ['Tab'], true],
    ['Space', ['Space', 'Spacebar', '" "', "' '"], false],
    ['Enter', ['Enter'], false],
    ['F2', ['F2'], false],
    ['Delete', ['Delete'], false],
    ['Ctrl+Z', ['z', 'Z'], true],
  ];
  for (const [label, tokens, requireCtrl] of shortcuts) {
    assertShortcutPreserved(legacy, text, label, tokens, requireCtrl);
  }
  const f8Branches = matchingShortcutBranches(functionBody(text, 'handleGlobalKeyDown'), ['F8'], false);
  assert.ok(f8Branches.some((branch) => /openOptionsPage|openExtensionOptions/.test(branch.body)),
    'navigation F8 must open the migrated options page');
});

test('TC-MIG-007: GlobalQuit remains the shared desktop Escape and mobile Esc action', () => {
  const { text } = navigationSources();
  assert.match(text, /\bfunction\s+GlobalQuit\s*\(/, 'main-page Escape state machine must retain GlobalQuit()');
  const escapeBranches = matchingShortcutBranches(functionBody(text, 'handleGlobalKeyDown'), ['Escape'], false);
  assert.ok(escapeBranches.some((branch) => /GlobalQuit\s*\(/.test(branch.body)),
    'navigation Escape must retain the main-page GlobalQuit action');
  assertBinding(text, 'mobile-esc-btn', 'click', 'mobile Escape control');
  const mobileBindings = listenerFragments(text, 'mobile-esc-btn', 'click');
  assert.ok(mobileBindings.some((fragment) => /\bGlobalQuit\s*\(/.test(fragment)),
    'mobile-esc-btn click must invoke GlobalQuit()');
});

test('TC-MIG-008: history sorting and edit/delete/undo/import/export controls keep their concrete bindings', () => {
  const legacy = readRequired(LEGACY_PAGE, 'legacy navigation source');
  const { text } = navigationSources();
  for (const id of SORT_IDS) {
    assertBindingPreserved(legacy, text, id, 'click', 'history sort #' + id);
  }
  const historyControls = [
    'edit-history', 'export-history', 'import-history', 'history-edit-input',
    ...SORT_IDS,
  ];
  for (const id of historyControls) {
    for (const eventName of ['click', 'change']) {
      if (listenerFragments(legacy, id, eventName).length > 0) {
        assertBindingPreserved(legacy, text, id, eventName, 'history control #' + id);
      }
    }
  }
});

test('TC-MIG-009: settings filtering, saving, table drag, tri-state, and site-config files move to options', () => {
  const legacy = readRequired(LEGACY_PAGE, 'legacy navigation source');
  const options = readRequired(path.join(EXTENSION, 'options', 'options.js'), 'extension options controller');
  const { html: navigationHtml, text: navigationText } = navigationSources();
  assert.match(navigationText, /chrome\.runtime\.openOptionsPage\s*\(/,
    'navigation settings control must open options');
  assert.doesNotMatch(navigationHtml, /id=["']settings-modal["']/,
    'navigation must not retain a second operable settings modal');
  assertBinding(options, 'settings-search', 'input', 'settings filter');

  const settingsControls = [
    'add-site-row', 'delete-selected-rows', 'save-settings', 'toggle-context',
    'toggle-require', 'export-config', 'import-config', 'config-file-input',
  ];
  for (const id of settingsControls) {
    for (const eventName of ['click', 'change', 'input']) {
      if (listenerFragments(legacy, id, eventName).length > 0) {
        assertBinding(options, id, eventName, 'settings control #' + id);
      }
    }
  }
  for (const eventName of ['dragstart', 'dragover', 'drop']) {
    assert.match(options, new RegExp('addEventListener\\s*\\(\\s*["' + "'" + ']' + eventName + '["' + "'" + ']'),
      'settings table must retain ' + eventName + ' drag binding');
  }
  for (const id of ['toggle-context', 'toggle-require']) {
    assertBinding(options, id, 'click', 'settings tri-state control #' + id);
  }
  assert.match(options, /serializeSiteConfig|SiteUrls\.json|exportConfig/,
    'options must retain local website-configuration export implementation');
});

test('TC-MIG-010: options owns the settings keyboard state machine', () => {
  const options = readRequired(path.join(EXTENSION, 'options', 'options.js'), 'extension options controller');
  assert.match(options, /addEventListener\s*\(\s*["']keydown["']/,
    'options must bind its settings keyboard behavior');
  for (const key of ['F8', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Escape']) {
    assert.ok(options.includes(key), 'options settings keyboard state machine must retain ' + key);
  }
  assert.match(options, /settings-search/i, 'settings keyboard handling must retain filter input state');
});

test('TC-MIG-011: every Gitee surface and generic sync replacement is absent from manifest and navigation resources', () => {
  const manifest = readRequired(path.join(EXTENSION, 'manifest.json'), 'extension manifest');
  assert.doesNotMatch(manifest, /gitee/iu,
    'extension manifest must not retain Gitee host permissions, endpoints, or other metadata');

  const { html } = navigationSources();
  const styles = navigationStyles(html);
  assert.doesNotMatch(styles, /@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//iu,
    'navigation styles must not fetch a remote stylesheet');
  assert.doesNotMatch(styles, /url\(\s*["']?(?:https?:)?\/\//iu,
    'navigation styles must not fetch a remote URL asset');

  const resources = [
    ...recursivelyRead(NAVIGATION),
    ...recursivelyRead(path.join(EXTENSION, 'options')),
  ];
  assert.ok(resources.length > 0, 'navigation resource directory must exist');
  for (const { file, text } of resources) {
    const relative = path.relative(ROOT, file);
    assert.doesNotMatch(relative, /gitee/i, 'no Gitee-named navigation resource may remain');
    assert.doesNotMatch(text, /gitee/iu,
      'any casing of Gitee text, configuration, token access, or request must be absent from ' + relative);
    assert.doesNotMatch(text, /sync-gitee|sync-from-gitee|gitee-config|upload-history|download-history|upload-sites-config|download-sites-config/iu,
      'Gitee UI identifiers must be absent from ' + relative);
    assert.doesNotMatch(text, /\bgiteeConfig\b|api\.gitee\.com|gitee\.com\/api/iu,
      'Gitee configuration and API calls must be absent from ' + relative);
    for (const marker of GENERIC_SYNC_MARKERS) {
      assert.ok(!text.includes(marker), 'generic sync substitute ' + marker + ' must be absent from ' + relative);
    }
    assert.doesNotMatch(text, /\b(?:fetch|XMLHttpRequest)\b[\s\S]{0,160}\b(?:syncEndpoint|syncToken)\b/iu,
      'generic sync API execution must be absent from ' + relative);
  }
});
