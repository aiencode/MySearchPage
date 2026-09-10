# 搜索媒体测试输入

`sites.js` 是离线 DOM 行为 fixture，供 `extension-search-media.test.js` 加载真实 manifest 内容脚本使用。`data-test-*` 仅供测试定位，不是产品选择器契约。

- B 站 `.bili-video-card` / `.bili-video-card__wrap` / `.bili-video-card__image` / `.bili-video-card__image--wrap` / `picture.bili-video-card__cover` / `.bili-video-card__mask` / `.bili-video-card__stats` / 标题与作者链接层级，依据 2026-09-06 主任务取得的搜索页面 HTTP 卡片片段。原证据保留在本轮外部产物 `site-evidence/bilibili-first-card.html`。播放量、弹幕数与时长在封面共同父区域内，测试要求它们仍可见。fixture 缩减了 SVG、Vue 属性与事件属性，并加入人工混排头像、多图与 video 预览样本。
- YouTube、抖音、小红书目前没有本轮真实结果卡片 DOM 证据；对应结构是具名代表输入，不能宣称线上兼容性。YouTube 另覆盖移动 YTM 结构，`ytm-video-with-context-renderer`、`ytm-media-item`、`.media-item-thumbnail-container`、`ytm-thumbnail-cover`、`.video-thumbnail-img` 名称有主任务取得的第一方移动 bundle 创建代码佐证。小红书 `.feeds-container`、`.note-item`、`.note-detail-mask`、`.note-container` 名称有主任务取得的第一方首页 bundle 静态佐证；这些均不等于真实搜索页面渲染取证。
- 所有固定高度、aspect-ratio、混排图片、模拟预览、详情及路由操作都是可复现测试条件；没有声称来自本轮浏览器采样。测试环境禁止网络请求，不执行原站脚本。
- jsdom 没有布局与实际媒体播放能力。这里的样式断言只证明 fixture 中媒体内容隐藏与媒体容器隐藏/样式清理，不能证明实际矩形、瀑布流无空白或音轨无输出。详情与入口测试只覆盖 DOM 及模拟事件；真实鼠标/键盘、新标签、音轨仍需浏览器验证。
