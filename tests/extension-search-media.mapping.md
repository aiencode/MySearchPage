# 搜索结果媒体测试映射

权威 TC：`.agents/test-cases/extension-search-media.e2e.md`。测试文件：`tests/extension-search-media.test.js`；输入：`tests/fixtures/search-media/sites.js`。本文件映射自动化断言的实际范围，不将局部 fixture 通过写成完整 E2E 通过。

## 接入契约与执行模型

- 主线程在本轮委派中确定的技术契约：`chrome.storage.local.searchMediaSettings` 是四基础域名（`bilibili.com`、`douyin.com`、`youtube.com`、`xiaohongshu.com`）到布尔值的对象；内容脚本直接读取并监听 `chrome.storage.onChanged`，不依赖 UA 消息链路。测试通过这一入口显式启用当前站点。它是测试接入条件，不是 S-13 对内部 API 的用户预期。
- 核心 S-01～S-13 始终显式启用当前站点。新增 S-14～S-18 采用后来确认的默认四站开启、options 独立区域与四站标签、按站即时切换和保存重开行为；未存储域名按开启、明确 `false` 按关闭。UA 状态由独立存储与 `GET_STATUS` 对照提供。
- 测试读取当前真实 `extension/manifest.json`，按 URL match 规则加载列出的 CSS/JS；JS 在共享 VM 上下文内按顺序执行，保留跨脚本全局绑定。没有伪造内容入口，也没有把找不到新产品文件当作目标 RED。
- DOM 由 jsdom 提供真实 CSS 选择器、计算样式、DOM 事件与 MutationObserver。读取依赖优先使用 `MYSEARCHPAGE_JSDOM_MODULE` 环境变量，否则解析 `jsdom`，不将个人工具链路径写入测试逻辑。
- 媒体 `play` / `pause` / `paused` 是有状态可观测 stub，包含 `play`、`playing`、`pause` 事件；没有实际音视频解码、时间推进或音轨输出。原生图片及站点脚本不联网加载。
- `fetch`、XHR、`sendBeacon`、scroll API、加载更多按钮、runtime 消息、tabs reload/update 被记录。只证明这些模拟入口中无补结果动作，不代表真实站点完整网络追踪。
- 核心每项按 B 站、YouTube 桌面、YouTube 移动、抖音、小红书五种输入执行，覆盖四域名。设置批按四域名逐项覆盖默认、关闭与重新开启，再用一次混合选择重开及详情页/弹窗两种组合覆盖状态与详情边界。只有 B 站卡片层级来自本轮 HTTP DOM 样本；其余结构证据与人工扩展范围详见 fixture README。
- 设置批加载真实 `options/options.html` 的 CSS 与全部 script src，通过确认的标题和可访问站点 label 查找控件，不绑定新增内部 ID 或函数名。jsdom 使用模拟 options origin 以支持 localStorage，并用最小有效空 IndexedDB 记录完成原有导航设置初始化；没有使用真实扩展页面隔离环境。
- 多标签上下文共享存储对象和 storage 事件；“重开”通过保存存储副本并重建事件、JS 与 DOM 上下文模拟，不代表真实浏览器退出/重启或 Chrome 存储耐久性验证。

## TC 到自动化断言

测试名均以完整 TC-ID、场景编号和站点输入名开头，以下后缀可用于最窄筛选。

