# 即时阻断消融记录

## 现行行为

关键词、URL、作者、搜索词、页面标题和逐站主页权限继续使用现有规则。命中后同步取消访问/提交/播放尝试，保留违规卡片占位及页面级阻断状态；页面变更和设置关闭仍按既有条件解除阻断。违规媒体立即暂停，不等待。

阻断不附带图片、替代 SVG、声音、闪屏、临时弹出提示或倒计时，不设置等待期间，不扣除会话时间。只保留有效阻断记录和统计；统计去重不影响每次动作的立即阻断。

## 清除范围

- 控制器：删除图片选择/加载/显示、声音、闪屏、暂停倒计时、临时提示、反馈计时器和状态，去掉对应样式、事件链及专用清理函数；没有保留空函数、兼容别名或备用开关。
- 后台：删除旧效果事件、效果更新消息和反馈效果聚合接口。统计数据库升至版本 2，删除不再有效的事件，并以有效字段重新规范化保留记录；规则存储与原有非反馈统计不变。
- 设置页：删除效果表格、渲染代码、DOM 前置依赖和无用布局选择器；保留规则编辑器和阻断统计。三个断点仍沿用 6/2/1 间距。
- manifest：删除图片资源公开授权。
- 资源与分发：永久删除四张原图、旧 `dist/` 分发目录，以及确认携带旧设计的四个 ZIP 包。可加载源码保留在 `extension/`。
- 测试与文档：删除纯声音测试及旧功能正向契约，改为即时阻断和无副作用断言；清理 change 正文、待决策和原始来源引文中的旧设计。
- 未创建源码、资源或安装包备份。上一轮 scratch 源码副本、旧复现钩子及含旧源码正文的错误日志已删除。未改写 Git 历史或无关会话记录。

首次删除批次的上述六个生产文件共净减少 528 行；这是该批次的历史统计，不是后续修复后的净差异。没有保留旧实现作为实验对照。

## 消融方法与结果

先在删除前的当前工作区运行同一组 12 项验收测试，记录阻断结果及图片/音频/等待副作用；随后直接删除旧实现，并对相同输入复测。对照仅保存测试结果，不复制旧源码。

| 检查 | 删除前 | 删除后 |
|---|---:|---:|
| 同组即时阻断与无副作用验收 | 2/12 通过，10 项因旧副作用失败 | 12/12 通过 |
| 附加残留、IndexedDB 升级、设置页加载 | — | 3/3 通过 |
| 相关回归 | — | 224/224 通过 |

12 项覆盖关键词/URL/作者动作取消、快速重复动作、未命中放行、四站搜索页门禁、页面 URL、页面标题、主页权限、普通详情和页面状态解除。匹配动作在返回前已取消，统计去重不会使后续动作延后或放行。

附加验证使用真实执行的控制器和 jsdom DOM、fake-indexeddb 数据库升级：旧事件被删除，点击/曝光记录保留且旧字段消失；设置页无需已删除表格仍能加载规则和统计。

## 最终检查

- 224 项相关回归全部通过，0 失败、0 跳过。
- 修改的 JS/测试文件 `node --check` 通过，manifest JSON 解析通过。
- `extension/` 内旧设计关键词检查为 0 命中；旧图片资源及 ZIP 文件为 0 个。测试中的旧标识仅用于拒绝回归，不是运行实现。
- 现行需求文档中没有仍要求图片、延时、提示音或反馈效果实验的设计。
- 限定修改路径的 CRLF-aware `git diff --check` 通过。

## 复现当前版本

测试依赖 Node.js、jsdom@26 和 fake-indexeddb@6。本轮依赖安装在会话临时目录，项目依赖配置未变。

```sh
export MYSEARCHPAGE_JSDOM_MODULE="$JSDOM_MODULE"
export MYSEARCHPAGE_FAKE_INDEXEDDB_MODULE="$FAKE_INDEXEDDB_MODULE"
node --test \
  tests/extension-instant-blocking-ablation.test.js \
  tests/extension-search-blocking-ablation.test.js \
  tests/extension-blocking-phase1.test.js \
  tests/extension-homepage-blocking.test.js \
  tests/extension-xiaohongshu-blocking.test.js \
  tests/native-search-blocking-regression.test.js \
  tests/extension-options-navigation-settings.test.js \
  tests/extension-manifest-integrity.test.js \
  tests/native-search-redirect.test.js \
  tests/native-search-integration.test.js
```

