/**
 * MySearchPage UA Controller - B站 DOM 重排规则
 * 
 * 目标：在桌面UA下，将B站桌面版页面重排为手机风格布局
 * 
 * B站桌面版核心结构：
 * - 顶部导航栏（.bili-header__bar）
 * - 左侧侧边栏
 * - 中间主内容区
 * - 右侧推荐栏
 */

(function () {
  'use strict';

  const BILIBILI_RULES = {
    siteName: 'Bilibili',
    mobileStylesheet: 'content/styles/bilibili-mobile.css',

    // Viewport 设置
    viewport: {
      width: 'device-width',
      'initial-scale': '1.0',
      'maximum-scale': '2.0',
      'user-scalable': 'yes',
    },

    // 需要隐藏的元素
    hide: [
      // 顶部导航栏（桌面版特有的大导航）
      '.bili-header__bar',
      // 右侧推荐/热门栏
      '[class*="right-section"]',
      '[class*="right-container"]',
      // 侧边栏
      '[class*="sidebar"]',
      // 广告
      '[class*="ad-"]',
      '[class*="banner"]',
      // 桌面版特有的底部信息
      '.link-footer-ctnr',
    ],

    // 布局调整
    layout: [
      {
        selector: '#app',
        styles: {
          width: '100%',
          'max-width': '100%',
          margin: '0',
          padding: '0',
        },
      },
      {
        selector: '[class*="main-content"]',
        styles: {
          width: '100%',
          'max-width': '100%',
          margin: '0',
          padding: '8px',
        },
      },
      {
        selector: '[class*="container"]',
        styles: {
          width: '100%',
          'max-width': '100%',
          padding: '0 8px',
        },
      },
      {
        selector: '[class*="video-card"]',
        styles: {
          width: '100%',
          'max-width': '100%',
          'font-size': '16px',
        },
      },
      {
        selector: '[class*="feed-card"]',
        styles: {
          width: '100%',
          'max-width': '100%',
        },
      },
    ],

    // 全局样式
    globalStyles: {
      body: {
        fontSize: '16px',
        lineHeight: '1.6',
        overflowX: 'hidden',
        minWidth: 'auto',
      },
      'a, button, input, [role="button"]': {
        minHeight: '44px',
        minWidth: '44px',
        fontSize: '16px',
      },
      'input, textarea, select': {
        fontSize: '16px !important', // 防止 iOS 缩放
      },
    },

    // 自定义处理函数
    customTransform: function () {
      // 尝试简化顶部导航
      simplifyNavigation();
      // 优化视频卡片布局
      optimizeVideoCards();
    },
  };

  /**
   * 简化顶部导航
   */
  function simplifyNavigation() {
    // 查找导航栏中的搜索框，保留搜索功能
    const searchInput = document.querySelector(
      '[class*="search"] input, [class*="search-input"]'
    );
    if (searchInput) {
      searchInput.style.fontSize = '16px';
      searchInput.style.minHeight = '44px';
    }
  }

  /**
   * 优化视频卡片布局为单列
   */
  function optimizeVideoCards() {
    // 查找视频卡片网格容器
    const grids = document.querySelectorAll(
      '[class*="video-grid"], [class*="feed-grid"], [class*="card-list"]'
    );
    grids.forEach((grid) => {
      grid.style.display = 'flex';
      grid.style.flexDirection = 'column';
      grid.style.gap = '12px';
      grid.style.padding = '0 4px';
    });
  }

  async function initializeWhenEnabled() {
    if (typeof UITransformer === 'undefined') {
      console.warn('[Bilibili] UITransformer 未加载');
      return;
    }

    try {
      const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      const rule = status && status.rules && status.rules['bilibili.com'];
      if (!status || status.globalEnabled !== true || !rule || rule.enabled !== true || rule.uiTransform !== true) {
        return;
      }

      UITransformer.init(BILIBILI_RULES);
    } catch (e) {
      console.warn('[Bilibili] 无法获取重排状态:', e);
    }
  }

  initializeWhenEnabled();
})();
