# 验证范围

- 权威场景为 `.agents/test-cases/extension-search-media.e2e.md`；自动化映射为 `tests/extension-search-media.mapping.md`。
- `tests/extension-search-media.test.js` 当前工作树共 116 项，本次分批运行核心 100 项、设置 16 项全部通过；另有抖音播放器布局测试 2 项通过。覆盖五种 DOM 输入（B 站、抖音、小红书、YouTube 桌面和移动）、动态结果、SPA、详情隔离、文字入口、UA 独立性及设置持久化。新增抖音复用隐藏封面作为详情挂载容器的连续四次打开/关闭回归，交替覆盖详情缓存隐藏与移除重挂载，检查画面、播放及关闭后空壳收起。冻结版本及早期回归记录见测试映射。
- 测试通过真实 manifest 加载产品脚本；DOM 来自 jsdom，媒体播放和 Chrome 存储为可观察模拟。它们不证明四站线上渲染、真实 Chrome 重启持久化或原站全部卡片类型兼容。
- 相关回归合计 173 项分批验证通过：完整运行中新增 111 项和旧回归 60 项通过，旧 VM 的两项因缺少浏览器全局而执行失败；补齐该测试环境并按真实 manifest 加载所有匹配脚本后，受影响旧文件 21 项全部通过。其余 41 项复用前次通过结果，产品文件哈希一致。没有把首次运行的两项执行错误改记为当次通过。
- 本地 Chromium 148 验证使用禁止外网的隔离页面。B 站采用当日 HTTP 卡片片段和第一方 CSS，隐藏前后高度约 185px/90px，文字与链接相同，关闭后原高度及行内样式恢复。小红书代表布局输入验证了收起瀑布流空白及关闭恢复。真实 MediaStream 视频与音轨验证了结果预览暂停静音、移入详情后允许播放。设置区在 1200px、600px、390px 验证了对应间距、控件尺寸和无水平溢出。
- YouTube 移动、小红书的部分结构名称有第一方脚本静态证据；抖音使用代表结构输入。四站完整线上浏览器兼容性尚未验证，不能将上述结果写成线上 E2E 通过。
- 设置页“线上兼容诊断”只提供授权页面取证入口；诊断结果仍需人工审查，不能自动提升为线上通过。
- `tests/extension-search-media-douyin-repeat.browser.cjs` 在本地 Chromium 156 中通过真实 manifest 加载扩展、真实点击三个结果并连续打开/关闭四次；使用真实 canvas MediaStream 视频，验证播放时间推进、未静音、画面可见、原容器定位/高度保留、背景媒体隐藏及关闭后不遗留遮挡。使用离线代表 DOM，不证明抖音线上全部结构兼容，也不测实际扬声器输出。崩溃前未完成的运行不计为通过，本次恢复后串行重跑的日志为 session scratch 中的 `browser-repeat-resumed.log`、`media-core-resumed.log` 和 `media-settings-resumed.log`。


本轮日志与本地浏览器证据保留在 `E:/Users/can/.codex/artifacts/mysearchpage-search-media-20260906/`，主要文件为 `full-validation.log`、`full-validation.evidence.json`、`legacy-vm-full-final.log`、`legacy-vm-full-final.evidence.json` 和 `offline-browser-validation.json`。本地工具链路径不属于产品运行依赖。

## 抖音连续 × 关闭/重新打开的真实页面复核