| TC-ID | 场景 | 自动化名称/断言 | 尚需真实浏览器的判据 |
| --- | --- | --- | --- |
| TC-01a07543-5a84-7268-83ed-ebe9a540e9be | S-01 | 首屏图片封面不可见且原文字保留；媒体独占固定高度和比例容器释放样式约束。隐藏和容器约束分开判定，比较加载前文字，保留 B 站封面共同父容器内统计文字及其可见性 | 实际元素矩形、相邻位置、瀑布流空白、四站在线结果 |
| TC-01a07543-5a85-7349-9126-28434946fe97 | S-02 | 头像和混排多图全部隐藏且统计作者摘要可见，检查祖先样式，不能只保留 textContent | 原站多图类型与真实空间收起 |
| TC-01a07543-5a86-7205-a273-4892fe4902aa | S-03 | 原文字链接目标焦点及点击未被拦截；title/author href、target 与可见性不变 | 实际键盘 Enter、新标签导航及浏览器点击命中测试。该局部不以媒体隐藏成功为前置，因此缺失功能时也可直接通过 |
| TC-01a07543-5a87-7de0-b7e4-acd3a543f0b1 | S-04 | 自动预览被暂停且重复 play 事件不能恢复；使用有状态播放 stub，不能仅静音通过 | 真实悬停/视口触发、视频时间推进、实际带音轨输出 |
| TC-01a07543-5a88-76be-8e60-6877c941eaa7 | S-05 | 新增延迟 src 更新替换预览与复用节点继续处理；保持插入前文字/入口快照；更新与复用后检查媒体容器高度和比例解除 | 真实原生分页与懒加载、瀑布流定位、音轨 |
| TC-01a07543-5a89-740d-9cb0-9ab1094befb9 | S-06 | pushState、筛选 replaceState、popstate 后替换当前结果；分别保存路由前旧结果与插入前新结果的文字/入口快照，并检查媒体容器高度和比例解除 | 原站搜索词与分类/排序交互、浏览器真实前进后退 |
| TC-01a07543-5a8a-7c5a-aa3b-1333dd4bcb91 | S-07 | 纯文字和无结果提示保留且不主动加载；无结果之后出现媒体仍被处理。两个独立测试区分直接通过与缺失处理行为 | 原生空结果和推荐边界、真实网络来源归属 |
| TC-01a07543-5a8b-796f-be91-2abcc54f9e8e | S-08 | 直接详情文档中的媒体可见并允许用户 play，不被暂停或静音 | 真实入口打开当前页/新标签、实际详情观看和音轨；本局部单独验证详情安全边界，不证明完整搜索→详情链路 |
| TC-01a07543-5a8c-7d24-8322-79a51f49a6bc | S-09 | 详情弹窗允许播放且动态背景结果继续屏蔽；延迟详情图片保持可见；背景文字/入口保持且媒体容器高度和比例解除 | 各站原生支持的弹窗形式及真实详情/背景音轨区分。这里是代表结构的 DOM 弹窗隔离，不宣称所有站原生均有弹窗 |
| TC-01a07543-5a8d-7139-9902-83790c4f8d9c | S-10 | 关闭详情和恢复搜索后复用及新结果继续处理；路由恢复、pageshow persisted、再次 play 与新增结果；小红书追加遮罩先变为 aria-hidden、详情 pathname 暂留超过旧350ms、feeds-container 整体重建、随后 popstate 的连续性回归，并验证转入另一非搜索 pathname 时撤销保护 | 实际 BFCache、跨域后退、节点从结果迁为详情后恢复、重复真实观看；小红书关闭时序是线上故障的离线可复现模型，仍需真实浏览器 DOM 与逐帧绘制轨迹验证；B 站同文档路由用同源模拟地址，不冒充真实跨域导航 |
| TC-01a07543-5a8e-77e3-aea9-9eae8e471cbf | S-11 | 同站非搜索媒体不处理；搜索内头像与结果外账户标识隔离，分别独立测试 | 真实站点结果边界及所有非搜索页面类型 |
| TC-01a07543-5a8f-72ba-b31c-1a8eaa43e99b | S-12 | 静置与 DOM 更新无 fetch/XHR/beacon、模拟滚动、加载点击或额外 runtime 动作；用户原生加载按钮仍可点击 | 真实页面完整请求与动作来源、浏览器布局收起是否间接触发站点懒加载 |
| TC-01a07546-cca1-7540-8346-f6107840ac94 | S-13 | UA 总开关、单站 UA、uiTransform、三者全关四种状态分别检查动态媒体、播放 stub、UA 原值不变、没有 UA 写入及 reload/加载动作 | 安装扩展后的真实 storage/background/DNR/tab 联动、浏览器导航轨迹、真实音轨 |
| TC-01a07553-0f53-7e42-88d9-38633641daa4 | S-14 | 四域名无媒体存储时直接进入搜索即隐藏/收起/暂停；真实 options 的独立区域与四站可访问 label 显示默认开启，共 5 项 | 真实首次安装、四站在线默认行为与浏览器布局/音轨 |
| TC-01a07553-0f54-7e5c-96b4-dc3c654eb9a7 | S-15 | 四站轮流关闭：目标两标签恢复媒体及原生 width/height/aspect-ratio 等样式，新结果和再次触发的预览可用；其余三站保持；页面自行添加的样式不被覆盖，共 4 项 | 真实 Chrome 跨标签事件与固定/比例/瀑布流矩形恢复、原站预览触发 |
| TC-01a07553-0f55-784e-a133-bfb6074b8cb1 | S-16 | 四站各自重新开启，覆盖关闭期间已有结果、延迟加入媒体、站内搜索后新结果及再次关/开；文字链接快照与容器约束检查，共 4 项 | 原站动态/复用结果、浏览器布局与音轨 |
| TC-01a07553-0f56-72d5-b396-791fa04fb09a | S-17 | 顺次修改不同站点，保留两个开/两个关；关闭 options 后复制存储并重建上下文，重开 UI 与四站内容一致，UA 不变，共 1 项 | 真实浏览器退出重启、真实 chrome.storage 持久化；当前仅模拟存储/context 重建 |
| TC-01a07553-0f57-71e3-8825-64900a448d94 | S-18 | 详情页/详情弹窗两种组合切换当前站和其他站；搜索即时变更，详情保持连接/可见/播放位置/未静音/无额外 pause，UA 写入与导航无变化；原 UA 控件操作消息与相同配置的新 options 对照一致，共 2 项 | 实际详情进度、音轨、reload、浏览器弹窗及 background/DNR 链路 |

