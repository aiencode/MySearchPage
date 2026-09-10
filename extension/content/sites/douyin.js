/**
 * MySearchPage UA Controller - 抖音 DOM 重排规则
 * 
 * 目标：在桌面UA下，将抖音桌面版页面重排为手机风格布局
 * 
 * 抖音桌面版特点：
 * - 重度 SPA，DOM 高度动态
 * - 全屏视频播放器布局
 * - 大量使用动态 class 名
 */

(function () {
  'use strict';

  const DOUYIN_RULES = {
    siteName: 'Douyin',
    mobileStylesheet: 'content/styles/douyin-mobile.css',

    // Viewport 设置
    viewport: {
      width: 'device-width',
      'initial-scale': '1.0',
      'maximum-scale': '2.0',
      'user-scalable': 'yes',
    },

    // 需要隐藏的元素
    hide: [
      // 侧边栏导航
      '[class*="side"]',
      '[class*="sidebar"]',
      // 右侧推荐/评论面板（桌面版特有）
      '[class*="right-container"]',
      '[class*="right-panel"]',
      // 广告
      '[class*="ad-"]',
      '[class*="advertisement"]',
      // 下载引导
      '[class*="download"]',
      '[class*="guide"]',
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
        selector: '[class*="main"]',
        styles: {
          width: '100%',
          'max-width': '100%',
          margin: '0 auto',
          padding: '8px',
        },
      },
      {
        selector: '[class*="video"]',
        styles: {
          'max-width': '100%',
        },
      },
      {
        selector: '[class*="card"]',
        styles: {
          width: '100%',
          'max-width': '100%',
          'font-size': '16px',
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
        fontSize: '16px !important',
      },
    },

    // 自定义处理函数
    customTransform: function () {
      // 优化搜索结果布局
      optimizeSearchResults();
      // 优化视频播放器
      optimizeVideoPlayer();
    },
  };

  /**
   * 优化搜索结果布局
   */
  function optimizeSearchResults() {
    // 搜索结果卡片改为纵向列表
    const grids = document.querySelectorAll(
      '[class*="grid"], [class*="list"], [class*="result"]'
    );
    grids.forEach((grid) => {
      grid.style.display = 'flex';
      grid.style.flexDirection = 'column';
      grid.style.gap = '12px';
      grid.style.padding = '0 4px';
    });
  }

  /**
   * 优化视频播放器
   */
  function optimizeVideoPlayer() {
    // 让视频播放器适应窄屏
    const players = document.querySelectorAll(
      '[class*="player"], [class*="video-player"]'
    );
    players.forEach((player) => {
      player.style.width = '100%';
      player.style.maxWidth = '100%';
      player.style.height = 'auto';
      player.style.aspectRatio = '9/16';
    });
  }

  async function initializeWhenEnabled() {
    if (typeof UITransformer === 'undefined') {
      console.warn('[Douyin] UITransformer 未加载');
      return;
    }

    try {
      const status = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
      const rule = status && status.rules && status.rules['douyin.com'];
      if (!status || status.globalEnabled !== true || !rule || rule.enabled !== true || rule.uiTransform !== true) {
        return;
      }

      UITransformer.init(DOUYIN_RULES);
    } catch (e) {
      console.warn('[Douyin] 无法获取重排状态:', e);
    }
  }

  initializeWhenEnabled();
})();
