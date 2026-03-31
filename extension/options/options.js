/**
 * MySearchPage UA Controller - Options 页面逻辑
 */

document.addEventListener('DOMContentLoaded', () => {
  const globalToggle = document.getElementById('opt-global-toggle');
  const rulesTableBody = document.getElementById('rules-table-body');
  const btnAddRule = document.getElementById('btn-add-rule');
  const btnResetRules = document.getElementById('btn-reset-rules');
  const btnImportFile = document.getElementById('btn-import-file');
  const btnExportFile = document.getElementById('btn-export-file');
  const btnImportMSP = document.getElementById('btn-import-msp');
  const fileImport = document.getElementById('file-import');

  // 模态框元素
  const ruleModal = document.getElementById('rule-modal');
  const modalTitle = document.getElementById('modal-title');
  const ruleDomain = document.getElementById('rule-domain');
  const ruleUaMode = document.getElementById('rule-ua-mode');
  const rulePreset = document.getElementById('rule-preset');
  const ruleCustomUA = document.getElementById('rule-custom-ua');
  const ruleUiTransform = document.getElementById('rule-ui-transform');
  const presetGroup = document.getElementById('preset-group');
  const customUaGroup = document.getElementById('custom-ua-group');
  const btnModalCancel = document.getElementById('btn-modal-cancel');
  const btnModalSave = document.getElementById('btn-modal-save');

  let editingDomain = null; // null = 新增, string = 编辑

  // ============================================
  // 初始化
  // ============================================

  async function init() {
    const response = await sendMessage({ type: 'GET_STATUS' });
    if (response) {
      globalToggle.checked = response.globalEnabled;
      renderTable(response.rules);
    }
  }

  // ============================================
  // 渲染规则表格
  // ============================================

  function renderTable(rules) {
    rulesTableBody.innerHTML = '';

    for (const [domain, rule] of Object.entries(rules)) {
      const tr = document.createElement('tr');

      const modeTag = rule.uaMode === 'desktop' ? 'desktop' :
                      rule.uaMode === 'mobile' ? 'mobile' : 'custom';
      const modeText = rule.uaMode === 'desktop' ? '🖥️ 桌面' :
                       rule.uaMode === 'mobile' ? '📱 手机' : '✏️ 自定义';

      const presetText = rule.uaMode === 'custom' ? '—' :
                         (rule.presetKey || '—').replace(/_/g, ' ');

      tr.innerHTML = `
        <td><strong>${escapeHtml(domain)}</strong></td>
        <td><span class="ua-mode-tag ${modeTag}">${modeText}</span></td>
        <td>${presetText}</td>
        <td>${rule.uiTransform ? '✅' : '—'}</td>
        <td>
          <label class="toggle-switch">
            <input type="checkbox" ${rule.enabled ? 'checked' : ''} data-domain="${escapeHtml(domain)}">
            <span class="toggle-slider"></span>
          </label>
        </td>
        <td>
          <button class="btn-icon" data-action="edit" data-domain="${escapeHtml(domain)}" title="编辑">✏️</button>
          <button class="btn-icon delete" data-action="delete" data-domain="${escapeHtml(domain)}" title="删除">🗑️</button>
        </td>`;

      // 启用/禁用开关
      const checkbox = tr.querySelector('input[type="checkbox"]');
      checkbox.addEventListener('change', async (e) => {
        await sendMessage({
          type: 'UPDATE_RULE',
          domain: e.target.dataset.domain,
          rule: { enabled: e.target.checked },
        });
        showToast(e.target.checked ? '已启用' : '已禁用');
      });

      // 编辑/删除按钮
      tr.querySelectorAll('.btn-icon').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const action = e.currentTarget.dataset.action;
          const domain = e.currentTarget.dataset.domain;
          if (action === 'edit') {
            openEditModal(domain, rules[domain]);
          } else if (action === 'delete') {
            deleteRule(domain);
          }
        });
      });

      rulesTableBody.appendChild(tr);
    }
  }

  // ============================================
  // 全局开关
  // ============================================

  globalToggle.addEventListener('change', async () => {
    await sendMessage({ type: 'TOGGLE_GLOBAL', enabled: globalToggle.checked });
    showToast(globalToggle.checked ? '全局已启用' : '全局已禁用');
  });

  // ============================================
  // 模态框：添加/编辑规则
  // ============================================

  function openAddModal() {
    editingDomain = null;
    modalTitle.textContent = '添加 UA 规则';
    ruleDomain.value = '';
    ruleDomain.disabled = false;
    ruleUaMode.value = 'desktop';
    ruleUiTransform.checked = false;
    ruleCustomUA.value = '';
    updatePresetOptions();
    updateModeVisibility();
    ruleModal.style.display = 'flex';
  }

  function openEditModal(domain, rule) {
    editingDomain = domain;
    modalTitle.textContent = '编辑 UA 规则';
    ruleDomain.value = domain;
    ruleDomain.disabled = true; // 编辑时不能改域名
    ruleUaMode.value = rule.uaMode || 'desktop';
    ruleUiTransform.checked = !!rule.uiTransform;
    ruleCustomUA.value = rule.customUA || '';
    updatePresetOptions();
    rulePreset.value = rule.presetKey || 'chrome_windows';
    updateModeVisibility();
    ruleModal.style.display = 'flex';
  }

  function closeModal() {
    ruleModal.style.display = 'none';
    editingDomain = null;
  }

  function updatePresetOptions() {
    const mode = ruleUaMode.value;
    const presets = UA_PRESETS[mode] || {};
    rulePreset.innerHTML = '';
    for (const [key, value] of Object.entries(presets)) {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = key.replace(/_/g, ' ');
      rulePreset.appendChild(option);
    }
  }

  function updateModeVisibility() {
    const mode = ruleUaMode.value;
    presetGroup.style.display = mode !== 'custom' ? 'block' : 'none';
    customUaGroup.style.display = mode === 'custom' ? 'block' : 'none';
  }

  ruleUaMode.addEventListener('change', () => {
    updatePresetOptions();
    updateModeVisibility();
  });

  btnModalCancel.addEventListener('click', closeModal);

  btnModalSave.addEventListener('click', async () => {
    const domain = ruleDomain.value.trim();
    if (!domain) {
      showToast('请输入域名');
      return;
    }

    const rule = {
      enabled: true,
      uaMode: ruleUaMode.value,
      presetKey: ruleUaMode.value !== 'custom' ? rulePreset.value : null,
      customUA: ruleUaMode.value === 'custom' ? ruleCustomUA.value.trim() : null,
      uiTransform: ruleUiTransform.checked,
    };

    await sendMessage({ type: 'UPDATE_RULE', domain, rule });
    closeModal();
    showToast(editingDomain ? '规则已更新' : '规则已添加');
    init();
  });

  // 点击遮罩关闭
  ruleModal.addEventListener('click', (e) => {
    if (e.target === ruleModal) closeModal();
  });

  btnAddRule.addEventListener('click', openAddModal);

  // ============================================
  // 删除规则
  // ============================================

  async function deleteRule(domain) {
    if (!confirm(`确定删除 ${domain} 的规则？`)) return;
    await sendMessage({ type: 'DELETE_RULE', domain });
    showToast('规则已删除');
    init();
  }

  // ============================================
  // 重置默认
  // ============================================

  btnResetRules.addEventListener('click', async () => {
    if (!confirm('确定重置所有规则为默认值？')) return;
    await sendMessage({ type: 'RESET_RULES' });
    showToast('已重置为默认规则');
    init();
  });

  // ============================================
  // 导入/导出
  // ============================================

  btnImportFile.addEventListener('click', () => {
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

  btnExportFile.addEventListener('click', async () => {
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

  btnImportMSP.addEventListener('click', () => {
    // 提示用户从 MySearchPage 导出配置
    alert(
      '请按以下步骤操作：\n\n' +
      '1. 打开 MySearchPage 页面\n' +
      '2. 点击设置 → 导出 UA 规则\n' +
      '3. 保存 JSON 文件\n' +
      '4. 使用上方的"从文件导入"按钮导入该文件'
    );
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