## 最窄运行与结果分类

运行目录必须在当前 D 盘工作区；`TEMP`、`TMP` 及日志使用本轮 E 盘产物目录。无需安装项目依赖。

```powershell
$env:MYSEARCHPAGE_JSDOM_MODULE = '<existing-toolchain>/node_modules/jsdom/lib/api.js'
$env:TEMP = '<task-artifacts-on-E>/tmp'
$env:TMP = $env:TEMP
node --test --test-reporter=tap tests/extension-search-media.test.js
```

可使用 `--test-name-pattern 'S-04 bilibili'` 等执行单项。

- `BEHAVIOR_FAILURE`：已成功执行内容脚本和 fixture，结果仍可见、容器仍保留固定尺寸或预览仍播放，属于目标行为缺失。
- 直接通过：文字入口、纯文字/空结果、详情、非搜索范围与无额外请求等不变量在基线已经满足，不人为制造 RED。
- `EXECUTION_ERROR`：依赖不可用、脚本执行/DOM 运行错误、缺少有效 fixture 等，不算行为 RED；Node runner 的断言状态需结合错误消息识别。
- 真实浏览器在线验证：本轮已收到自动审批拒绝，当前为 `blocked by policy`；未更换方式重试。jsdom 结果不能消除这一证据缺口。

2026-09-06 基线完整最窄运行：95 项，25 直接通过，70 行为失败，0 执行错误、0 跳过，退出码 1，耗时 88.3 秒。失败为结果 picture 仍可见、媒体独占容器仍保留固定高度/比例，以及结果 video 未暂停。每种站点输入各 19 项：14 行为失败、5 直接通过。直接通过对应 S-03、S-07 的纯文字/空结果子项、S-08、S-11 的非搜索子项、S-12。

RED 原始日志：`E:/Users/can/.codex/artifacts/mysearchpage-search-media-20260906/red.log`。产品开始修改后不得覆盖该日志。测试与 fixture 的 `node --check` 已通过。

