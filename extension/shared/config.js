/**
 * MySearchPage UA Controller - 配置管理模块
 * 负责 chrome.storage.local 的读写操作
 */

const ConfigManager = {
  /**
   * 获取所有 UA 规则
   * @returns {Promise<object>}
   */
  async getUARules() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.UA_RULES);
    return data[STORAGE_KEYS.UA_RULES] || DEFAULT_UA_RULES;
  },

  /**
   * 保存 UA 规则
   * @param {object} rules - UA 规则对象
   * @returns {Promise<void>}
   */
  async saveUARules(rules) {
    await chrome.storage.local.set({ [STORAGE_KEYS.UA_RULES]: rules });
  },

  /**
   * 获取单个域名的规则
   * @param {string} domain - 域名
   * @returns {Promise<object|null>}
   */
  async getRuleForDomain(domain) {
    const rules = await this.getUARules();
    return rules[domain] || null;
  },

  /**
   * 更新单个域名的规则
   * @param {string} domain - 域名
   * @param {object} rule - 规则对象
   * @returns {Promise<void>}
   */
  async updateRule(domain, rule) {
    const rules = await this.getUARules();
    rules[domain] = { ...(rules[domain] || {}), ...rule };
    await this.saveUARules(rules);
  },

  /**
   * 删除单个域名的规则
   * @param {string} domain - 域名
   * @returns {Promise<void>}
   */
  async deleteRule(domain) {
    const rules = await this.getUARules();
    delete rules[domain];
    await this.saveUARules(rules);
  },

  /**
   * 获取全局启用状态
   * @returns {Promise<boolean>}
   */
  async getGlobalEnabled() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.GLOBAL_ENABLED);
    return data[STORAGE_KEYS.GLOBAL_ENABLED] !== false; // 默认 true
  },

  /**
   * 设置全局启用状态
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async setGlobalEnabled(enabled) {
    await chrome.storage.local.set({ [STORAGE_KEYS.GLOBAL_ENABLED]: enabled });
  },

  /**
   * 从 JSON 对象导入规则（合并模式）
   * @param {object} importData - 导入的数据
   * @returns {Promise<object>} 合并后的规则
   */
  async importRules(importData) {
    const currentRules = await this.getUARules();
    const newRules = importData.uaRules || importData;
    const merged = deepMerge(currentRules, newRules);
    await this.saveUARules(merged);
    return merged;
  },

  /**
   * 导出规则为 JSON 对象
   * @returns {Promise<object>}
   */
  async exportRules() {
    const rules = await this.getUARules();
    const globalEnabled = await this.getGlobalEnabled();
    return {
      version: '1.0.0',
      exportTime: new Date().toISOString(),
      globalEnabled,
      uaRules: rules,
    };
  },

  /**
   * 重置为默认规则
   * @returns {Promise<void>}
   */
  async resetToDefaults() {
    await this.saveUARules({ ...DEFAULT_UA_RULES });
    await this.setGlobalEnabled(true);
  },
};
