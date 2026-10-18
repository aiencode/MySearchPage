# 即时阻断与旧标签回收：Test Case 自动化映射

## 权威标准与范围

- 自然语言验收标准：[正式 Test Case](../.agents/test-cases/extension-instant-blocking.e2e.md)，稳定 ID 为 `TC-INSTANT-BLOCK-001`～`012`（简称 IB-01～12）。
- 实现与实验历史：[即时阻断消融记录](../plans/instant-blocking-ablation.md)；搜索规则共用历史：[搜索词消融记录](../plans/search-keyword-blocking-ablation.md)。历史记录不替代用例验收。
- 发布基线为扩展 1.0.7、运行标记 `immediate-rule-blocking-v4`；后续发布应核对实际版本，不能仅凭目录相同签收。
- 本次为文档阶段：读取现有测试核对覆盖，没有修改代码、运行产品测试、重载浏览器或重新推送提交。下列通过结果均引用此前已执行证据。

## 稳定 ID 到现有测试

| 正式用例 | 现有自动化入口及定位 | 现有断言 | 未覆盖/验收限制 |
|---|---|---|---|
| IB-01 / TC-INSTANT-BLOCK-001 | `extension-instant-blocking-ablation.test.js`：`ablation keyword/url/author: same cancellation outcome, zero presentation or waiting`；`extension-xiaohongshu-blocking.test.js`：`TC-REG-XHS-003 ${kind} match replaces only its note and removes its actionable targets` | VM 给定 match 的同步取消顺序与无反馈调用；小红书代表 DOM 分别命中关键词、URL、作者并移除该卡片入口 | VM 不做规则取词；小红书 DOM 不等于三类规则在四站所有真实卡片和键盘路径通过 |
| IB-02 / TC-INSTANT-BLOCK-002 | `extension-blocking-phase1.test.js`：`blockEvent cancels synchronously before recording, without waiting for storage`、`removed blocking effects and outcome statistics leave no production references`；`extension-instant-blocking-ablation.test.js`：`assertPureBlocking` 及页面场景；浏览器脚本的 `presentationCount` | 同步取消早于统计；旧效果引用不在生产文件中；jsdom 未创建效果节点/事件/音频上下文，未安排 ≥500ms timeout；离线浏览器页无图片或 feedback 节点 | jsdom 计时器探针不覆盖全部定时 API 或 <500ms 任务；浏览器脚本没有直接音轨/声音或全部计时调用探针，不能单独证明其完整无副作用 |
| IB-03 / TC-INSTANT-BLOCK-003 | `extension-instant-blocking-ablation.test.js`：`deduplicated records never delay blocking; a non-match remains allowed`；phase1 同步取消与 `click and exposure recording keeps payloads and deduplication without effect state` | 未命中不调用取消；连续三次匹配均取消，即使 recordClick 去重返回 null；统计 Promise 一直 pending 不阻止取消返回；记录去重与字段独立 | 真实浏览器慢磁盘/IndexedDB 故障和快速多输入交错未端到端模拟 |
| IB-04 / TC-INSTANT-BLOCK-004 | `extension-search-blocking-ablation.test.js`：四站 `encoded URL uses one keyword policy in content and background`、`search control matching and submit block immediately and record a click`、`shared route aliases and empty searches retain site boundaries`；`extension-instant-blocking.browser.cjs` 的 `urls` 循环 | 前后台编码词取值、提交、路由别名、相对 URL、空词、未知域名等；真实 manifest 下四站离线搜索地址建立规则门禁 | 原生输入框为代表夹具；浏览器页仅有一个普通按钮，不是四站真实搜索结果布局或原生表单；MySearchPage UI 全链路需单独复核 |
| IB-05 / TC-INSTANT-BLOCK-005 | `extension-instant-blocking.browser.cjs`：`leftBlockedRoute`、`gateAfterRoute`、`allowed`、`normalButtonVisible`、`physicalClick`、`cleanReplaceAllowed`、`commits`；即时阻断 jsdom 四站循环 | 产品 MAIN/ISOLATED 钩子实际加载；正常 pushState 后当场解除，普通控件可见且真实点击成功；正常 replaceState 成功；两个成功操作恰有两次提交 | 没有依赖人工 popstate。普通按钮在 pushState 后完成合成点击，真实点击在 replaceState/拒绝违规操作后完成；不是每个操作后都逐次真实点击。未覆盖四站线上全部 SPA 实现 |
| IB-06 / TC-INSTANT-BLOCK-006 | 同一浏览器脚本：`blockedRouteCancelled`、`commits === 2` 及真实按钮点击；jsdom 四站循环恢复后的违规 replaceState | 违规替换不改变当前正常 URL，不重新建立门禁，不产生额外提交；随后真实点击仍有效 | `original.call` 原生抛错的 history 分支没有独立自动化用例，不能以被规则拒绝分支代替 |
| IB-07 / TC-INSTANT-BLOCK-007 | `extension-instant-blocking-ablation.test.js`：current URL / page title / homepage permission / ordinary details 场景；`extension-search-blocking-ablation.test.js`：disabled blocking、unrelated submit、nested unrelated form；`extension-homepage-blocking.test.js` 既有规则测试 | 页面级命中与普通详情对照；关闭内容阻断不触发其效果；无关和嵌套表单不借用搜索词；主页规则接口边界 | 内容开关/主页网络权限的真实浏览器组合、真实媒体暂停行为需对应模块用例补证，不能仅凭本组宣称所有组合端到端通过 |
| IB-08 / TC-INSTANT-BLOCK-008 | `extension-instant-blocking.browser.cjs`：从真实设置页发送 `RECONNECT_SEARCH_MEDIA_TABS`，检查 `compatibility.json` | 一个旧标记 YouTube 页和一个旧标记 Google 页刷新后实际为 v4；当前 Google 页实例标识保留；测试场景 `attempted=3`、`reloaded=2` | 在新版脚本页人为改旧标记，只证明版本分支/刷新，不运行历史旧脚本；不等于清除了原用户内存中的旧图片。没有直接断言非四站未执行媒体脚本或自动启动四站范围，仍需独立检查；消息从设置页上下文发送，不是点击重连按钮的完整 UI 用例 |
| IB-09 / TC-INSTANT-BLOCK-009 | `extension-instant-blocking-ablation.test.js`：`removal: runtime, manifest, resources and dashboard contain no retired presentation feature`；phase1 反残留断言；浏览器打印 `identity` | 核心文件旧设计关键词、原图片目录、已知分发目录/ZIP 不存在；浏览器读取扩展 ID/版本；旧页回收后读取 v4 | 浏览器脚本输出版本但未单独 assert `version === 1.0.7`，需执行者核对；不能覆盖任意外部安装包或另一个浏览器配置。独立可见浏览器的运行脚本核对属于另份历史证据 |
| IB-10 / TC-INSTANT-BLOCK-010 | `extension-instant-blocking-ablation.test.js`：`removal: database upgrade deletes retired events and strips obsolete fields without losing blocking records`；phase1 后台事件规范化/写入测试 | fake-indexeddb v1→v2，2 条有效记录保留，1 条废弃记录删除，旧字段消失；拒绝废弃事件类型；有效事件可规范化写入 | 当前迁移用例不预置/断言 chrome.storage 规则，也未测试迁移后重开、新记录写入与升级的组合；不代表真实 Chrome 原用户数据库已迁移 |
| IB-11 / TC-INSTANT-BLOCK-011 | `extension-instant-blocking-ablation.test.js`：`removal: dashboard loads rule editors and only blocking statistics without the retired table` | jsdom 执行共享规则与 dashboard，规则输入值可读、三行时期统计渲染、仅一张有效统计表 | 不是规则编辑保存/刷新真实请求或三档视觉验收，不把“初始化成功”写成整个设置页通过 |
| IB-12 / TC-INSTANT-BLOCK-012 | 无原有 Chrome 配置的完整自动化通过记录；参见消融记录的实际浏览器限制 | 曾确认原扩展 ID/加载目录；另启动独立可见 1.0.7 并读取运行脚本版本，无废弃实现 | 原故障图片/倒计时来源未完全确诊；原有浏览器页面深入读取受宿主会话接口拒绝，原配置升级后的实际体验仍待验收，不能以独立配置替代 |