独立审核修正后，最窄运行 `--test-name-pattern 'S-(05|06|09|10) '`：20 项全部为媒体仍可见的行为失败，0 执行错误，退出码 1，耗时 34.8 秒。修正为处理前快照与动态/返回场景的容器尺寸约束断言，未修改需求或产品。日志：`E:/Users/can/.codex/artifacts/mysearchpage-search-media-20260906/red-core-corrected.log`。原始 `red.log` 保留。

设置批最窄运行 `--test-name-pattern 'S-1[4-8] settings:'`：16 项行为失败，0 直接通过、0 执行错误、0 跳过，退出码 1，耗时 8.2 秒。4 项为无媒体配置时结果 picture 仍可见；12 项为真实 options 缺少确认的“搜索结果图片与预览”区域标题。后续切换链路断言已实现，但这一轮因入口缺失尚未执行到，不宣称已经独立证明所有开关缺陷。

设置 RED 日志：`E:/Users/can/.codex/artifacts/mysearchpage-search-media-20260906/red-settings.log`。执行期间 revision 为 `f16c2d36d867594a737732e87557333fd6891c65`，工作区有先前未提交变更；manifest 与 content/options/shared 文件哈希在 2026-09-06 14:21:38～14:21:46 运行前后保持一致，未将并行写入或语法错误当作 RED。证据：`E:/Users/can/.codex/artifacts/mysearchpage-search-media-20260906/red-settings.evidence.json`。本批只追加测试与映射，核心 95 项未改。

设置审核修正 S-18：操作序列的目标站预期独立固定为 `false → true → true`，每步分别核对目标站存储与搜索结果行为，不再用产品实际存储值决定页面期望。最窄 `--test-name-pattern 'S-18 settings:'` 为 2 项行为失败、0 执行错误，耗时 2.3 秒，仍因确认的设置区域未实现而失败。日志：`E:/Users/can/.codex/artifacts/mysearchpage-search-media-20260906/red-settings-s18-corrected.log`。

首版核心产品验证只运行 `--test-name-pattern 'S-(0[1-9]|1[0-3]) '`，共 95 项：78 通过、17 行为失败，耗时 100.6 秒。B 站、YouTube 桌面、YouTube 移动各 18/19，通过范围以 fixture 为限；各自 S-11 在非搜索主页地址仍隐藏相似卡片结构媒体。抖音代表结构 5/19，14 项为结果媒体仍可见、固定尺寸/比例未解除或播放 stub 未暂停；小红书代表结构 19/19。没有运行 S-14～S-18，未将默认/UI 未实现计入核心失败。

该轮还发生 95 条测试结束后异步活动错误：`TypeError: Cannot read properties of null (reading '_location')`，触发点与 jsdom 上下文销毁相关；属于执行/环境收尾问题，独立于上述 17 项行为断言失败，不能报告本轮“0 执行错误”。日志：`E:/Users/can/.codex/artifacts/mysearchpage-search-media-20260906/core-first-product-run.log`。哈希证据：同目录 `core-first-product-run.evidence.json`，2026-09-06 14:29:29～14:31:10 执行期间 manifest/content/shared 保持一致。

经主线程授权，harness 的收尾已修复：保留并记录真实 jsdom `MutationObserver` 实例；仅在行为断言完成后的 after hook 断开观察器并清理本窗口 timeout/interval/animation-frame，再让已排队微任务在仍有效的文档上完成，最后关闭窗口。待处理的运行期 DOM/script 错误仍会显式抛为 `EXECUTION_ERROR`；没有要求产品监听自定义测试事件，也没有更改 TC 行为断言。

同一个最窄用例 `--test-name-pattern 'S-01 bilibili: 首屏图片'` 的前后对照：修复前行为断言通过，但销毁产生 `_location` 异步错误，runner 文件级失败、退出码 1；修复后该行为用例 1/1 通过、0 行为失败、0 执行错误、退出码 0，耗时 1.9 秒。日志分别为 `core-harness-before.log`、`core-harness-after.log`，位于上述 E 盘任务产物目录。此轮未重复运行 111 项或其他回归。

