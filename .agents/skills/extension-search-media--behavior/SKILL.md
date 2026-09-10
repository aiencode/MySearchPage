---
name: extension-search-media--behavior
description: 修改或排查浏览器扩展的四站搜索结果媒体隐藏、按站设置和详情隔离时使用。
---

覆盖 `extension/content/search-media-*`、`extension/shared/search-media-settings.js`、`extension/options/search-media-settings.js` 及其 manifest、设置区接入。

- [现行行为与接口](behavior.md)：范围、布局、播放、存储及接入边界。上述模块行为或接口变化时更新。
- [验证范围](validation.md)：自动化与本地浏览器证据的适用范围。测试覆盖或线上适配证据变化时更新。
- 本能力独立于已有 UA、手机 UI 和导航页功能；不以本 skill 覆盖这些模块的既有规则。
