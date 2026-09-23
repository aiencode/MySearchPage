(function () {
  'use strict';

  const rulesApi = globalThis.MySearchBlockingRules;
  const periods = document.getElementById('blocking-stats-periods');
  const feedback = document.getElementById('blocking-feedback-stats');
  const status = document.getElementById('blocking-dashboard-status');
  const refreshButton = document.getElementById('blocking-stats-refresh');
  const importButton = document.getElementById('blocking-policy-import');
  const exportButton = document.getElementById('blocking-policy-export');
  const policyFile = document.getElementById('blocking-policy-file');
  const reconnectButton = document.getElementById('search-media-reconnect');
  const diagnosticsButton =
    document.getElementById('search-media-diagnostics');
  const keywordInput =
    document.getElementById('blocking-keywords-batch');
  const keywordAddButton =
    document.getElementById('blocking-keywords-add');
  const urlInput = document.getElementById('blocking-urls-batch');
  const urlAddButton = document.getElementById('blocking-urls-add');
  const authorInput = document.getElementById('blocking-authors-batch');
  const authorAddButton = document.getElementById('blocking-authors-add');
  const keywordCount =
    document.getElementById('blocking-keyword-count');
  const keywordList =
    document.getElementById('blocking-keyword-list');
  const urlCount = document.getElementById('blocking-url-count');
  const urlList = document.getElementById('blocking-url-list');
  const authorCount = document.getElementById('blocking-author-count');
  const authorList = document.getElementById('blocking-author-list');
  if (
    !periods ||
    !feedback ||
    !status ||
    !keywordInput ||
    !keywordAddButton ||
    !keywordCount ||
    !keywordList ||
    !urlInput ||
    !urlAddButton ||
    !authorInput ||
    !authorAddButton ||
    !urlCount ||
    !urlList ||
    !authorCount ||
    !authorList ||
    !rulesApi
  ) return;

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        if (!response?.success) {
          const error = new Error(response?.error || '操作失败');
          error.response = response || null;
          reject(error);
          return;
        }
        resolve(response);
      });
    });
  }

  async function getBlockingRules() {
    try {
      return await sendMessage({ type: 'GET_BLOCKING_RULES' });
    } catch (error) {
      if (!rulesApi.isUnknownMessageResponse(
        error.response,
        'GET_BLOCKING_RULES'
      )) {
        throw error;
      }
      return {
        success: true,
        rules: await rulesApi.getRulesFromStorage(),
      };
    }
  }

  async function importBlockingPolicy(policy) {
    try {
      return await sendMessage({
        type: 'IMPORT_BLOCKING_POLICY',
        policy,
      });
    } catch (error) {
      if (!rulesApi.isUnknownMessageResponse(
        error.response,
        'IMPORT_BLOCKING_POLICY'
      )) {
        throw error;
      }
      return {
        success: true,
        rules: await rulesApi.importPolicyToStorage(policy),
      };
    }
  }

  async function replaceBlockingRules(rules) {
    try {
      return await sendMessage({
        type: 'UPDATE_BLOCKING_RULES',
        rules: { schemaVersion: 1, ...rules },
      });
    } catch (error) {
      if (!rulesApi.isUnknownMessageResponse(
        error.response,
        'UPDATE_BLOCKING_RULES'
      )) {
        throw error;
      }
      return {
        success: true,
        rules: await rulesApi.replaceRulesInStorage(rules),
      };
    }
  }

  function appendCell(row, value) {
    const cell = document.createElement('td');
    cell.textContent = String(value);
    row.appendChild(cell);
  }

  function percent(value) {
    return `${(Number(value || 0) * 100).toFixed(1)}%`;
  }

  function parseBlockingKeywordBatch(value) {
    return Array.from(new Set(
      String(value || '')
        .split(/\r?\n/)
        .map(item => item.trim())
        .filter(Boolean)
    ));
  }

  function renderRuleList(list, count, values, emptyLabel, field) {
    const items = Array.isArray(values) ? values : [];
    count.textContent = `${emptyLabel}（${items.length}）`;
    list.textContent = '';
    for (const value of items) {
      const item = document.createElement('li');
      const input = document.createElement('input');
      input.className = 'blocking-rule-value';
      input.type = 'text';
      input.value = value;
      input.setAttribute('aria-label', `${emptyLabel}：${value}`);
      const actions = document.createElement('span');
      actions.className = 'blocking-rule-actions';
      const save = document.createElement('button');
      save.type = 'button';
      save.textContent = '保存';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '删除';
      save.addEventListener('click', async () => {
        const nextValue = input.value.trim();
        if (!nextValue) {
          status.textContent = `${emptyLabel}不能为空`;
          input.focus();
          return;
        }
        try {
          const response = await getBlockingRules();
          const next = { ...response.rules };
          next[field] = Array.from(new Set(
            (next[field] || []).map(item => item === value ? nextValue : item)
          ));
          const saved = await replaceBlockingRules(next);
          renderBlockingRuleSets(saved.rules);
          status.textContent = `${emptyLabel}已保存`;
        } catch (error) {
          status.textContent = `${emptyLabel}保存失败：${error.message}`;
        }
      });
      remove.addEventListener('click', async () => {
        try {
          const response = await getBlockingRules();
          const next = { ...response.rules };
          next[field] = (next[field] || []).filter(item => item !== value);
          const saved = await replaceBlockingRules(next);
          renderBlockingRuleSets(saved.rules);
          status.textContent = `${emptyLabel}已删除`;
        } catch (error) {
          status.textContent = `${emptyLabel}删除失败：${error.message}`;
        }
      });
      actions.append(save, remove);
      item.append(input, actions);
      list.appendChild(item);
    }
  }

  function renderBlockingKeywords(rules) {
    renderRuleList(
      keywordList,
      keywordCount,
      rules?.blockedKeywords,
      '全部封禁词',
      'blockedKeywords'
    );
  }

  function renderBlockingRuleSets(rules) {
    renderBlockingKeywords(rules);
    renderRuleList(
      urlList,
      urlCount,
      rules?.blockedUrlPatterns,
      '全部封禁 URL',
      'blockedUrlPatterns'
    );
    renderRuleList(
      authorList,
      authorCount,
      rules?.blockedAuthors,
      '全部封禁作者',
      'blockedAuthors'
    );
  }

  async function refreshBlockingKeywords() {
    const response = await getBlockingRules();
    renderBlockingRuleSets(response.rules);
  }

  function renderStats(stats) {
    periods.textContent = '';
    for (const [key, label] of [
      ['today', '今天'],
      ['last7Days', '近7天'],
      ['last30Days', '近30天'],
    ]) {
      const value = stats?.[key] || {};
      const row = document.createElement('tr');
      appendCell(row, label);
      appendCell(row, value.blockedExposureCount || 0);
      appendCell(row, value.attemptedBlockedClickCount || 0);
      appendCell(row, value.attemptedDepth3Navigation || 0);
      appendCell(row, percent(value.attemptedClickRate));
      periods.appendChild(row);
    }

    feedback.textContent = '';
    const labels = {
      toast: '文字提示',
      beep: '声音提示',
      grayout: '灰度提示',
    };
    const values = stats?.last30Days?.feedbackByType || {};
    for (const type of ['toast', 'beep', 'grayout']) {
      const value = values[type] || {};
      const measured = Number(value.measured || 0);
      const retried = Number(value.retriedWithin10Minutes || 0);
      const row = document.createElement('tr');
      appendCell(row, labels[type]);
      appendCell(row, value.count || 0);
      appendCell(row, measured);
      appendCell(row, retried);
      appendCell(row, percent(measured ? retried / measured : 0));
      feedback.appendChild(row);
    }
  }

  async function refreshStats() {
    refreshButton.disabled = true;
    status.textContent = '正在读取统计';
    try {
      const response = await sendMessage({ type: 'GET_BLOCKING_STATS' });
      renderStats(response.stats);
      status.textContent = '统计已更新';
    } catch (error) {
      status.textContent = `统计读取失败：${error.message}`;
    } finally {
      refreshButton.disabled = false;
    }
  }

  function downloadJson(value, filename) {
    const blob = new Blob(
      [JSON.stringify(value, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  refreshButton.addEventListener('click', refreshStats);
  importButton.addEventListener('click', () => policyFile.click());

  async function appendRules(input, button, field, label) {
    const values = parseBlockingKeywordBatch(input.value);
    if (!values.length) {
      status.textContent = `请至少输入一个${label}`;
      input.focus();
      return;
    }
    button.disabled = true;
    status.textContent = `正在追加${label}`;
    try {
      const response = await importBlockingPolicy({
        schemaVersion: 1,
        [field]: values,
      });
      renderBlockingRuleSets(response.rules);
      input.value = '';
      status.textContent = `已追加 ${values.length} 个${label}；原有规则未删除`;
    } catch (error) {
      status.textContent = `${label}追加失败：${error.message}`;
    } finally {
      button.disabled = false;
    }
  }

  keywordAddButton.addEventListener('click', () => appendRules(
    keywordInput,
    keywordAddButton,
    'blockedKeywords',
    '封禁词'
  ));
  urlAddButton.addEventListener('click', () => appendRules(
    urlInput,
    urlAddButton,
    'blockedUrlPatterns',
    '封禁 URL'
  ));
  authorAddButton.addEventListener('click', () => appendRules(
    authorInput,
    authorAddButton,
    'blockedAuthors',
    '封禁作者'
  ));

  policyFile.addEventListener('change', async () => {
    const file = policyFile.files?.[0];
    if (!file) return;
    status.textContent = '正在追加策略';
    try {
      const policy = JSON.parse(await file.text());
      const response = await importBlockingPolicy(policy);
      renderBlockingRuleSets(response.rules);
      status.textContent = '策略已追加；原有规则未删除';
    } catch (error) {
      status.textContent = `策略导入失败：${error.message}`;
    } finally {
      policyFile.value = '';
    }
  });

  exportButton.addEventListener('click', async () => {
    status.textContent = '正在导出策略';
    try {
      const response = await sendMessage({
        type: 'EXPORT_BLOCKING_POLICY',
      });
      downloadJson(response.policy, 'mysearch-blocking-policy.json');
      status.textContent = '策略已导出';
    } catch (error) {
      status.textContent = `策略导出失败：${error.message}`;
    }
  });

  reconnectButton.addEventListener('click', async () => {
    reconnectButton.disabled = true;
    status.textContent = '正在重新连接旧标签';
    try {
      const response = await sendMessage({
        type: 'RECONNECT_SEARCH_MEDIA_TABS',
      });
      status.textContent =
        `已连接 ${response.connected}/${response.attempted} 个标签`;
    } catch (error) {
      status.textContent = `旧标签连接失败：${error.message}`;
    } finally {
      reconnectButton.disabled = false;
    }
  });

  diagnosticsButton.addEventListener('click', () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL(
        'diagnostics/search-media-probe.html'
      ),
    });
  });

  void refreshStats();
  void refreshBlockingKeywords().catch(error => {
    status.textContent = `封禁词读取失败：${error.message}`;
  });
})();