最终产品冻结后的完整回归 `node --test --test-reporter=tap tests/*.test.js` 共 173 项，111 项新增测试全部通过；现有回归 60/62 通过，只有 TC-RUNTIME-002、TC-RUNTIME-008 的旧 VM 缺少 `location` 全局而发生执行错误，没有行为断言失败或销毁异步错误。耗时 168.7 秒，日志与哈希证据为同目录 `full-validation.log`、`full-validation.evidence.json`，39 个产品/测试文件在运行前后未变。

随后经授权仅适配 `tests/extension-local-history-and-ua.test.js` 的 harness：按 manifest 顺序加载所有 URL 匹配 entry，补齐共享 `location`/`URL`、storage 读取与 onChanged、queueMicrotask 及可清理计时器；不跳过新增媒体脚本，原有 TC 与行为断言未改。现有空 DOM fixture 继续用于无结果媒体的主页/详情 UA 场景，不将它作为搜索媒体测试证据。

最窄 TC-RUNTIME-002/008 为 2/2 通过；受影响旧文件完整运行共 21 项（包含子测试），21/21 通过、0 行为失败、0 执行错误、退出码 0。最窄日志为 `legacy-vm-focused.log`；最后状态的完整日志与产品哈希证据为 `legacy-vm-full-final.log`、`legacy-vm-full-final.evidence.json`，前一次同样通过的 `legacy-vm-full.log` 与证据保留。31 个产品文件既与运行前一致，也与上次完整回归冻结快照一致；该次测试文件运行前后哈希一致，语法检查通过。依主线程授权未重复运行此前通过且产品未变的 111 项及其他 41 项回归。

## S-19 真实扩展重载回归

独立入口 `tests/extension-search-media-reload.browser.cjs` 对应 **TC-01a075d4-7247-7610-8711-52d5eb4d3283**，不匹配默认 `tests/*.test.js`。四个目标各执行 A（`true → chrome.runtime.reload() → false → true`）和 B（`false → chrome.runtime.reload() → true`），共 8 个主场景；每个场景聚合行为断言并继续后续观察，控制链路无法继续时单列 `EXECUTION_ERROR`。

| 目标输入 | A/B | 详情覆盖 |
| --- | --- | --- |
| B 站 HTTP 卡片层级及代表媒体扩展 | 各 1 项 | 同站独立详情文档持续播放 |
| 抖音代表卡片 | 各 1 项 | 详情弹窗保留搜索背景，`pushState` 改为详情 URL |
| YouTube 移动 YTM 代表卡片 | 各 1 项 | 同站独立详情文档持续播放；本批不重复桌面 YTD |
| 小红书代表卡片及绝对定位布局 | 各 1 项 | 详情弹窗保留搜索背景，`pushState` 改为详情 URL |

- 真正使用 `--load-extension` 加载当前 `extension`，由真实 manifest 自动注入内容脚本；等待新的 service worker 对象与同一扩展身份恢复，再访问真实 options 页并操作可访问站点复选框。没有注入产品脚本、调用产品内部控制器、自定义重载事件或模拟 `storage.onChanged`。
- 存储期望由明确操作序列独立维护。每个重载后/切换后观察点核对完整四站对象、目标开关、原旧标签、每步通过真实加载按钮增加的新卡片，以及当时新开的搜索标签。另一站分别取开启/关闭作隔离对照；所有 UA 开关均关闭，并核对 UA 存储和页面 UA 不变。
- 比较旧标签/详情的 fixture 文档标识、原 `document` 引用、URL 和导航记录，禁止通过刷新或替换用户页面通过；同时记录旧/新隔离世界的真实 `runtime.id`，但不把内部全局存在当成行为成功条件。
- 关闭时与未匹配扩展域名的同内容原生浏览器页面比较媒体可见性、卡片和容器矩形、比例及定位；开启时独立检查媒体隐藏、卡片高度和容器收起。每个旧/动态/新卡片的文字与链接目标、target、实际可见性均与原生对照比较。小红书另检查瀑布流保留高度。
- 结果预览和详情使用真实 `canvas.captureStream()` 与 WebAudio 生成的音视频轨，真实调用 `HTMLMediaElement.play()`；不替换播放 API。预览检查 paused/muted/autoplay 和存活音视频轨，关闭时还需 currentTime 推进且存在音频信号。详情逐点核对 currentTime 连续增长、pause 事件计数不增加、未静音及音轨信号，并保留同内容原生详情播放对照。headless 不断言实际扬声器硬件输出、四站真实播放器或在线内容解码。
- HTTP(S) 仅精确匹配本地 fixture 文档时 `route.fulfill`，其余请求全部 `abort`，另以 DNS 规则阻止外网。页面图片使用内嵌 data URL，媒体使用本地 MediaStream；fixture 的加载按钮只追加已知本地卡片。非授权资源请求、额外导航、非可信加载按钮动作均留证并检查，不把此局部模型描述成四站全部原生请求归因已验证。
- profile、临时目录和日志按每次运行唯一目录隔离。运行结束先关闭自建 context，解析实际路径并确认在本次产物目录后清理 `profile` 和 `temporary`；保留 `report.json`、`events.jsonl`、`run.log`。报告含产品全文件及测试文件运行前后 SHA-256，不触碰用户浏览器配置。


