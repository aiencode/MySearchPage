/**
 * MySearchPage UA Controller - DOM 重排引擎（通用）
 * 
 * 职责：
 * 1. 提供通用的 DOM 重排框架
 * 2. MutationObserver 持续监控
 * 3. SPA 路由切换检测
 */

const UITransformer = {
  _observer: null,
  _rules: null,
  _applied: new WeakSet(),
  _initialized: false,

  /**
   * 初始化重排引擎
   * @param {object} rules - 重排规则（由各站点脚本提供）
   */
  init(rules) {
    if (this._initialized) return;
    this._rules = rules;
    this._initialized = true;

    console.log('[UI Transformer] 初始化，站点:', rules.siteName);

    // document_start 时 DOM 还没就绪，等待 DOMContentLoaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this._onReady());
    } else {
      this._onReady();
    }
  },

  /**
   * DOM 就绪后执行
   */
  _onReady() {
    // 设置 viewport
    this._setViewport();

    // 应用全局样式
    this._applyGlobalStyles();

    // 执行初始重排
    this._applyAll();

    // 启动 MutationObserver
    this._startObserver();

    // 监听 SPA 路由变化
    this._watchSPARouting();

    console.log('[UI Transformer] 重排完成');
  },

  /**
   * 设置 viewport meta 标签
   */
  _setViewport() {
    if (!this._rules.viewport) return;

    // 移除现有 viewport
    const existing = document.querySelector('meta[name="viewport"]');
    if (existing) existing.remove();

    // 创建新的 viewport
    const meta = document.createElement('meta');
    meta.name = 'viewport';
    meta.content = Object.entries(this._rules.viewport)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    document.head.appendChild(meta);
  },

  /**
   * 应用全局样式
   */
  _applyGlobalStyles() {
    if (!this._rules.globalStyles) return;

    const style = document.createElement('style');
    style.setAttribute('data-ua-controller', 'global');
    let css = '';
    for (const [selector, props] of Object.entries(this._rules.globalStyles)) {
      const propsStr = Object.entries(props)
        .map(([key, value]) => {
          // 驼峰转 kebab-case
          const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
          return `${cssKey}: ${value} !important;`;
        })
        .join(' ');
      css += `${selector} { ${propsStr} }\n`;
    }
    style.textContent = css;
    document.head.appendChild(style);
  },

  /**
   * 执行所有重排规则
   */
  _applyAll() {
    // 隐藏元素
    if (this._rules.hide) {
      for (const selector of this._rules.hide) {
        this._hideElements(selector);
      }
    }

    // 布局调整
    if (this._rules.layout) {
      for (const rule of this._rules.layout) {
        this._applyLayout(rule);
      }
    }

    // 自定义处理
    if (this._rules.customTransform) {
      this._rules.customTransform();
    }
  },

  /**
   * 隐藏匹配的元素
   * @param {string} selector - CSS 选择器
   */
  _hideElements(selector) {
    try {
      const elements = document.querySelectorAll(selector);
      elements.forEach((el) => {
        if (!this._applied.has(el)) {
          el.style.setProperty('display', 'none', 'important');
          this._applied.add(el);
        }
      });
    } catch (e) {
      // 选择器可能无效，静默忽略
    }
  },

  /**
   * 应用布局规则
   * @param {object} rule - { selector, styles }
   */
  _applyLayout(rule) {
    try {
      const elements = document.querySelectorAll(rule.selector);
      elements.forEach((el) => {
        if (!this._applied.has(el)) {
          for (const [key, value] of Object.entries(rule.styles)) {
            el.style.setProperty(key, value, 'important');
          }
          this._applied.add(el);
        }
      });
    } catch (e) {
      // 选择器可能无效，静默忽略
    }
  },

  /**
   * 启动 MutationObserver
   */
  _startObserver() {
    if (this._observer) return;

    this._observer = new MutationObserver((mutations) => {
      let hasNewNodes = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          hasNewNodes = true;
          break;
        }
      }
      if (hasNewNodes) {
        // 防抖：避免频繁重排
        this._debounceApply();
      }
    });

    this._observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  },

  _debounceTimer: null,

  /**
   * 防抖重排
   */
  _debounceApply() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._applyAll();
    }, 300);
  },

  /**
   * 监听 SPA 路由变化
   */
  _watchSPARouting() {
    // 拦截 pushState
    const originalPushState = history.pushState;
    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this._onRouteChange();
    };

    // 拦截 replaceState
    const originalReplaceState = history.replaceState;
    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      this._onRouteChange();
    };

    // 监听 popstate（浏览器前进/后退）
    window.addEventListener('popstate', () => {
      this._onRouteChange();
    });
  },

  _routeChangeTimer: null,

  /**
   * 路由变化回调
   */
  _onRouteChange() {
    if (this._routeChangeTimer) clearTimeout(this._routeChangeTimer);
    this._routeChangeTimer = setTimeout(() => {
      console.log('[UI Transformer] 路由变化，重新重排');
      this._applied = new WeakSet(); // 重置已应用记录
      this._applyAll();
    }, 500);
  },

  /**
   * 销毁
   */
  destroy() {
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._initialized = false;
  },
};
