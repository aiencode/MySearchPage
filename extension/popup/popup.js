/**
 * MySearchPage UA Controller - Popup 逻辑
 */

document.addEventListener('DOMContentLoaded', () => {
  const globalToggle = document.getElementById('global-toggle');
  const globalStatus = document.getElementById('global-status');
  const rulesList = document.getElementById('rules-list');
  const btnImport = document.getElementById('btn-import');
  const btnExport = document.getElementById('btn-export');
  const btnSettings = document.getElementById('btn-settings');
  const fileImport = document.getElementById('file-import');

  // ============================================
  // 初始化：加载状态
  // ============================================

  async function init() {
    const response = await sendMessage({ type: 'GET_STATUS' });
    if (response && response.rules) {
      globalToggle.checked = response.globalEnabled;
      updateGlobalStatus(response.globalEnabled);
      renderRules(response.rules);
    }
  }

  // ============================================
  // 渲染规则列表
  // ============================================

  function renderRules(rules) {
    rulesList.innerHTML = '';

    const domains = Object.keys(rules);
    if (domains.length === 0) {
      rulesList.innerHTML = `
        <div class="empty-state">
          <p>暂无 UA 规则</p>
          <p>点击"导入"从 MySearchPage 导入配置</p>
        </div>`;
      return;
    }

    for (const [domain, rule] of Object.entries(rules)) {
      const item = document.createElement('div');
      item.className = 'rule-item' + (rule.enabled ? '' : ' disabled');

      const uaBadgeClass = rule.uaMode === 'custom' ? 'custom' : rule.uaMode;
      const uaBadgeText =
        rule.uaMode === 'desktop' ? '🖥️ 桌面' :
        rule.uaMode === 'mobile' ? '📱 手机' :
        '✏️ 自定义';

      item.innerHTML = `
        <div class="rule-info">
          <div class="rule-domain">${escapeHtml(domain)}</div>
          <div class="rule-meta">
            <span class="ua-badge ${uaBadgeClass}">${uaBadgeText}</span>
            ${rule.uiTransform ? '<span class="transform-badge">🔄 UI重排</span>' : ''}
          </div>
        </div>
        <div class="rule-actions">
          <label class="rule-toggle">
            <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-domain="${escapeHtml(domain)}">
            <span class="toggle-slider"></span>
          </label>
        </div>`;

      // 单条规则开关
      const checkbox = item.querySelector('input[type="checkbox"]');
      checkbox.addEventListener('change', async (e) => {
        const domain = e.target.dataset.domain;
        await sendMessage({
          type: 'UPDATE_RULE',
          domain,
          rule: { enabled: e.target.checked },
        });
        item.classList.toggle('disabled', !e.target.checked);
        showToast(e.target.checked ? '已启用' : '已禁用');
      });

      rulesList.appendChild(item);
    }
  }

  // ============================================
  // 全局开关
  // ============================================

  globalToggle.addEventListener('change', async () => {
    const enabled = globalToggle.checked;
    await sendMessage({ type: 'TOGGLE_GLOBAL', enabled });
    updateGlobalStatus(enabled);
    showToast(enabled ? '全局已启用' : '全局已禁用');
    // 重新渲染列表以更新禁用状态
    init();
  });

  function updateGlobalStatus(enabled) {
    globalStatus.textContent = enabled ? '已启用' : '已禁用';
  }

  // ============================================
  // 导入 / 导出
  // ============================================

  btnImport.addEventListener('click', () => {
    fileImport.click();
  });

  fileImport.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const rules = data.uaRules || data;
      await sendMessage({ type: 'IMPORT_RULES', rules });
      showToast('导入成功');
      init();
    } catch (err) {
      showToast('导入失败: ' + err.message);
    }

    fileImport.value = '';
  });

  btnExport.addEventListener('click', async () => {
    const data = await sendMessage({ type: 'EXPORT_RULES' });
    if (!data) return;

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ua-rules.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('导出成功');
  });

  // ============================================
  // 设置页
  // ============================================

  btnSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // ============================================
  // 工具函数
  // ============================================

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response);
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showToast(message) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 2000);
  }

  // 启动
  init();
});
