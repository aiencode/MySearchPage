/** MySearchPage extension options. */
document.addEventListener('DOMContentLoaded', () => {
  const DB_NAME = 'MySiteConfigDB';
  const DB_VERSION = 1;
  const DB_STORE = 'siteConfig';
  const DB_KEY = 'main';
  const COLUMN_WIDTHS_KEY = 'tableColumnWidths';
  const SITE_MODES = Object.freeze({ NO_BLANK: 0, BOTH: 1, BLANK_ONLY: 2 });
  const MODE_SYMBOLS = { 0: '☒', 1: '☑', 2: '●' };
  const MODE_TITLES = {
    0: '禁止单开（必须有关键词）',
    1: '既能单开也能搜索',
    2: '只能单开（无关键词访问）',
  };
  const byId = (id) => document.getElementById(id);
  const globalToggle = byId('opt-global-toggle');
  const rulesTableBody = byId('rules-table-body');
  const btnAddRule = byId('btn-add-rule');
  const btnResetRules = byId('btn-reset-rules');
  const btnImportFile = byId('btn-import-file');
  const btnExportFile = byId('btn-export-file');
  const btnImportMSP = byId('btn-import-msp');
  const fileImport = byId('file-import');
  const ruleModal = byId('rule-modal');
  const modalTitle = byId('modal-title');
  const ruleDomain = byId('rule-domain');
  const ruleUaMode = byId('rule-ua-mode');
  const rulePreset = byId('rule-preset');
  const ruleCustomUA = byId('rule-custom-ua');
  const ruleUiTransform = byId('rule-ui-transform');
  const presetGroup = byId('preset-group');
  const customUaGroup = byId('custom-ua-group');
  const btnModalCancel = byId('btn-modal-cancel');
  const btnModalSave = byId('btn-modal-save');
  const settingsSearch = document.getElementById('settings-search');
  const sitesTable = document.getElementById('sites-table');
  const sitesTableBody = document.getElementById('sites-table-body');
  const addSiteRow = document.getElementById('add-site-row');
  const deleteSelectedRows = document.getElementById('delete-selected-rows');
  const saveSettings = document.getElementById('save-settings');
  const toggleContext = document.getElementById('toggle-context');
  const toggleRequire = document.getElementById('toggle-require');
  const exportConfig = document.getElementById('export-config');
  const importConfig = document.getElementById('import-config');
  const configFileInput = document.getElementById('config-file-input');

  let editingDomain = null;
  let currentUaRules = {};
  let currentSiteConfig = emptySiteConfig();
  let draggedTableRow = null;

  function emptySiteConfig() {
    return { siteUrls: {}, buttonConfig: [], siteFlags: {} };
  }

  function normalizeSiteConfig(value) {
    const source = value && typeof value === 'object' ? value : {};
    const siteUrls = source.siteUrls && typeof source.siteUrls === 'object' ? { ...source.siteUrls } : {};
    const buttonConfig = Array.isArray(source.buttonConfig)
      ? source.buttonConfig.map((item) => ({
          ...item,
          dataSite: item.dataSite || item.datasite || '',
          isSmall: !!item.isSmall,
        })).filter((item) => item.dataSite)
      : [];
    const sourceFlags = source.siteFlags && typeof source.siteFlags === 'object' ? source.siteFlags : {};
    const siteFlags = {};
    for (const site of Object.keys(siteUrls)) {
      const flags = sourceFlags[site] && typeof sourceFlags[site] === 'object' ? sourceFlags[site] : {};
      const mode = siteMode(flags);
      siteFlags[site] = {
        ...flags,
        rightClick: !!flags.rightClick,
        mode,
        desktopMode: flags.desktopMode !== false,
        ...modeFlags(mode),
      };
    }
    return { siteUrls, buttonConfig, siteFlags };
  }

  function openSiteConfigDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          const store = db.createObjectStore(DB_STORE, { keyPath: 'id' });
          if (store.createIndex) store.createIndex('type', 'type', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开本地配置库'));
    });
  }

  async function readSiteConfig() {
    const db = await openSiteConfigDB();
    const record = await new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法读取本地配置'));
    });
    if (record?.data) return normalizeSiteConfig(record.data);
    try {
      const response = await fetch(chrome.runtime.getURL('navigation/SiteUrls.json'));
      if (response.ok) return normalizeSiteConfig(await response.json());
    } catch (error) {
      console.warn('默认网站配置加载失败', error);
    }
    return emptySiteConfig();
  }

  async function writeSiteConfig(config) {
    const normalized = normalizeSiteConfig(config);
    const db = await openSiteConfigDB();
    await new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put({
        id: DB_KEY, type: 'siteConfig', data: normalized, timestamp: Date.now(),
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('无法保存本地配置'));
    });
    currentSiteConfig = normalized;
    return normalized;
  }

  async function publishSiteConfigChanged() {
    await sendMessage({ type: 'SITE_CONFIG_UPDATED' });
  }

  async function initUaSettings() {
    const response = await sendMessage({ type: 'GET_STATUS' });
    if (!response) return;
    currentUaRules = response.rules && typeof response.rules === 'object' ? response.rules : {};
    if (globalToggle) globalToggle.checked = response.globalEnabled !== false;
    renderUaTable(currentUaRules);
    syncSiteRowsFromUaRules();
  }

  async function initSiteSettings() {
    if (!sitesTableBody) return;
    currentSiteConfig = await readSiteConfig();
    renderSiteTable(currentSiteConfig);
    syncSiteRowsFromUaRules();
    restoreColumnWidths();
    bindColumnResizers();
  }

  function orderedSiteEntries(config) {
    const entries = [];
    const seen = new Set();
    for (const button of config.buttonConfig) {
      const site = button.dataSite || button.datasite;
      if (!site || seen.has(site) || !Object.prototype.hasOwnProperty.call(config.siteUrls, site)) continue;
      entries.push({ site, url: config.siteUrls[site], button });
      seen.add(site);
    }
    for (const [site, url] of Object.entries(config.siteUrls)) {
      if (!seen.has(site)) entries.push({ site, url, button: { name: site, dataSite: site, isSmall: false } });
    }
    return entries;
  }

  function siteMode(flags) {
    if (Number.isInteger(flags?.mode) && flags.mode >= 0 && flags.mode <= 2) return flags.mode;
    if (flags?.allowBlank === true) return SITE_MODES.BOTH;
    if (flags?.requireKeyword === true) return SITE_MODES.NO_BLANK;
    if (flags?.allowBlank === false && flags?.requireKeyword === false) return SITE_MODES.BLANK_ONLY;
    return SITE_MODES.NO_BLANK;
  }

  function modeFlags(mode) {
    if (mode === SITE_MODES.BOTH) return { allowBlank: true, requireKeyword: false };
    if (mode === SITE_MODES.BLANK_ONLY) return { allowBlank: false, requireKeyword: false };
    return { allowBlank: false, requireKeyword: true };
  }

  function appendInputCell(row, value, label) {
    const cell = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.setAttribute('aria-label', label);
    cell.appendChild(input);
    row.appendChild(cell);
    return input;
  }

  function createRightClickControl(enabled) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'two-state-checkbox site-right-click';
    input.checked = !!enabled;
    input.setAttribute('data-checked', enabled ? '1' : '0');
    input.setAttribute('aria-label', '启用右键');
    input.addEventListener('change', () => input.setAttribute('data-checked', input.checked ? '1' : '0'));
    return input;
  }

  function setModeControl(input, mode) {
    const normalized = Number(mode) % 3;
    input.setAttribute('data-state', String(normalized));
    input.value = MODE_SYMBOLS[normalized];
    input.title = MODE_TITLES[normalized];
  }

  function createModeControl(mode) {
    const input = document.createElement('input');
    input.type = 'button';
    input.className = 'three-state-checkbox site-open-mode';
    input.setAttribute('aria-label', '单开模式');
    setModeControl(input, mode);
    input.addEventListener('click', () => setModeControl(input, (Number(input.getAttribute('data-state')) + 1) % 3));
    return input;
  }

  function setDesktopControl(input, isDesktop) {
    input.checked = !!isDesktop;
    input.value = isDesktop ? 'desktop' : 'mobile';
    input.setAttribute('data-desktop', isDesktop ? '1' : '0');
    input.title = isDesktop ? '桌面端网站' : '手机端网站';
    input.setAttribute('aria-label', input.title);
  }

  function createDesktopControl(isDesktop) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'two-state-checkbox site-desktop-mode';
    setDesktopControl(input, isDesktop);
    input.addEventListener('change', () => applyDesktopModeImmediately(input, input.checked));
    return input;
  }

  function createSiteRow({ site = '', url = '', button = {}, flags = {} }) {
    const row = document.createElement('tr');
    row.className = 'draggable-row';
    row.draggable = true;
    row.dataset.site = site;
    row.dataset.originalSite = site;
    row.dataset.isSmall = button.isSmall ? 'true' : 'false';
    row.setAttribute('data-is-small', row.dataset.isSmall);
    const nameInput = appendInputCell(row, button.name || site, '按钮名称');
    const dragHandle = document.createElement('span');
    dragHandle.className = 'drag-handle';
    dragHandle.textContent = '⋮⋮';
    dragHandle.title = '拖拽排序';
    nameInput.parentNode.insertBefore(dragHandle, nameInput);
    appendInputCell(row, site, 'Data-site');
    appendInputCell(row, url, 'Site Urls');
    const rightCell = document.createElement('td');
    rightCell.appendChild(createRightClickControl(!!flags.rightClick));
    row.appendChild(rightCell);
    const modeCell = document.createElement('td');
    modeCell.appendChild(createModeControl(siteMode(flags)));
    row.appendChild(modeCell);
    const desktopCell = document.createElement('td');
    desktopCell.appendChild(createDesktopControl(flags.desktopMode !== false));
    row.appendChild(desktopCell);
    const actionCell = document.createElement('td');
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'delete-btn';
    removeButton.textContent = '删除';
    removeButton.addEventListener('click', () => row.remove());
    actionCell.appendChild(removeButton);
    row.appendChild(actionCell);
    row.addEventListener('click', (event) => {
      if (event.target.closest('input,button,.drag-handle')) return;
      row.classList.toggle('selected');
    });
    row.addEventListener('dragstart', handleTableDragStart);
    row.addEventListener('dragover', handleTableDragOver);
    row.addEventListener('drop', handleTableDrop);
    row.addEventListener('dragend', handleTableDragEnd);
    row.addEventListener('dragenter', handleTableDragEnter);
    row.addEventListener('dragleave', handleTableDragLeave);
    return row;
  }

  function renderSiteTable(config) {
    if (!sitesTableBody) return;
    sitesTableBody.innerHTML = '';
    for (const entry of orderedSiteEntries(config)) {
      sitesTableBody.appendChild(createSiteRow({ ...entry, flags: config.siteFlags[entry.site] || {} }));
    }
    applySettingsFilter();
  }

  function siteRowsByDomain() {
    const groups = new Map();
    for (const row of Array.from(sitesTableBody?.querySelectorAll('tr') || [])) {
      const domain = baseDomainForRow(row);
      if (!domain) continue;
      if (!groups.has(domain)) groups.set(domain, []);
      groups.get(domain).push(row);
    }
    return groups;
  }

  function presentedDesktop(row) {
    const control = row?.querySelector('td:nth-child(6) input');
    if (!control) return true;
    const state = control.getAttribute('data-desktop');
    return state == null ? control.checked !== false : state !== '0';
  }

  function setDomainRowsDesktop(rows, isDesktop) {
    for (const row of rows || []) {
      const control = row.querySelector('td:nth-child(6) input');
      if (control) setDesktopControl(control, isDesktop);
    }
  }

  function desktopFromUaRule(rule) {
    if (rule?.uaMode === 'desktop') return true;
    if (rule?.uaMode === 'mobile') return false;
    return null;
  }

  function syncSiteRowsFromUaRules() {
    for (const [domain, rows] of siteRowsByDomain()) {
      const isDesktop = desktopFromUaRule(currentUaRules[domain]);
      if (isDesktop != null) setDomainRowsDesktop(rows, isDesktop);
    }
  }

  function uaRuleForMode(domain, isDesktop) {
    const previous = currentUaRules[domain] || {};
    return {
      ...previous,
      enabled: Object.prototype.hasOwnProperty.call(previous, 'enabled') ? previous.enabled : true,
      uaMode: isDesktop ? 'desktop' : 'mobile',
      presetKey: isDesktop ? 'chrome_windows' : 'android_chrome',
      customUA: Object.prototype.hasOwnProperty.call(previous, 'customUA') ? previous.customUA : null,
      uiTransform: Object.prototype.hasOwnProperty.call(previous, 'uiTransform') ? previous.uiTransform : false,
    };
  }

  function normalizedDomainRules({ preferCurrent = true } = {}) {
    const rules = {};
    for (const [domain, rows] of siteRowsByDomain()) {
      const currentMode = preferCurrent ? desktopFromUaRule(currentUaRules[domain]) : null;
      const isDesktop = currentMode == null ? presentedDesktop(rows[0]) : currentMode;
      setDomainRowsDesktop(rows, isDesktop);
      rules[domain] = uaRuleForMode(domain, isDesktop);
    }
    return rules;
  }

  async function applyDomainRulesFromSites({ preferCurrent = true } = {}) {
    const rules = normalizedDomainRules({ preferCurrent });
    for (const [domain, rule] of Object.entries(rules)) {
      currentUaRules[domain] = rule;
      await sendMessage({ type: 'UPDATE_RULE', domain, rule });
    }
    renderUaTable(currentUaRules);
    return rules;
  }

  function handleTableDragStart(event) {
    draggedTableRow = this;
    this.classList.add('dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', this.dataset.site || '');
    }
  }
  function handleTableDragOver(event) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }
  function handleTableDragEnter(event) {
    event.preventDefault();
    if (draggedTableRow && draggedTableRow !== this) this.classList.add('drag-over');
  }
  function handleTableDragLeave() { this.classList.remove('drag-over'); }
  async function handleTableDrop(event) {
    event.preventDefault();
    if (!draggedTableRow || draggedTableRow === this || !this.parentNode) return;
    const body = this.parentNode;
    const rows = Array.from(body.children);
    const sourceIndex = rows.indexOf(draggedTableRow);
    const targetIndex = rows.indexOf(this);
    if (sourceIndex < targetIndex) body.insertBefore(draggedTableRow, rows[targetIndex + 1] || null);
    else body.insertBefore(draggedTableRow, this);
    Array.from(body.children).forEach((row, index) => {
      row.dataset.index = String(index);
      row.classList.remove('selected');
    });
    this.classList.remove('drag-over');
    try {
      await saveSiteSettings(false);
    } catch (error) {
      showToast('自动保存失败: ' + error.message);
    }
  }
  function handleTableDragEnd() {
    this.classList.remove('dragging');
    for (const row of Array.from(sitesTableBody?.children || [])) {
      row.classList.remove('drag-over');
      row.classList.remove('selected');
    }
    draggedTableRow = null;
  }

  function configFromTable() {
    const siteUrls = {};
    const buttonConfig = [];
    const siteFlags = {};
    for (const row of Array.from(sitesTableBody?.querySelectorAll('tr') || [])) {
      const name = row.querySelector('td:nth-child(1) input')?.value.trim() || '';
      const site = row.querySelector('td:nth-child(2) input')?.value.trim() || '';
      const url = row.querySelector('td:nth-child(3) input')?.value.trim() || '';
      if (!site || !url) continue;
      const right = row.querySelector('td:nth-child(4) input');
      const modeInput = row.querySelector('td:nth-child(5) input');
      const desktop = row.querySelector('td:nth-child(6) input');
      const mode = Number(modeInput?.getAttribute('data-state'));
      const normalizedMode = Number.isInteger(mode) && mode >= 0 && mode <= 2 ? mode : SITE_MODES.NO_BLANK;
      siteUrls[site] = url;
      buttonConfig.push({
        name: name || site,
        dataSite: site,
        isSmall: row.dataset.isSmall === 'true' || row.getAttribute('data-is-small') === 'true',
      });
      siteFlags[site] = {
        rightClick: !!right?.checked || right?.getAttribute('data-checked') === '1',
        mode: normalizedMode,
        desktopMode: desktop ? desktop.getAttribute('data-desktop') !== '0' : true,
        ...modeFlags(normalizedMode),
      };
    }
    return { siteUrls, buttonConfig, siteFlags };
  }

  async function saveSiteSettings(showConfirmation = true) {
    await applyDomainRulesFromSites({ preferCurrent: true });
    const config = await writeSiteConfig(configFromTable());
    await publishSiteConfigChanged();
    if (showConfirmation) showToast('网站配置已保存');
    return config;
  }

  function baseDomainForRow(row) {
    const value = row?.querySelector('td:nth-child(3) input')?.value.trim();
    return value ? extractDomain(value) : null;
  }

  async function applyDesktopModeImmediately(control, isDesktop) {
    const domain = baseDomainForRow(control.closest('tr'));
    setDesktopControl(control, isDesktop);
    if (!domain || !sitesTableBody) return;
    setDomainRowsDesktop(siteRowsByDomain().get(domain), isDesktop);
    const nextRule = uaRuleForMode(domain, isDesktop);
    currentUaRules[domain] = nextRule;
    await sendMessage({ type: 'UPDATE_RULE', domain, rule: nextRule });
    renderUaTable(currentUaRules);
    showToast(isDesktop ? '已切换为桌面 UA' : '已切换为手机 UA');
  }

  function chineseInitialSets(text) {
    const dict = window.pinyin_dict_firstletter;
    const all = dict?.all;
    const polyphone = dict?.polyphone || {};
    const result = [];
    for (const char of String(text || '')) {
      const code = char.charCodeAt(0);
      if (code >= 19968 && code <= 40869 && all) result.push(String(polyphone[code] || all.charAt(code - 19968) || '').toLowerCase());
      else if (/[a-z0-9]/i.test(char)) result.push(char.toLowerCase());
    }
    return result;
  }

  function pinyinContains(text, query) {
    const sets = chineseInitialSets(text);
    const needle = String(query || '').toLowerCase();
    for (let start = 0; needle && start <= sets.length - needle.length; start += 1) {
      let matches = true;
      for (let offset = 0; offset < needle.length; offset += 1) {
        if (!sets[start + offset].includes(needle[offset])) { matches = false; break; }
      }
      if (matches) return true;
    }
    return false;
  }

  function applySettingsFilter() {
    if (!settingsSearch || !sitesTableBody) return;
    const terms = settingsSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    for (const row of Array.from(sitesTableBody.querySelectorAll('tr'))) {
      const fields = [1, 2, 3].map((column) => row.querySelector(`td:nth-child(${column}) input`)?.value || '');
      const text = fields.join(' ').toLowerCase();
      row.style.display = terms.every((term) => text.includes(term) || fields.some((field) => pinyinContains(field, term))) ? '' : 'none';
    }
  }

  function cycleSelectedModes() {
    for (const row of Array.from(sitesTableBody?.querySelectorAll('tr.selected') || [])) {
      const input = row.querySelector('td:nth-child(5) input');
      if (input) setModeControl(input, (Number(input.getAttribute('data-state')) + 1) % 3);
    }
  }

  function toggleSelectedContextMenus() {
    for (const row of Array.from(sitesTableBody?.querySelectorAll('tr.selected') || [])) {
      const input = row.querySelector('td:nth-child(4) input');
      if (input) {
        input.checked = !input.checked;
        input.setAttribute('data-checked', input.checked ? '1' : '0');
      }
    }
  }

  function downloadJson(value, filename) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importSiteConfigFile(file) {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed.siteUrls !== 'object' || !Array.isArray(parsed.buttonConfig)) {
      throw new Error('文件不包含完整的网站配置');
    }
    currentSiteConfig = normalizeSiteConfig(parsed);
    renderSiteTable(currentSiteConfig);
    // 导入文件中的桌面/手机状态就是本次用户选择；按首行归一同域冲突，
    // 再把结果写入实际 UA 规则，同时保留规则中的其他字段。
    await applyDomainRulesFromSites({ preferCurrent: false });
    currentSiteConfig = await writeSiteConfig(configFromTable());
    await publishSiteConfigChanged();
  }

  function restoreColumnWidths() {
    if (!sitesTable) return;
    try {
      const widths = JSON.parse(localStorage.getItem(COLUMN_WIDTHS_KEY) || '[]');
      const headers = Array.from(sitesTable.querySelectorAll('th'));
      widths.forEach((width, index) => {
        if (headers[index] && Number(width) > 0) headers[index].style.width = `${Number(width)}px`;
      });
    } catch (error) { console.warn('列宽配置无法读取', error); }
  }

  function saveColumnWidths() {
    const widths = Array.from(sitesTable?.querySelectorAll('th') || []).map((header) => Math.round(header.getBoundingClientRect().width));
    localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(widths));
  }

  function bindColumnResizers() {
    for (const resizer of Array.from(sitesTable?.querySelectorAll('.column-resizer') || [])) {
      resizer.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const header = resizer.parentNode;
        const startX = event.clientX;
        const startWidth = header.getBoundingClientRect().width;
        const move = (moveEvent) => { header.style.width = `${Math.max(40, startWidth + moveEvent.clientX - startX)}px`; };
        const stop = () => {
          document.removeEventListener?.('mousemove', move);
          document.removeEventListener?.('mouseup', stop);
          saveColumnWidths();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', stop);
      });
    }
  }

  function keyboardFocusables() {
    const items = settingsSearch ? [settingsSearch] : [];
    for (const id of ['add-site-row', 'delete-selected-rows', 'toggle-context', 'toggle-require', 'save-settings', 'export-config', 'import-config']) {
      if (byId(id)) items.push(byId(id));
    }
    items.push(...Array.from(sitesTableBody?.querySelectorAll('input') || []));
    items.push(...Array.from(sitesTableBody?.querySelectorAll('button') || []));
    return items.filter((item) => item.style.display !== 'none' && !item.disabled);
  }

  function moveKeyboardFocus(step) {
    const items = keyboardFocusables();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);
    items[current < 0 ? 0 : (current + step + items.length) % items.length].focus();
  }

  function modalFocusables() {
    return [ruleDomain, ruleUaMode, rulePreset, ruleCustomUA, ruleUiTransform, btnModalCancel, btnModalSave]
      .filter((item) => item && !item.disabled);
  }

  function trapModalTab(event) {
    if (!ruleModal || ruleModal.style.display !== 'flex' || event.key !== 'Tab') return false;
    const items = modalFocusables();
    if (!items.length) return true;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!ruleModal.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
    return true;
  }

  function isTextEditingControl(element) {
    if (!element) return false;
    if (element.tagName === 'TEXTAREA') return true;
    if (element.tagName !== 'INPUT') return false;
    return !element.type || ['text', 'search', 'url', 'email', 'tel', 'password', 'number'].includes(element.type);
  }

  function horizontalArrowStaysInTextField(element, key) {
    if (!isTextEditingControl(element) || (key !== 'ArrowLeft' && key !== 'ArrowRight')) return false;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (!Number.isInteger(start) || !Number.isInteger(end)) return true;
    if (key === 'ArrowLeft') return start > 0 || end > start;
    return end < String(element.value || '').length || end > start;
  }

  function handleSettingsKeydown(event) {
    const key = event.key;
    if (trapModalTab(event)) return;
    if (key === 'F8') { event.preventDefault(); settingsSearch?.focus(); return; }
    if (key === 'Escape') {
      if (ruleModal && ruleModal.style.display === 'flex') closeModal();
      else if (settingsSearch?.value) {
        settingsSearch.value = '';
        applySettingsFilter();
        settingsSearch.focus();
      } else for (const row of Array.from(sitesTableBody?.querySelectorAll('tr.selected') || [])) row.classList.remove('selected');
      return;
    }
    if (key === 'Enter' && ruleModal?.style.display !== 'flex') {
      event.preventDefault();
      saveSiteSettings().catch((error) => showToast('保存失败: ' + error.message));
      return;
    }
    const active = document.activeElement;
    if (horizontalArrowStaysInTextField(active, key)) return;
    if (key === 'ArrowDown' || key === 'ArrowRight' || (key === 'Tab' && !event.shiftKey)) {
      event.preventDefault(); moveKeyboardFocus(1); return;
    }
    if (key === 'ArrowUp' || key === 'ArrowLeft' || (key === 'Tab' && event.shiftKey)) {
      event.preventDefault(); moveKeyboardFocus(-1); return;
    }
    if (key === 'Backspace' && document.activeElement === settingsSearch) {
      event.preventDefault(); settingsSearch.value = settingsSearch.value.slice(0, -1); applySettingsFilter(); return;
    }
    if (key?.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const editing = active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
      if (!editing || active === settingsSearch) {
        event.preventDefault();
        if (settingsSearch) { settingsSearch.value += key; settingsSearch.focus(); applySettingsFilter(); }
      }
    }
  }

  function renderUaTable(rules) {
    if (!rulesTableBody) return;
    rulesTableBody.innerHTML = '';
    for (const [domain, rule] of Object.entries(rules || {})) {
      const row = document.createElement('tr');
      const modeTag = rule.uaMode === 'desktop' ? 'desktop' : rule.uaMode === 'mobile' ? 'mobile' : 'custom';
      const modeText = rule.uaMode === 'desktop' ? '桌面' : rule.uaMode === 'mobile' ? '手机' : '自定义';
      const presetText = rule.uaMode === 'custom' ? '—' : (rule.presetKey || '—').replace(/_/g, ' ');
      row.innerHTML = `<td><strong>${escapeHtml(domain)}</strong></td><td><span class="ua-mode-tag ${modeTag}">${modeText}</span></td><td>${escapeHtml(presetText)}</td><td>${rule.uiTransform ? '是' : '—'}</td><td class="rule-enabled-cell"></td><td><button class="btn-icon" data-action="edit" data-domain="${escapeHtml(domain)}" title="编辑">编辑</button><button class="btn-icon delete" data-action="delete" data-domain="${escapeHtml(domain)}" title="删除">删除</button></td>`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'two-state-checkbox';
      checkbox.checked = !!rule.enabled;
      checkbox.dataset.domain = domain;
      checkbox.setAttribute('aria-label', '启用 UA 规则');
      row.querySelector('.rule-enabled-cell')?.appendChild(checkbox);
      checkbox.addEventListener('change', async () => {
        currentUaRules[domain] = { ...currentUaRules[domain], enabled: checkbox.checked };
        await sendMessage({ type: 'UPDATE_RULE', domain, rule: { enabled: checkbox.checked } });
        showToast(checkbox.checked ? '已启用' : '已禁用');
      });
      for (const button of Array.from(row.querySelectorAll('.btn-icon'))) {
        button.addEventListener('click', () => {
          if (button.dataset.action === 'edit') openEditModal(button.dataset.domain, currentUaRules[button.dataset.domain]);
          else deleteRule(button.dataset.domain);
        });
      }
      rulesTableBody.appendChild(row);
    }
  }

  function openAddModal() {
    editingDomain = null;
    modalTitle.textContent = '添加 UA 规则';
    ruleDomain.value = '';
    ruleDomain.disabled = false;
    ruleUaMode.value = 'desktop';
    ruleUiTransform.checked = false;
    ruleCustomUA.value = '';
    updatePresetOptions(); updateModeVisibility();
    ruleModal.style.display = 'flex';
  }
  function openEditModal(domain, rule = {}) {
    editingDomain = domain;
    modalTitle.textContent = '编辑 UA 规则';
    ruleDomain.value = domain;
    ruleDomain.disabled = true;
    ruleUaMode.value = rule.uaMode || 'desktop';
    ruleUiTransform.checked = !!rule.uiTransform;
    ruleCustomUA.value = rule.customUA || '';
    updatePresetOptions();
    rulePreset.value = rule.presetKey || 'chrome_windows';
    updateModeVisibility();
    ruleModal.style.display = 'flex';
  }
  function closeModal() { if (ruleModal) ruleModal.style.display = 'none'; editingDomain = null; }
  function updatePresetOptions() {
    if (!ruleUaMode || !rulePreset) return;
    rulePreset.innerHTML = '';
    for (const key of Object.keys(UA_PRESETS[ruleUaMode.value] || {})) {
      const option = document.createElement('option');
      option.value = key; option.textContent = key.replace(/_/g, ' '); rulePreset.appendChild(option);
    }
  }
  function updateModeVisibility() {
    if (presetGroup) presetGroup.style.display = ruleUaMode.value !== 'custom' ? 'block' : 'none';
    if (customUaGroup) customUaGroup.style.display = ruleUaMode.value === 'custom' ? 'block' : 'none';
  }
  async function deleteRule(domain) {
    if (!confirm(`确定删除 ${domain} 的规则？`)) return;
    await sendMessage({ type: 'DELETE_RULE', domain });
    delete currentUaRules[domain]; renderUaTable(currentUaRules); showToast('规则已删除');
  }
  function sendMessage(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, (response) => resolve(response)));
  }
  function escapeHtml(value) {
    const container = document.createElement('div'); container.textContent = String(value || ''); return container.innerHTML;
  }
  function showToast(message) {
    document.querySelector('.toast')?.remove();
    const toast = document.createElement('div'); toast.className = 'toast'; toast.textContent = message; document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  settingsSearch.addEventListener('input', applySettingsFilter);
  addSiteRow.addEventListener('click', () => sitesTableBody.appendChild(createSiteRow({ flags: { mode: SITE_MODES.NO_BLANK, desktopMode: true } })));
  deleteSelectedRows.addEventListener('click', () => {
    for (const row of Array.from(sitesTableBody?.querySelectorAll('tr.selected') || [])) row.remove();
  });
  toggleContext.addEventListener('click', toggleSelectedContextMenus);
  toggleRequire.addEventListener('click', cycleSelectedModes);
  saveSettings.addEventListener('click', () => saveSiteSettings().catch((error) => showToast('保存失败: ' + error.message)));
  exportConfig.addEventListener('click', () => downloadJson(configFromTable(), 'SiteUrls.json'));
  importConfig.addEventListener('click', () => configFileInput.click());
  configFileInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await importSiteConfigFile(file); showToast('网站配置导入成功'); }
    catch (error) { showToast('导入失败: ' + error.message); }
    configFileInput.value = '';
  });
  document.addEventListener('keydown', handleSettingsKeydown);
  globalToggle?.addEventListener('change', async () => {
    await sendMessage({ type: 'TOGGLE_GLOBAL', enabled: globalToggle.checked });
    showToast(globalToggle.checked ? '全局已启用' : '全局已禁用');
  });
  ruleUaMode?.addEventListener('change', () => { updatePresetOptions(); updateModeVisibility(); });
  btnModalCancel?.addEventListener('click', closeModal);
  ruleModal?.addEventListener('click', (event) => { if (event.target === ruleModal) closeModal(); });
  btnAddRule?.addEventListener('click', openAddModal);
  btnModalSave?.addEventListener('click', async () => {
    const domain = ruleDomain.value.trim();
    if (!domain) { showToast('请输入域名'); return; }
    const previous = currentUaRules[domain] || {};
    const rule = {
      ...previous,
      enabled: Object.prototype.hasOwnProperty.call(previous, 'enabled') ? previous.enabled : true,
      uaMode: ruleUaMode.value,
      presetKey: ruleUaMode.value !== 'custom' ? rulePreset.value : null,
      customUA: ruleUaMode.value === 'custom' ? ruleCustomUA.value.trim() : null,
      uiTransform: ruleUiTransform.checked,
    };
    currentUaRules[domain] = rule;
    await sendMessage({ type: 'UPDATE_RULE', domain, rule });
    const wasEditing = !!editingDomain;
    closeModal(); renderUaTable(currentUaRules); syncSiteRowsFromUaRules();
    showToast(wasEditing ? '规则已更新' : '规则已添加');
  });
  btnResetRules?.addEventListener('click', async () => {
    if (!confirm('确定重置所有规则为默认值？')) return;
    await sendMessage({ type: 'RESET_RULES' }); showToast('已重置为默认规则'); await initUaSettings();
  });
  btnImportFile?.addEventListener('click', () => fileImport?.click());
  fileImport?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await sendMessage({ type: 'IMPORT_RULES', rules: data.uaRules || data });
      showToast('UA 规则导入成功'); await initUaSettings();
    } catch (error) { showToast('导入失败: ' + error.message); }
    fileImport.value = '';
  });
  btnExportFile?.addEventListener('click', async () => {
    const data = await sendMessage({ type: 'EXPORT_RULES' });
    if (data) { downloadJson(data, 'ua-rules.json'); showToast('导出成功'); }
  });
  btnImportMSP?.addEventListener('click', async () => {
    try {
      const rules = normalizedDomainRules({ preferCurrent: false });
      const response = await sendMessage({ type: 'IMPORT_RULES', rules });
      currentUaRules = response?.rules && typeof response.rules === 'object'
        ? response.rules
        : { ...currentUaRules, ...rules };
      renderUaTable(currentUaRules);
      syncSiteRowsFromUaRules();
      showToast('已从导航配置导入 UA 规则');
    } catch (error) {
      showToast('导入失败: ' + error.message);
    }
  });

  Promise.all([initUaSettings(), initSiteSettings()]).catch((error) => {
    console.error('设置页初始化失败', error);
    showToast('设置页加载失败: ' + error.message);
  });
});
