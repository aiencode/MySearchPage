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