## 验证边界

首次验证仅覆盖本地规则、DOM 和数据库模型，没有证明用户实际浏览器中的旧实例已更新；此前“已解决”的结论不成立。后续已补真实 Chromium 加载扩展的离线验证，详见下节；仍未将离线结果提升为四站线上验收。旧数据库记录在新版统计数据库首次打开并升级时清理，没有直接改动用户浏览器存储。

## 1.0.7：真实浏览器复现与旧脚本回收修复

用户继续报告图片/倒计时后，核对现有 Chrome 的扩展元数据，确认 ID 为 `boikmjfmjhmmbdhfokdoikjnpjjblbmj`，加载目录为本项目 `extension/`，不是已删除的分发目录。登记更新时间早于删除批次，但该时间证据本身不足以确诊图片来源。桌面浏览器桥接可列出标签，深入读取时被宿主以 `authorization_host_failed: ... requires an explicit session` 拒绝，未绕过该限制、未声称已重载用户实例。

自行使用真实 Chromium、真实 manifest 和 MAIN/ISOLATED 世界脚本加载该扩展；HTTP(S) 页面由本地内容返回，其他请求拒绝，不复制用户浏览器配置。临时测试配置在退出时删除，无源码或资源备份。

复现到的实际缺陷：

- 四站命中搜索词后，`handlePageNavigation` 用当前页面门禁拦住正常目标，导致无法离开违规搜索，普通控件持续被遮挡。
- MAIN 世界成功执行 history 操作后没有提交事件，状态恢复依赖额外 DOM 变化或人工派发 popstate。旧 jsdom 夹具曾主动派发 popstate，遮盖了这一缺口。
- 删除前后都使用 `explicit-homepage-permission-v3`，重连把旧脚本误当成当前版本；且原范围仅覆盖四站，显式重连漏掉其他网站的旧阻断脚本。

修复：

- 目标自身仍按搜索词、网址和主页权限规则判定；无规则命中的有效导航可离开当前门禁，不因当前页面违规而连带取消。
- 成功 pushState/replaceState 后同步发出 `mysearch-blocking-route-committed`，控制器立即重算状态；失败或被拒绝操作不发出提交事件，没有新增等待。
- manifest 版本改为 **1.0.7**，前后台运行标记统一为 **immediate-rule-blocking-v4**。
- 自动接管仍只扫描原四站；用户显式“重连旧标签”检查全部 HTTP(S) 页面，旧运行版本才刷新。媒体脚本仍只向四站注入，同版本非四站页面不刷新、不注入媒体脚本。

同一真实浏览器测试 `tests/extension-instant-blocking.browser.cjs` 的前后结果：

| 项目 | 修复前 | 修复后 |
|---|---|---|
| 四站正常搜索导航 | 4/4 均被锁住 | 4/4 同步放行并解除门禁 |
| 普通控件真实鼠标点击 | 持续不可用 | 4/4 成功 |
| 再次请求违规 replaceState | 仍阻断 | 仍阻断，当前正常页面不被改变 |
| 原 v3 标签识别 | 刷新 0 个 | 四站与 Google 旧标签各刷新 1 个，均实际运行 v4 |
| 已是 v4 的普通页面 | — | 实例标记保留，没有刷新 |
| 新加载实例的反馈图片节点 | 0 | 0 |

修复后该次运行的同步动作取消耗时约 0.5–0.6ms，仅为本地场景观测值，不作为性能基准。成功的 pushState/replaceState 各产生一次提交，被阻断的操作不产生提交。真实浏览器验收全部断言通过，相关回归 **224/224** 通过；jsdom 用例改为加载 MAIN 世界钩子，不再主动派发 popstate 掩盖缺口。

运行方式：设置 `MYSEARCHPAGE_PLAYWRIGHT_MODULE`、`PLAYWRIGHT_BROWSERS_PATH` 和位于会话 scratch 的 `MYSEARCHPAGE_BROWSER_OUTPUT` 后运行 `node tests/extension-instant-blocking.browser.cjs`。输出包含四站结果、旧标签回收结果及截图，不含旧源码。实际用户浏览器是否已完成 1.0.7 重载仍未确认，不能据此宣称其当前页面已修好。
