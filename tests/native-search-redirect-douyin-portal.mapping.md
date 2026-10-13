# 抖音详情 portal 挂载点回归

## 真实故障与实现边界

搜索媒体隐藏关闭时，点 × 关闭首个详情会触发搜索控件重建。旧搜索 owner 选择逻辑依据“没有其他控件”向无标识祖先提升，并用 `replaceChild` 将该祖先脱离文档。它恰好是抖音下一次详情的复用 portal 挂载点；替换时没有媒体，下一次打开后才在脱离节点中出现详情和媒体，因此单纯保护已有播放器祖先不足以覆盖故障。

`native-search-redirect-runtime.js` 的 `canExpandDouyinSearchOwner` 现在只接受明确匹配 `targetSite.ownerSelectors` 的外层搜索区域，无标识祖先不再提升为整体替换目标。

## 自动化回归

| 测试 | 验证 |
| --- | --- |
| `native-search-redirect.test.js`：仅提升到明确搜索 shell | 无标识外层保留；增加明确搜索标识后仍可选择该搜索 shell |
| `native-search-redirect-douyin-portal.browser.cjs` | 初次替换不删除未来挂载点；关闭后重建搜索控件、再挂载详情，连续四轮都保留连接的原挂载点、详情视频及结果列表 |
| `native-search-redirect-douyin-return.browser.cjs`（既有文件未修改） | 原关闭控件与结果节点身份保留、自绘入口迁移、隐藏详情不持有入口、入口可打开扩展搜索 |

新浏览器回归使用隔离 Chromium 和被路由替换的代表页面，只加载实际搜索替换运行脚本，不启用媒体隐藏。它不能替代真实抖音兼容验证。

运行新回归需要设置 `MYSEARCHPAGE_PLAYWRIGHT_MODULE` 和 `MYSEARCHPAGE_CHROMIUM_BINARY`：

```sh
TMPDIR=/tmp node tests/native-search-redirect-douyin-portal.browser.cjs
```

## 真实页面证据

经用户授权的既有 Chrome，JavaScript 搜索页面、媒体隐藏关闭：先复现并捕获 `replaceOwner → scan → MutationObserver` 删除调用，证明脱离节点后来含 `modal-video-container` 和 3 个媒体节点。修复并移除临时记录后，重载开发版扩展/刷新页面，四轮连续打开、点 × 关闭均有详情画面且播放，最后返回搜索列表。实际观察的详情依次包含西门子、光标跟随效果、零基础学网安、行为验证；第四轮点击链接名与最终现场视频不同，仅按实际画面记录，不据此宣称特定链接内容映射已验证。

相关分组单测合计 171 项通过；旧返回浏览器测试初次被本地 HTTP 模拟域名的 HTTPS 升级阻塞，经临时测试路由适配后断言通过。完整范围、日志与不作扩大解释的边界见 `.agents/skills/extension-search-media--behavior/validation.md`。