在 D 盘工作区单独运行（使用现有工具链，不安装依赖）：

```powershell
$env:MYSEARCHPAGE_PLAYWRIGHT_MODULE = '<existing-toolchain>/node_modules/playwright'
$env:MYSEARCHPAGE_CHROMIUM_BINARY = '<existing-browser>/chrome.exe'
$env:MYSEARCHPAGE_BROWSER_ARTIFACTS = '<task-artifacts-on-E>/s19-browser-red'
$env:TEMP = $env:MYSEARCHPAGE_BROWSER_ARTIFACTS
$env:TMP = $env:TEMP
node tests/extension-search-media-reload.browser.cjs
```

本批只证明真实扩展生命周期与代表 DOM 输入的组合，不补足四站线上结构或用户实际失败网址的证据缺口。已有单 B 站诊断 RED 为辅助证据，不代替本批四站 A/B 的自动断言。

## S-10 小红书返回首帧真实 Chromium 回归

`tests/extension-search-media-return.browser.cjs` 使用真实 Chromium、真实
`--load-extension` 和当前 manifest 内容脚本，离线模拟小红书同文档详情返回。
它不替换 MutationObserver、history、requestAnimationFrame 或样式 API。

逐帧覆盖：

- 关闭处理器执行前；
- 遮罩删除、结果根整体重建后的同一 JavaScript 任务；
- URL 仍为详情路径的首个动画帧；
- 搜索 URL 同步恢复；
- 搜索路径首个动画帧；
- 首帧内再次同步插入新卡片；
- 临时 FLIP 克隆存在及删除后的连续动画帧；
- 转入另一非搜索路径后的保护解除。

fixture 同时创建继承原卡片属性的脱离结果根克隆、放大 transform，并在浏览器支持时调用
`document.startViewTransition()`。每个检查点保存 DOM/矩形/计算样式和页面截图；断言结果根保持
flex 布局、选中及周围卡片媒体始终不可见、卡片不放大、命名 View Transition 快照不生效，
且搜索路径至少完成一个受保护绘制帧后才解除静态保护。

```powershell
$env:MYSEARCHPAGE_PLAYWRIGHT_MODULE = '<existing-toolchain>/node_modules/playwright'
$env:MYSEARCHPAGE_CHROMIUM_BINARY = '<existing-browser>/chrome.exe'
$env:MYSEARCHPAGE_BROWSER_ARTIFACTS = '<task-artifacts-on-E>/xhs-return'
$env:TEMP = $env:MYSEARCHPAGE_BROWSER_ARTIFACTS
$env:TMP = $env:TEMP
node tests/extension-search-media-return.browser.cjs
```

该测试仍是离线真实浏览器时序模型，不冒充用户当前线上页面的完整 DOM 取证。