- 上一轮媒体祖先修复及离线连续开关测试没有解决用户的实际故障，不将它们记为该线上问题已解决。
- 在用户授权的现有 Chrome 中复现：首条详情正常，点 × 关闭后再开结果，URL 有 `modal_id`、body 保持滚动锁，但页面无视频节点；四站媒体隐藏开关均为 `false`。
- 临时隔离世界删除调用取证确认 `replaceOwner → scan → MutationObserver` 替换了无标识搜索祖先。该节点替换时媒体数为 0，脱离文档后却继续挂载 `searchUpperFeedContainer`、`data-e2e="modal-video-container"` 和 3 个媒体节点，确认真实根因为搜索入口替换误删未来详情 portal 挂载点，而非媒体隐藏样式。
- 收紧 `canExpandDouyinSearchOwner` 后，重载开发版扩展并刷新该搜索页，真实连续打开/点 × 关闭四轮均显示详情画面并播放，最后正常返回列表。验证范围为当时页面、当前 Chrome 配置和媒体隐藏关闭，不提升为全部抖音结构、媒体隐藏开启或其他三站线上全面通过。
- 串行分组回归通过 171 项：媒体核心 100、媒体设置 16、搜索替换/拦截/manifest/播放器合计 55。首次组合运行在 180 秒超时，无测试失败记录，但不计为整组通过；分组完成日志才作为通过证据。
- 新增 `tests/native-search-redirect-douyin-portal.browser.cjs` 四轮空挂载点复用回归通过；已有 `native-search-redirect-douyin-return.browser.cjs` 功能断言也通过。后者本地 HTTP 模拟域名被 Chromium 升级为 HTTPS，使用仅作用于随机端口本地测试服务的临时路由适配后完成，原测试文件未修改。
- 临时删除记录、原型调用钩子及版本标记已全部从产品源码移除；重新加载扩展/刷新页面后执行真实验证。相关日志位于会话 scratch 的 `douyin-portal-media-core.log`、`douyin-portal-media-settings.log`、`douyin-portal-other-unit.log`、`native-search-portal-browser.log` 和 `douyin-portal-native-return-adapted.log`。

## 连续开关防回归 Test Case

- 专用自然语言场景：`.agents/test-cases/extension-douyin-detail-repeat.e2e.md`，DYP-01～06 分别覆盖关闭媒体开关的连续 × 开关、空容器延迟挂载、多层无标识包装、明确 owner 正向对照、缓存隐藏/移除两种关闭路径，以及媒体开启的隐藏祖先复用。每项包含前提、步骤、期望和失败判据；已关联一般媒体 S-10。
- 逐项代码映射与串行运行命令：`tests/native-search-redirect-douyin-portal.mapping.md`。新增 6 项 DOM 边界单测，与现有搜索替换单测合计 24 项；浏览器回归加强为 4 种结构、16 轮真实结果点击/× 关闭，检查同一挂载点连接、目标一致、祖先可见性、视频解码及播放时间推进、关闭后播放停止/滚动锁清除/入口唯一。
- 可复用的 `native-search-redirect-douyin-portal-negative.cjs` 仅在临时副本撤销明确 owner 保护，确认 5 个边界断言及浏览器的挂载点断言拒绝旧逻辑，并删除临时副本；产品源码不变。
- 本轮防回归用例为离线验证；另重跑媒体隐藏开启相关 3 项 jsdom 场景。不测实际扬声器输出，不把此前真实页面证据提升为本轮新的线上执行结果。日志名以 `douyin-repeat-cases-` 开头，保留于会话 scratch。

## 即时阻断与旧标签接管（1.0.7）

正式自然语言场景为 [即时阻断与旧标签回收 Test Case](../../test-cases/extension-instant-blocking.e2e.md)（TC-INSTANT-BLOCK-001～012）；逐项覆盖、缺口和复测命令见 [自动化映射](../../../tests/extension-instant-blocking.mapping.md)。下列是历史运行证据，本次文档阶段未重新执行。