以上代码文件均位于本目录。表中指出的缺口是验收状态，不是文档阶段修改产品代码的授权。

## 自动化执行命令

### 本地单元/DOM/数据库

测试依赖 Node.js、jsdom 和 fake-indexeddb；可正常被 require 解析时无需模块路径环境变量。否则设置为本机已安装模块目录，不把个人工具链路径写成产品依赖。

```sh
export MYSEARCHPAGE_JSDOM_MODULE="$JSDOM_MODULE"
export MYSEARCHPAGE_FAKE_INDEXEDDB_MODULE="$FAKE_INDEXEDDB_MODULE"
node --test --test-concurrency=1 \
  tests/extension-instant-blocking-ablation.test.js \
  tests/extension-search-blocking-ablation.test.js \
  tests/extension-blocking-phase1.test.js \
  tests/extension-xiaohongshu-blocking.test.js \
  tests/extension-homepage-blocking.test.js \
  tests/native-search-blocking-regression.test.js
```

### 真实扩展浏览器（离线页）

需要 Playwright 对应的完整 Chromium（脚本使用 `channel: 'chromium'` 和扩展加载，不是用户的已有配置）。先准备可信工具链；本命令本身不安装依赖。

```sh
export MYSEARCHPAGE_PLAYWRIGHT_MODULE="$PLAYWRIGHT_MODULE"
export PLAYWRIGHT_BROWSERS_PATH="$BROWSERS_PATH"
export MYSEARCHPAGE_BROWSER_OUTPUT="$PI_SCRATCH_DIR/instant-blocking-doc-check"
node tests/extension-instant-blocking.browser.cjs
```

