# 抖音详情 portal 挂载点回归

## 真实故障与实现边界

搜索媒体隐藏关闭时，点 × 关闭首个详情会触发搜索控件重建。旧搜索 owner 选择逻辑依据“没有其他控件”向无标识祖先提升，并用 `replaceChild` 将该祖先脱离文档。它恰好是抖音下一次详情的复用 portal 挂载点；替换时没有媒体，下一次打开后才在脱离节点中出现详情和媒体，因此单纯保护已有播放器祖先不足以覆盖故障。

`native-search-redirect-runtime.js` 的 `canExpandDouyinSearchOwner` 现在只接受明确匹配 `targetSite.ownerSelectors` 的外层搜索区域，无标识祖先不再提升为整体替换目标。

## 权威 Test Case 与自动化映射

自然语言验收标准：`.agents/test-cases/extension-douyin-detail-repeat.e2e.md`。稳定 ID 为 `TC-DY-DETAIL-REPEAT-001`～`006`。

| 用例 | 代码覆盖 | 主要断言与边界 |
| --- | --- | --- |
| DYP-01 连续四轮 × 开关 | `native-search-redirect-douyin-portal.browser.cjs` 单层移除/多层缓存场景 | Playwright 真正点击 A、B、C、A 和 ×；连接、目标/标题/路由一致、祖先可见性、尺寸/命中测试、视频解码及时间推进；关闭后停止播放/轨道、解除滚动锁、列表身份保留 |
| DYP-02 空容器与延迟挂载 | 新 `native-search-redirect-douyin-portal.test.js` 三种无标识结构 + 浏览器每轮 | 首次没有媒体或关闭控件；替换及关闭重建后的原对象仍连接；延迟挂载的详情存在于当前 document；不由 fixture 重新连接脱离节点 |
| DYP-03 多层/搜索 class 误判 | 新单元测试 1/2/4 层无标识结构 + 浏览器三层场景 | 不凭搜索 class 或无其他控件提升到无标识祖先；所有包装身份与连接保留 |
| DYP-04 明确 owner 正向对照 | 新单元测试 data-e2e、form role、共享关闭控件共三项；既有 owner 单测；浏览器明确 shell 场景 | 明确搜索区域被选择/替换，外层 portal 和关闭控件保留；原生输入/shell 已移除，自绘入口恰好一个，不能通过禁用替换/Observer 过关 |
| DYP-05 移除/隐藏缓存 | 浏览器 remove 和 cache 场景 | 各四轮，不刷新；缓存复用同一详情对象但本轮目标更新，关闭后不播放/遮挡，下一次真实点击仍成功 |
| DYP-06 媒体隐藏开启的祖先复用 | `extension-search-media.test.js` 的 douyin S-09 feed-active-video、S-10 连续四次及关闭返回三个场景；既有 `extension-search-media-douyin-repeat.browser.cjs` | 复用隐藏封面时详情画面/播放恢复、背景继续隐藏、关闭后空壳收起。该分支本轮重跑三个 jsdom 场景；既有媒体浏览器用例本轮未重跑 |

`native-search-redirect-douyin-portal-negative.cjs` 是有界旧逻辑负对照：在临时副本中仅去掉明确 owner 保护，要求 5 个 owner 边界单测失败、无关关闭控件对照仍通过，且浏览器明确报“future portal host 被脱离”。超时、崩溃、依赖错误不能当作负对照成功；完成后删除临时副本并校验产品源码未变。

## 运行方式

先设置 `MYSEARCHPAGE_JSDOM_MODULE`、`MYSEARCHPAGE_PLAYWRIGHT_MODULE`（可为已安装模块路径）及 `MYSEARCHPAGE_CHROMIUM_BINARY`。若模块可由 Node 正常解析，普通单元/浏览器测试可省略对应模块路径；负对照要求显式设置 Playwright 模块路径和 Chromium 路径。以下命令串行执行：

```sh
node --test --test-concurrency=1 tests/native-search-redirect.test.js tests/native-search-redirect-douyin-portal.test.js
TMPDIR=/tmp node tests/native-search-redirect-douyin-portal.browser.cjs
TMPDIR=/tmp node tests/native-search-redirect-douyin-portal-negative.cjs
node --test --test-concurrency=1 --test-name-pattern='douyin: (复用封面容器连续|feed-active-video|关闭详情和恢复搜索)' tests/extension-search-media.test.js
```

正常验收不得设置 `MYSEARCHPAGE_NATIVE_REDIRECT_SOURCE`；仅负对照对子进程设置它以读取临时副本。

## 本轮新增用例验证范围

- 新增 6 项 DOM 边界单测；与现有搜索替换 18 项合计 24 项通过。
- 浏览器 4 种代表结构，每种四轮，共 16 轮真实点击/× 关闭，使用真实 canvas MediaStream 解码并检查播放时间推进。此测试只加载产品搜索替换脚本，不加载媒体隐藏控制器，代表媒体隐藏不参与的根因路径；视频静音且无音轨，不证明扬声器输出。
- 旧逻辑负对照确认 5 个边界单测及浏览器连接断言会拒绝该回归。
- 媒体隐藏开启相关 3 项 jsdom 回归通过。没有本轮新增线上 GUI 验证，也未重新执行所有四站测试。
- 日志保留在会话 scratch 的 `douyin-repeat-cases-unit.log`、`douyin-repeat-cases-browser.log`、`douyin-repeat-cases-negative.log`、`douyin-repeat-cases-hidden.log`。下方为此前真实故障修复证据，不替代每次发布的线上复核。

## 真实页面证据

经用户授权的既有 Chrome，JavaScript 搜索页面、媒体隐藏关闭：先复现并捕获 `replaceOwner → scan → MutationObserver` 删除调用，证明脱离节点后来含 `modal-video-container` 和 3 个媒体节点。修复并移除临时记录后，重载开发版扩展/刷新页面，四轮连续打开、点 × 关闭均有详情画面且播放，最后返回搜索列表。实际观察的详情依次包含西门子、光标跟随效果、零基础学网安、行为验证；第四轮点击链接名与最终现场视频不同，仅按实际画面记录，不据此宣称特定链接内容映射已验证。

相关分组单测合计 171 项通过；旧返回浏览器测试初次被本地 HTTP 模拟域名的 HTTPS 升级阻塞，经临时测试路由适配后断言通过。完整范围、日志与不作扩大解释的边界见 `.agents/skills/extension-search-media--behavior/validation.md`。