- `tests/extension-instant-blocking.browser.cjs` 使用真实 Chromium、manifest 及 MAIN/ISOLATED 世界脚本；四站地址由离线内容响应，其他 HTTP(S) 请求拒绝。验证正常 pushState/replaceState 可离开违规页面并同步解除门禁，普通按钮真实点击成功，再次请求违规目标仍被取消且不产生路由提交事件。没有反馈图片节点或等待恢复逻辑。
- 设置页上下文实际发送显式重连消息后，一个旧标记四站标签和一个旧标记 Google 标签均刷新并实际运行 `immediate-rule-blocking-v4`；已是 v4 的 Google 标签保留实例标记、不刷新。旧标记由新版测试页面人为设置，只验证版本回收分支，不代表运行并清理了历史旧脚本。自动启动范围和非四站媒体脚本不注入未由该浏览器脚本独立断言，具体覆盖见映射。
- 修复前真实浏览器复现了四站正常导航均被当前门禁锁住，以及旧 v3 标记被误判为当前版本（刷新次数 0）。修复后浏览器全部断言通过，相关回归 224/224 通过；此前 jsdom 中人为派发 popstate 的辅助已删除，改为真正加载 MAIN 世界钩子。
- 这些是离线真实浏览器证据，不是四站线上适配或用户当前浏览器实例已升级的证据。现有 Chrome 的扩展加载路径已核对为本项目 `extension/`，但页面检查因宿主会话错误被拒绝，未确认其已重载 1.0.7。详细记录为 `plans/instant-blocking-ablation.md`，日志和截图位于会话 scratch 的 `browser-repro/`；临时测试配置已删除，不保留旧实现副本。

## 后台闲置唤醒不刷新

- `tests/extension-background-wakeup.test.js` 的 6 项回归执行真实后台源码，覆盖连续三次全新 Worker 上下文启动、浏览器启动、安装/更新、显式重连、注入失败，以及 DOM 版本相同但当前隔离世界控制器/规则模块失效。探测函数在模拟页面世界真实执行，而非仅返回伪造版本字符串；普通唤醒不得探测或刷新，健康当前版本页不得刷新。
- `tests/extension-background-wakeup.browser.cjs` 使用独立 Chromium 配置、真实 manifest 与四站离线响应。CDP 关闭并确认后台目标消失，再发送普通状态消息唤醒；三轮×四站共 12 次检查保留页面实例、未提交输入并可点击。另四项在扩展隔离世界移除控制器存活标记和规则模块、保留相同 DOM 版本标记，显式重连后确认刷新恢复。共 16 项通过。后四项是重载交接条件模拟，不是实际扩展重载；尝试 `runtime.reload()` 导致该命令行加载的测试扩展不可用，未计为实际重载通过。
- 本轮分组通过 154 项自动化：后台唤醒/阻断/首页控制/manifest 108 项，媒体 S-13 与设置 S-14～18 共 36 项，UA 主动变更相关 10 项。已有即时阻断浏览器脚本也通过，显式重连刷新两个旧标记标签、保留当前版本标签。完整媒体文件首次运行达到 120 秒超时，不计为整组通过；最终仅上述相关分组计为本轮完成。
- 扩大检查中的两项历史断言失败保留：`navigation keeps one input handler for object history and focused search entry` 与 `TC-RUNTIME-002` 的旧 CSS 注入约束。只读恢复旧的普通唤醒刷新行为后，两项仍失败，不属于本次修复范围。
- 本轮日志为会话 scratch 中 `wakeup-before.log`、`wakeup-final-unit.log`、`wakeup-media-targeted.log`、`wakeup-ua-targeted.log`、`wakeup-browser.log`、`wakeup-instant-browser.log` 及 `wakeup-unrelated-baseline.log`；浏览器结果分别在 `wakeup-browser/` 与 `wakeup-instant-browser/`。证据是离线真实浏览器验证，不代表四站线上完整适配，也未自动重载用户当前浏览器的扩展。

## 同版本残留标记回归补验（2026-10-18）