- `MYSEARCHPAGE_BROWSER_OUTPUT` 为必填，必须是本轮 scratch 输出目录。脚本在其下创建临时 profile，正常退出/可捕获异常路径关闭并删除 profile；进程被强杀时需核对是否残留，只清理本轮可确认的测试配置。
- 真实 manifest 加载产品脚本和扩展 service worker。四站与 Google 导航返回最小离线页面，其他 HTTP(S) 请求拒绝；不访问真实账号、不复制历史/Cookie、不创建旧源码副本。
- `results.json`：四站动作取消、正常离开、门禁解除、replaceState、提交通知和真实按钮点击；`compatibility.json`：旧标签刷新和新标签实例保留；分站 PNG 是恢复后的截图，不是命中瞬间/完整等待过程录像；标准输出包含扩展 ID/版本。
- `blockMs` 仅记录本地同步事件取消观测，不是性能基准或固定通过阈值。通过须检查同步顺序和用户可操作性。
- 此脚本没有“已完成所有正式用例”的汇总语义；需要依表逐项核对部分覆盖及待验收内容。

## 历史证据及本轮状态

1. 首次去除表现层：同一组 12 项验收从 2/12 到 12/12，另 3 项残留/迁移/设置页测试通过。当时没有实际扩展的路由恢复覆盖，不能证明用户原问题已解决。
2. 后续真实 Chromium 复现：四站正常导航全部被当前门禁锁住；旧 v3 标记标签刷新次数为 0。修复到 1.0.7/v4 后，浏览器全部断言通过：四站普通控件可真实点击，违规路由仍取消，两个旧标记标签实际刷新为 v4、当前普通标签保留。
3. 该次工作区相关回归为 224/224，通过记录见会话 scratch `browser-repro/regression.log`；浏览器输出见 `browser-repro/after/`。这是当时工作区运行结果，不声明经过分块提交后的独立提交树也已重新执行同一批次。
4. 本次只新增正式用例及映射、更新文档入口；仅做文档链接、ID、覆盖和语法格式检查，没有重跑上述命令，也没有新增线上通过结果。

## 复测记录模板

```text
发布/扩展实际版本、运行标记、加载目录：
浏览器及配置性质（离线临时 / 用户原有）：
Test Case ID、场景/规则/目标：
执行入口与命令（若自动化）：
实际步骤和观测结果：
结论（通过 / 失败 / 环境阻塞 / 未执行）：
证据路径及未覆盖范围：
```
