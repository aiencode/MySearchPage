'use strict';

// Bilibili card class hierarchy follows the captured HTTP card (see README.md).
// Other sites and all interactive/mixed-media additions are representative inputs,
// not captured live-page evidence. data-test-* attributes are assertion handles only.
const sites = [
  {
    id: 'bilibili', domain: 'bilibili.com',
    search: 'https://search.bilibili.com/all?keyword=javascript',
    nextSearch: 'https://search.bilibili.com/all?keyword=css&order=click',
    detail: 'https://www.bilibili.com/video/BV1Y84y1L7Nn/',
    sameOriginDetail: 'https://search.bilibili.com/video/BV1Y84y1L7Nn/',
    outside: 'https://www.bilibili.com/',
    root: '<div class="search-page"><div class="video-list row" data-test-results></div></div>',
    card(body, info) {
      return `<div class="bili-video-card" data-test-card><div class="bili-video-card__wrap">
        <a href="${this.detail}" target="_blank"><div class="bili-video-card__image" style="height:180px;aspect-ratio:16/9" data-test-mixed-cover>
          <div class="bili-video-card__image--wrap" data-test-media-slot style="height:180px;aspect-ratio:16/9">${body}</div>
          <div class="bili-video-card__mask"><div class="bili-video-card__stats"><span data-test-text>771.6万</span><span data-test-text>20.6万</span><span class="bili-video-card__stats__duration" data-test-text>60:10:24</span></div></div>
        </div></a><div class="bili-video-card__info"><div class="bili-video-card__info--right">${info}</div></div>
      </div></div>`;
    },
    pictureClass: 'v-img bili-video-card__cover', titleClass: 'bili-video-card__info--tit',
    authorClass: 'bili-video-card__info--owner', avatarClass: 'bili-avatar',
    author: 'https://space.bilibili.com/37974444',
  },
  {
    id: 'youtube', domain: 'youtube.com',
    search: 'https://www.youtube.com/results?search_query=javascript',
    nextSearch: 'https://www.youtube.com/results?search_query=css&sp=EgIQAQ%3D%3D',
    detail: 'https://www.youtube.com/watch?v=fixture-video', outside: 'https://www.youtube.com/',
    root: '<ytd-search><ytd-section-list-renderer><div id="contents" data-test-results></div></ytd-section-list-renderer></ytd-search>',
    card(body, info) {
      return `<ytd-video-renderer data-test-card><div id="dismissible"><ytd-thumbnail data-test-media-slot style="width:320px;height:180px;aspect-ratio:16/9"><a id="thumbnail" href="${this.detail}">${body}</a></ytd-thumbnail><div id="metadata">${info}</div></div></ytd-video-renderer>`;
    },
    pictureClass: 'yt-core-image', titleClass: 'title-and-badge', authorClass: 'ytd-channel-name',
    avatarClass: 'channel-avatar', author: 'https://www.youtube.com/@fixture-author',
  },
  {
    id: 'douyin', domain: 'douyin.com',
    search: 'https://www.douyin.com/search/javascript?type=video',
    nextSearch: 'https://www.douyin.com/search/css?type=video&sort_type=1',
    detail: 'https://www.douyin.com/video/7000000000000000001', outside: 'https://www.douyin.com/',
    root: '<main><div data-e2e="search-result"><ul data-e2e="search-result-list" data-test-results></ul></div></main>',
    card(body, info) {
      return `<li data-e2e="search-video-card" data-test-card><a href="${this.detail}" class="video-cover" data-test-media-slot style="height:240px;aspect-ratio:3/4">${body}</a><div class="video-info">${info}</div></li>`;
    },
    pictureClass: 'video-cover-image', titleClass: 'video-title', authorClass: 'video-author',
    avatarClass: 'avatar', author: 'https://www.douyin.com/user/fixture-author',
  },
  {
    id: 'xiaohongshu', domain: 'xiaohongshu.com',
    search: 'https://www.xiaohongshu.com/search_result?keyword=javascript&type=51',
    nextSearch: 'https://www.xiaohongshu.com/search_result?keyword=css&type=51&sort=general',
    detail: 'https://www.xiaohongshu.com/explore/fixture-note', outside: 'https://www.xiaohongshu.com/explore',
    root: '<div class="search-container"><div class="feeds-container" data-test-results></div></div>',
    card(body, info) {
      return `<section class="note-item" data-test-card><div><a href="${this.detail}" class="cover ld mask" data-test-media-slot style="height:240px;aspect-ratio:3/4">${body}</a><div class="footer">${info}</div></div></section>`;
    },
    pictureClass: 'cover-image', titleClass: 'title', authorClass: 'author',
    avatarClass: 'author-avatar', author: 'https://www.xiaohongshu.com/user/profile/fixture-author',
  },
];

sites.splice(2, 0, {
  ...sites.find(site => site.id === 'youtube'),
  id: 'youtube-mobile',
  root: '<ytm-app><ytm-search><div class="search-results" data-test-results></div></ytm-search></ytm-app>',
  pictureClass: 'video-thumbnail-img',
  card(body, info) {
    return `<ytm-video-with-context-renderer data-test-card><ytm-media-item><div class="media-item-thumbnail-container" data-test-media-slot style="height:180px;aspect-ratio:16/9"><ytm-thumbnail-cover><a href="${this.detail}">${body}</a></ytm-thumbnail-cover></div><div class="media-item-info">${info}</div></ytm-media-item></ytm-video-with-context-renderer>`;
  },
});

function cardMarkup(site, suffix = '1', { media = true, preview = true } = {}) {
  const body = media ? `<picture class="${site.pictureClass}" data-test-media><source srcset="https://media.invalid/${suffix}.webp" type="image/webp"><img data-test-media src="https://media.invalid/${suffix}.jpg" alt="结果封面"></picture>${preview ? '<video data-test-media data-test-preview autoplay loop src="https://media.invalid/preview.mp4"></video>' : ''}` : '';
  const info = `<a data-test-link="title" id="video-title" href="${site.detail}" target="_blank"><h3 class="${site.titleClass}" data-test-text>JavaScript 原标题 ${suffix}</h3></a>
    <a class="${site.authorClass}" data-test-link="author" href="${site.author}" target="_blank">${media ? `<img class="${site.avatarClass}" data-test-media src="https://media.invalid/avatar.jpg" alt="作者头像">` : ''}<span data-test-text>原作者 ${suffix}</span></a>
    <p data-test-text>原摘要 ${suffix} <span>含完整混排文字</span>${media ? '<img data-test-media src="https://media.invalid/inline.jpg" alt="摘要插图">' : ''}</p>
    <span data-test-text>原统计 123</span><button data-test-action data-test-text>原操作</button>`;
  return site.card(body, info);
}

function pageMarkup(site, { result = true } = {}) {
  return `<!doctype html><html><head><title>Search fixture</title><style>body{margin:0}img,video{display:block} [data-test-card]{margin:6px} [data-test-results]{display:block}</style></head><body>
    <header><img data-test-outside src="https://media.invalid/logo.jpg" alt="结果外标识"><a href="/account">账户</a></header>
    ${site.root.replace('data-test-results>', `data-test-results>${result ? cardMarkup(site) : ''}`)}
    <button data-test-load>原生加载更多</button></body></html>`;
}

module.exports = { sites, cardMarkup, pageMarkup };