- 现场旧小红书、抖音、B 站搜索标签保留 v4 DOM 标记，但当前扩展隔离世界缺少 `MySearchBlockingRules`；小红书 URL/标题为详情而详情容器为 0。不能仅凭 DOM 标记认定脚本健康，也不能将这个缺陷认定为所有误拦截的唯一根因。
- 修复后已在用户授权的真实 Chrome 管理页重新加载项目扩展，并从设置页执行“重连旧标签”。诊断确认小红书、抖音、B 站搜索及 B 站视频四个原有标签均 `activeVersion: immediate-rule-blocking-v4`、`rulesApiPresent:true`、`pageGate:false`，标题/URL 无规则命中。小红书详情容器恢复为 2，截图确认图文详情可见，随后完成一次关闭和重新打开；重开后页面可见详情标题。未修改用户规则或开关。
- 后续再次采样时工具返回 `authorization_host_failed`，提示 existing-profile grant ended，已停止 GUI 操作；小红书重开后的追加诊断、滚动/播放、抖音完整开关重开循环及临时诊断/设置标签清理未完成，不得声称全部线上场景通过。
- 本次最终增量 `node --test tests/extension-background-wakeup.test.js tests/extension-blocking-phase1.test.js tests/extension-search-media-probe.test.js`：52/52 通过；四站离线浏览器脚本 16 项通过。诊断新增测试覆盖详情采样、隐私/休眠标签跳过、只输出命中规则、相同 DOM 标记但隔离世界失效。受影响文件的差异空白检查在允许原有 CRLF 的条件下通过；全工作区仍有未改动导航文件的既有空白告警。
- 本轮日志保存在 scratch `30681622-9a7f-4382-b8d9-53cccdefb3aa`：`blocking-runtime-final.log`、`wakeup-reload-browser.log`、`wakeup-reload-browser/results.json`、`blocking-runtime-regression.log`、`runtime-scoped-diff-check.log`。扩大测试初次的接管静态断言已随新健康检查更新并复测通过；另两项历史断言失败范围不变。

## 详情瞬退时序修复与现场复验（2026-10-18 后续）

- 本轮继续修复的不是浏览器进程崩溃，而是详情因页面门禁或搜索浮层清理被隐藏/删除。已复现：正文详情含“热榜/猜你想搜”被当搜索弹层清理；关闭详情后残留命中网址误拦结果流；标题更新后旧标题门禁不清除。补测同时覆盖路由先变/标题先变、详情挂载前窗口、相同真实标题、同一内容 query/hash 更新，以及门禁自身遮挡造成的可见性反馈。
- 新 `tests/extension-detail-transition.test.js` 为完整规则模块+控制器+主世界 history 钩子的 12 项 jsdom 回归。jsdom 对 CSSOM 声明变化不失效 computed-style 缓存，测试层仅通过未被生产观察器监听的测试属性使缓存失效；生产侧不做 DOM 属性扰动。
- 新 `tests/extension-detail-transition.browser.cjs` 加载真实 manifest 和完整扩展，用独立 Chromium 的两站离线页面做 24 轮正常开关，最终逐帧检查 425 帧，无详情误删、误门禁或图片区域消失；每轮另检查同标题且自身内容确实命中的反向阻断。新标题真正命中、标题更正后解除、残留旧网址恢复、显式目标网址仍被阻断也通过。离线页面不等同于四站线上全量覆盖。
- 最终 Node 增量批次 82/82 通过：`extension-detail-transition.test.js`、`extension-blocking-phase1.test.js`、`native-search-redirect.test.js`、`extension-background-wakeup.test.js`、`extension-search-media-probe.test.js`。即时阻断 ablation 分组 12 项另行复测；后台唤醒浏览器 16 项复测通过，保留普通唤醒不刷新边界。
- 用户重新确认现有 Chrome 的远程调试连接后，已实际重载项目扩展（管理页 DOM 控件），在原有标签做现场验证：小红书完成三次关闭后重开，第三次重开后的截图确认图片与正文正常并保持详情；抖音三次打开同一普通资料详情、持续播放并关闭回搜索结果，第二/第三次截图分别播放至 1:28 / 1:32，最后地址无 `modal_id`。本轮没有修改用户阻断规则/开关，没有点赞收藏或发送内容。此前记录的连接阻塞已解除，不再将现场复验列为未完成。
- 现场关闭失败的两次坐标输入没有计为通过；核对发现活动标签不一致后，使用 Chrome 标签搜索自行定位，成功切换后才继续。浏览器命名会话与桌面默认会话之间的引用失效通过重新准备/精确绑定恢复，没有修改工具权限或绕过确认。外部应用打开提示已取消，没有启动外部程序。
- 本轮一次只读独立检查发现的门禁 CSS 属性误选与同一内容参数变化误放行均已修正并补测；未继续扩大审查轮次。日志与现场引用摘要在本会话 scratch：`detail-before.log`、`detail-fix-final-unit.log`、`detail-ablation.log`、`detail-transition-browser.log`、`detail-transition-browser/results.json`、`wakeup-after-detail-fix.log`、`detail-live-verification.json`。

