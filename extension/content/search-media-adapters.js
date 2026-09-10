/* Search-result media scopes. Keep site selectors separate from reversible DOM changes. */
(function () {
  'use strict';

  const dialog = '[role="dialog"], [aria-modal="true"]';

  globalThis.SearchMediaAdapters = [
    {
      domain: 'bilibili.com',
      isSearch(url) {
        return url.hostname === 'search.bilibili.com' || /^\/search(?:\/|$)/.test(url.pathname);
      },
      roots: '.search-page, .search-content, .search-all-list, .search-result-list, #search-results',
      cards: '.bili-video-card, .video-item, .video-list-item, .bili-user-card, .user-item, .live-user-item, .live-room-item, .bangumi-item, .media-card',
      details: `${dialog}, #video-page, .video-detail-container, .video-container-v1, .bili-video-modal, .video-detail-modal`,
      detailOverlays: '.bili-video-modal, .video-detail-modal',
      boxes: '.bili-video-card__image, .bili-video-card__image--wrap, .bili-video-card__cover, .bili-video-card__avatar, .bili-user-card__avatar, .video-cover, .cover, .pic, .face',
      overlays: '.bili-video-card__mask, .bili-video-card__stats, .bili-video-card__stats--left, .bili-video-card__stats__duration, .duration, .so-imgTag_rb',
      backgrounds: '.bili-video-card__cover, .bili-video-card__image, .video-cover, .cover, .pic, .face',
      previews: '.bili-video-card__preview, .bili-video-card__preview-container',
      layout: [
        { selector: '.bili-video-card__skeleton', emptyOnly: true, styles: { display: 'none' } },
        {
          selector: '.bili-video-card__wrap',
          styles: { position: 'relative', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto', height: 'auto', 'min-height': '0', transform: 'none' },
        },
        {
          selector: '.bili-video-card__stats',
          styles: { 'padding-top': '0', 'padding-right': '0', 'padding-bottom': '0', 'padding-left': '0' },
        },
      ],
      routeEvents: [],
    },
    {
      domain: 'youtube.com',
      isSearch(url) {
        return /^\/(?:results|search)(?:\/|$)/.test(url.pathname);
      },
      roots: 'ytd-search, ytm-search, ytm-search-renderer, #search-results',
      cards: 'ytd-video-renderer, ytd-grid-video-renderer, ytd-channel-renderer, ytd-playlist-renderer, ytd-radio-renderer, ytd-reel-item-renderer, ytd-rich-item-renderer, ytm-video-with-context-renderer, ytm-compact-video-renderer, ytm-video-card-renderer, ytm-channel-list-item-renderer, ytm-playlist-card-renderer, ytm-media-item, ytm-shorts-lockup-view-model, yt-lockup-view-model, yt-shorts-lockup-view-model',
      details: `${dialog}, ytd-watch-flexy, ytd-watch-grid, ytm-watch, ytm-watch-page, ytm-player-page, ytd-reel-video-renderer`,
      boxes: 'ytd-thumbnail, yt-thumbnail-view-model, ytm-thumbnail-cover, .media-item-thumbnail-container, .video-thumbnail-container-compact, .video-thumbnail-container-large, .video-thumbnail-bg, .yt-lockup-view-model__content-image, #thumbnail, #avatar, #avatar-link, #channel-thumbnail',
      overlays: 'ytd-thumbnail-overlay-time-status-renderer, ytd-thumbnail-overlay-bottom-panel-renderer, ytm-thumbnail-overlay-time-status-renderer, .thumbnail-overlay, .video-thumbnail-overlay, .video-thumbnail-overlay-time-status, .yt-thumbnail-overlay-badge-view-model',
      backgrounds: '.video-thumbnail-bg, .video-thumbnail-img, .ytThumbnailViewModelImage, #thumbnail, #avatar',
      previews: 'ytd-video-preview, ytm-video-preview, #video-preview',
      routeEvents: ['yt-navigate-finish', 'yt-page-data-updated'],
    },
    {
      domain: 'xiaohongshu.com',
      isSearch(url) {
        return /^\/(?:search_result|search)(?:\/|$)/.test(url.pathname);
      },
      roots: '.search-page .feeds-container, .search-layout .feeds-container, .search-result-list, #search-results',
      cards: 'section.note-item, .note-item, section[data-note-id], .search-user-item',
      details: `${dialog}, .note-detail-mask, .note-container`,
      detailOverlays: '.note-detail-mask',
      boxes: '.cover, .cover-wrapper, .note-cover, .author-avatar, .avatar, .avatar-wrapper',
      overlays: '.cover .bottom, .cover .top, .cover .duration, .cover .badge, .cover .pinned, .cover .note-status, .cover .video-duration',
      backgrounds: '.cover, .note-cover, .author-avatar, .avatar',
      previews: '.note-item-preview',
      flowRoot: '.feeds-container',
      cardLayout: {
        position: 'relative', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto',
        transform: 'none', translate: 'none', 'margin-top': '0', 'margin-bottom': '0',
        'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto', 'max-height': 'none',
      },
      rootLayout: {
        display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'flex-start', 'align-content': 'flex-start',
        height: 'auto', 'min-height': '0', 'max-height': 'none', 'padding-top': '0', 'padding-bottom': '0',
      },
      routeEvents: [],
    },
    {
      domain: 'douyin.com',
      isSearch(url) {
        return /^\/search(?:\/|$)/.test(url.pathname);
      },
      roots: '[data-e2e="search-result-container"], [data-e2e="search-results"], [data-e2e="search-result-list"], [data-e2e="search-video-list"], .search-result-list, .search-result-container',
      cards: '[data-e2e="search-result"], [data-e2e="search-result-item"], [data-e2e="search-video-item"], [data-e2e="search-card"], [data-e2e="search-user-item"], [data-e2e="search-live-item"], [data-e2e="video-card"], [data-e2e="search-result-video"], [data-e2e="search-video-list"] > li, [data-e2e="search-result-list"] > li, .search-result-card, .search-card, .video-card',
      details: `${dialog}, [data-e2e="video-detail"], [data-e2e="video-detail-modal"], [data-e2e="detail-video"], [data-e2e="video-detail-container"], .video-detail-modal`,
      detailOverlays: '[data-e2e="video-detail-modal"], .video-detail-modal',
      boxes: '[data-e2e="video-cover"], [data-e2e="search-video-cover"], [data-e2e="user-avatar"], .video-cover, .cover, .cover-wrapper, .avatar, .avatar-wrapper',
      overlays: '[data-e2e="video-duration"], [data-e2e="video-stats"], .video-duration, .duration, .cover .stats, .cover .badge',
      backgrounds: '[data-e2e="video-cover"], [data-e2e="user-avatar"], .video-cover, .cover, .avatar',
      previews: '[data-e2e="search-result-preview"], [data-e2e="search-video-preview"], [data-e2e="search-preview"]',
      routeEvents: [],
    },
  ];
})();