## 小红书直接刷新帖子后的重复弹窗修复

- 用户区分了两个入口：关键词搜索结果正常，直接刷新帖子链接后关闭原帖 A，再点 A 或 B，会额外露出左上角原帖。真实 Chrome 修复前已复现：整页进入“6大主流Agent架构范式”A，关闭后标题为社区但地址仍 A；打开另一帖 B 并关闭一次后，A 再次出现（现场 p51～p54）。
- 路由诊断 p57 明确记录 `replaceState` 从 A 指向 `/explore` 被 `xiaohongshu.com/explore` 规则拒绝，历史 current 仍 A、详情节点已消失。公开站点 bundle 的直接入口关闭使用 router.replace，普通卡片关闭包含 history.go(-1)；证据摘录保存在本会话 scratch `xhs-public-source/`，不带用户 cookie 或链接校验参数。没有把站点源码推断代替现场拒绝记录。
- 新 `tests/extension-xiaohongshu-direct-entry.test.js` 七项执行完整规则模块、控制器和主世界钩子，模拟原站直接入口 replace/普通入口 back 的不同语义。修复前“再点原帖”“点别帖”两项失败、搜索入口对照通过；修复后全部通过。断言保全原生完整 history.state、一次关闭不露出 A，且首页点击/window.open/显式网址规则/仍可见详情/无列表背景/新首页文档均不获得例外。
- 新 `tests/extension-xiaohongshu-direct-entry.browser.cjs` 加载完整真实扩展，独立 Chromium 中六次实际整页刷新帖子入口、六次关键词搜索入口对照；A/B 各三轮，执行真实 history.back。12/12 通过，history 全部字段与 URL 一起归位、关闭后无详情残留、首页入口仍阻断。离线页面按公开站点的路由语义构造，不冒充线上页面。
- 修复版已在用户原 Chrome 管理页重载。真实页面复验：两次从原帖 A 链接整页加载，首次关闭均回 `/explore`；“点别帖 10.8 AI 日报 → 关闭一次”直接回列表（p59～p63），以及“再点左上角 A → 关闭一次”直接回列表（p64～p67），没有再次露出 A。最终路由诊断 p68：pathname/current 均 `/explore`、position 2、blocked 为空、notes 为空。未修改用户存储规则、开关、账户内容。
- 最终增量 Node 90/90 通过（直接入口、详情时序、基础阻断、后台唤醒、诊断、原生搜索）；即时阻断 ablation 12/12；后台唤醒离线浏览器 16 项通过。日志：`xhs-direct-before.log`、`xhs-direct-final-unit.log`、`xhs-direct-ablation.log`、`xhs-direct-browser.log`、`xhs-direct-browser/results.json`、`xhs-direct-wakeup.log`。现场摘要 `xhs-direct-live-verification.json`。本轮语法和范围内差异检查另行记录。
- 最后的诊断标签已关闭；关闭管理标签前原 Chrome 进程/窗口已更换，旧窗口动作未重放，管理标签是否随进程结束清理不作保证。这不影响已完成的修复加载与现场复验，不要求用户代做清理。
