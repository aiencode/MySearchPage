# 主页权限与小红书搜索误屏蔽：开发回归 Test Case

## 1. 目的与范围

本文件是本对话修复的可执行验收清单，覆盖：

1. 网站设置的“屏蔽主页”列：**勾选屏蔽、取消恢复**，同域同步和持久化。
2. 主页的网络/页面双层控制，以及取消屏蔽后恢复已被阻止的首页。
3. 小红书所有普通关键词搜索被误替换为“空白页＋顶部已屏蔽控件”的缺陷。
4. 正常搜索、详情、历史/收藏入口和其他网站不被主页规则误伤；真正命中的内容仍屏蔽。

不包含 ChatGPT/Computer Use 插件、SSH 凭据、搜索媒体产品新需求，不以关闭屏蔽或重置用户配置作为修复方法。

## 2. 公共前置与测试数据

- 自动化使用**隔离浏览器资料**、离线站点 fixture 与当前 `extension/`。不得连接用户 Chrome 资料来覆盖规则或清除登录状态。
- 设置测试从导航页实际“设置”入口打开 `options/options.html` 的网站表格，不使用导航页残留旧表格。
- 普通搜索词：`picot`、`资料检索`、`冷压端子`。测试内容关键词：`BLOCKME`；作者：`BLOCKAUTHOR`；网址：`/explore/blocked-note`。
- 普通小红书笔记链接：`/explore/safe-note`；主页：`/explore`。带笔记 ID 的 `/explore/<id>` 是详情，不是主页。
- 小红书搜索 URL 两种路径均覆盖：`/search_result?keyword=<编码后的词>&type=51` 与 `/search_result/?keyword=<编码后的词>&type=51`。
- 执行时记录源码版本/提交、视口、操作步骤、实际 URL、用例 ID 和结果。正文里提到的“三次/两批”等是固定轻量回归数据，不是压力测试。

## 3. 主页权限 Test Case

### TC-REG-HOME-001：实际设置表格、默认值与勾选方向

**前置：**隔离新资料，旧配置没有 `allowHomepage`；另备已有显式 true/false 的配置。

**步骤：**打开实际扩展设置页，查看第 7 列与总列数；观察 B 站、抖音及普通网站；再加载显式配置重开设置。

**预期：**总计 8 列，第 7 列为“屏蔽主页”。B 站/抖音缺省勾选，其余缺省不勾选；已有值不重置。checked 与存储 `allowHomepage` 取反。

**代码映射：**`extension-options-navigation-settings.test.js` 的 `TC-HOMEPAGE-001`；`extension-homepage-blocking.test.js` 的 `explicit homepage permissions override...`；`extension-homepage-blocking.browser.cjs` 的 `actual eight-column settings table and domain defaults`。

### TC-REG-HOME-002：逐站切换、同域同步及字段保护

**前置：**一个网站有搜索/历史/收藏等同域行；已有 enabled、UA、自定义 UA 等字段；表格有尚未保存的名称编辑。

**步骤：**过滤使同域部分行隐藏；取消一行的主页勾选，再勾选；检查隐藏同行、存储、重开后的状态和未保存编辑。

**预期：**只修改目标域 `allowHomepage`，同域所有行即时一致；不覆盖其他域、UA/额外字段，不顺带保存其他表格编辑。取消代表允许，勾选代表禁止。

**代码映射：**设置套件 `TC-HOMEPAGE-002`；主页浏览器脚本 `checked blocks, unchecked restores existing homepage and updates same-domain rows`。

### TC-REG-HOME-003：保存、导入导出与旧配置兼容

**步骤：**设置不同域的允许/禁止值，保存、重开、导出；导入另一份测试资料；导入同域不同值的配置与缺少字段的旧配置。

**预期：**Chrome 存储与 IndexedDB `siteFlags` 均保留字段；导入导出不反转权限。同域冲突遵循既有首行归并约定，false 不被当作缺省值丢弃；即时存储不被旧 IndexedDB 覆盖。

**代码映射：**设置套件 `TC-HOMEPAGE-001`、`TC-HOMEPAGE-003`、`TC-HOMEPAGE-004`。其断言包括真实控件流程和持久化，不只是扫描源码。

### TC-REG-HOME-004：主页 URL 与搜索/详情严格隔离

**前置：**主页禁止；分别开/关内容规则和 UA 开关。

**步骤：**访问 B 站根路径、移动首页、抖音 `/jingxuan`、小红书 `/explore`；再访问合法搜索和详情、作者/历史/收藏入口；在首页加假的 keyword 参数再试。小红书逐个执行三个词及两种搜索路径。

**预期：**主页 main_frame 被拒绝，搜索/详情不被主页规则拒绝；假搜索参数不能伪装主页。主页规则不依赖 UA 或内容开关，不拦脚本/图片/API 等子资源；真实关键字/网址规则仍独立有效。

**代码映射：**主页单测 `TC-REG-HOME-004` 参数化 6 项、`network permissions block only homepage main documents...`、`background rejects a denied homepage even when keyword blocking is off`、`explicit keyword and URL rules keep priority...`；主页浏览器的 URL 矩阵、Chrome RE2 校验和独立开关场景；小红书浏览器末尾主页拒绝断言。

**边界：**离线历史/收藏入口测试只证明路径没有被主页分类拒绝，不证明站点服务器能返回用户数据。

### TC-REG-HOME-005：取消勾选恢复网络错误首页，非首页标签不刷新

**步骤：**先使首页进入 `ERR_BLOCKED_BY_CLIENT`，保留同域搜索、详情、用户/收藏入口及其他域标签；取消勾选；连续完成三轮禁止/允许。

**预期：**先成功撤销网络规则，再恢复目标域的首页标签（含 `pendingUrl` 指向首页的错误页）。搜索/详情/集合入口保持状态；其他域和 discarded 标签不刷新；不会为了恢复首页自动清除显式封禁。

**代码映射：**主页单测 `releasing homepage permission reloads only that homepage...`、新增 `TC-REG-HOME-005` 小红书矩阵；主页浏览器三轮错误页恢复且 `keepSearchState` 保留。

### TC-REG-HOME-006：规则更新失败必须回滚，而不是假成功

**步骤：**在测试夹具中令主页权限更新或 DNR 更新报错；观察控件/存储/响应；随后恢复服务重试。

**预期：**返回明确错误；同域复选框和旧规则恢复；失败时不恢复标签页、不宣称保存成功；后续重试可成功。并发 DNR 更新按串行执行，不能互相覆盖。

**代码映射：**设置套件 `TC-HOMEPAGE-005`；主页单测 `dynamic network updates are serial...` 与 `failed homepage release restores saved permission...`。

### TC-REG-HOME-007：已打开页和 SPA 进出主页

**步骤：**在可访问的搜索页内通过站点 SPA 路由进入主页，再返回搜索/详情；在首页打开时切换主页权限。

**预期：**主页进入既有整页关卡；返回合法非首页或重新允许主页后释放关卡。提示未变时不重复写 `textContent`，不因自身 MutationObserver 进入自触发循环。

**代码映射：**主页单测 `homepage match enters the existing persistent page gate...`、`new homepage permission releases...`、`page-gate notice updates are idempotent...`；主页浏览器 SPA 与打开页切换场景。

### TC-REG-HOME-008：设置页响应式布局不丢列/控件

**步骤：**按 1200px、768px、390px 宽度打开设置页，检查主页列及复选框。

**预期：**仍为 8 列；复选框宽/高按既有规范为 18/20/18px；表格容器允许横向滚动，标签不需改变字号才能容纳。

**代码映射：**设置套件 `TC-HOMEPAGE-006` 和主页浏览器三视口检查。实际线上站点移动 UI 不包含在此设置页测试中。

## 4. 小红书误屏蔽 Test Case

### TC-REG-XHS-001：三个合法关键词均有可用搜索主体

**前置：**小红书主页禁止、内容规则启用、UA 关闭；普通词不在内容黑名单。

**步骤：**逐个打开三词的搜索 URL；在 1200/768/390px 下等待规则实际执行（不是只检查运行时标记）；刷新再执行。

**预期：**应用根、搜索宿主、结果列表存在且可见，不进入整页关卡；普通笔记有原始标题与详情 href；URL 不被替换为首页。导航中的首页控件允许局部显示“已屏蔽”，不得连带搜索主体。

**代码映射：**小红书单测三个 `Xiaohongshu startup homepage navigation...`；小红书浏览器三词 × 三视口 × 两次加载，`assertSearchShell` 与普通卡片可见断言。

### TC-REG-XHS-002：首屏空壳与多层无语义壳不能升级为卡片

**步骤：**先只挂载首页 SVG 链接和空宿主，不挂结果根；分别使用 `#app`、内部 `.container` 和三层没有 app/main/search 类名的普通 div；稍后挂载结果。

**预期：**页面根、父布局和宿主不带 `data-mysearch-blocked-card`；首页链接只处理自身，不能凭“图标＋链接＋文字”向上猜整个页面是内容卡片。

**代码映射：**既有结果根/布局/内部壳单测、新增 `TC-REG-XHS-002`；小红书浏览器在 `#home` 局部占位出现后明确检查搜索壳仍存活。

### TC-REG-XHS-003：真正命中内容仍只屏蔽一张笔记

**步骤：**同一结果根放一张普通笔记与一张命中笔记；分别设置关键词 BLOCKME、网址 `/explore/blocked-note`、作者 BLOCKAUTHOR。

**预期：**命中笔记成为单个占位，原始标题、媒体、作者及可点击目标消失；普通笔记标题、图片 DOM 和详情 href 保留；结果根、应用根不被替换，不出现整页关卡。

**代码映射：**新增 `TC-REG-XHS-003` keyword/url/author 三项与既有 `Xiaohongshu result-root and layout...`；浏览器关键词命中断言。作者/网址三分支由 Node DOM 测试覆盖，不宣称已在真实线上测试。

### TC-REG-XHS-004：后续多批结果与刷新不得退化成空白页

**步骤：**单测分三批、浏览器分两批插入普通和命中笔记；每批等到命中占位出现后再检查之前普通笔记；浏览器刷新后重新挂载再检查。

**预期：**已有普通笔记持续可用，新命中只替换自身；占位数等于命中卡片数，无原始可点击链接残留；根结构始终不被替换，无 pageerror。

**代码映射：**新增 `TC-REG-XHS-004`、小红书浏览器 `batchesPerLoad: 2` / `loads: 2`。有限步骤通过不等同于性能/长稳测试。

### TC-REG-XHS-005：详情页不被主页/结果卡片逻辑误删

**步骤：**访问 `/explore/safe-1`，页面标题为普通笔记、详情正文包含 BLOCKME，放在真实详情容器形状中。

**预期：**主页规则允许带 ID 的详情 URL；搜索卡片逻辑不替换详情根、正文或作者入口，不进入主页整页关卡。

**代码映射：**主页 URL 分类单测；小红书浏览器 `TC-REG-XHS-005`。这里不取消独立显式网址/页面标题封禁，也不声明任意命中的详情页面必须绕过全部规则。

### TC-REG-COMPAT-001：其他网站的内容屏蔽形态保持

**步骤：**运行通用内容/iframe 和抖音结果卡片回归；观察普通控件、含共享“直播”徽标的普通视频、明确命中视频。

**预期：**普通内容仍保留；命中内容按既有局部卡片占位，不能扩大成整个结果容器，也不能因小红书兜底调整关闭其他站的屏蔽。

**代码映射：**`extension-blocking-phase1.test.js`、`extension-blocking-global.browser.cjs`、`extension-blocking-douyin-card.browser.cjs`。这是离线结构兼容测试，不是四站线上播放验收。

## 5. 执行命令与依赖

已有兼容的 jsdom、Playwright 和 Chromium 时，从工作区根执行：

```sh
node --test tests/extension-homepage-blocking.test.js \
  tests/extension-xiaohongshu-blocking.test.js \
  tests/extension-options-navigation-settings.test.js \
  tests/extension-blocking-phase1.test.js

node tests/extension-xiaohongshu-blocking.browser.cjs
node tests/extension-homepage-blocking.browser.cjs
node tests/extension-blocking-global.browser.cjs
node tests/extension-blocking-douyin-card.browser.cjs
```

不在项目目录安装另一套依赖。可用环境变量指定会话外置工具链：`MYSEARCHPAGE_JSDOM_MODULE`、`MYSEARCHPAGE_PLAYWRIGHT_MODULE`、`MYSEARCHPAGE_CHROMIUM_BINARY`。浏览器 profile 放在指定的任务临时根（`TMPDIR`）并由脚本 finally 删除；Linux 上需足够短的临时路径以避免 Chromium Unix socket 路径长度错误。

通过条件：上述每条命令退出码为 0，且断言全通过。只看到“通过 N 项”但进程非零仍须排查，不计作通过。保留日志与工具链，不把用户配置/临时浏览器资料提交进仓库。

## 6. 人工线上复核（不与离线证据混用）

经用户授权重载正确的源码扩展并刷新原先已受损页面后：确认当前 URL/关键词、实际普通笔记标题、详情链接和搜索入口；不能只凭 DOM 节点数量判定已修复。主页局部导航占位与搜索主体空白要分开判断；不要为了消除局部占位而取消主页/内容规则。若需要线上真实命中数据，用隔离测试账号和可逆规则，不改用户日常规则。

记录观察过的词/视口/账号状态；未实际执行的线上项注明“未执行”，不能用离线 fixture 结果替代。原修复线上证据只核验保留的 picot 页，本轮新增验证以离线自动化为主。

## 7. 本轮执行记录

- Node 专项：4 份套件共 **145 项通过，0 失败，退出码 0**。其中新增 12 项（主页路径/恢复 7 项、小红书深层壳/三类命中/多批结果 5 项）。
- 小红书真实扩展离线脚本：**通过，退出码 0**。三词 × 三视口 × 两次加载 = 18 次加载，每次两批 = 36 批；另含详情正文/作者入口保留与主页 `ERR_BLOCKED_BY_CLIENT` 检查。详情检查等到夹具中的明确命中探针出现占位后才执行，避免规则尚未加载造成假通过。
- 主页设置/恢复脚本：**通过，退出码 0**；通用屏蔽/iframe 脚本：**通过，退出码 0**。
- 抖音卡片兼容脚本：**未通过，退出码 1**。普通共享徽标卡片保留、关键词命中卡片屏蔽均正确，但既有第 175 行宽度断言失败：原宽 138px，屏蔽后 60px，`--mysearch-blocked-card-inline-size` 为空。当前生产占位样式使用 `fit-content`，与既有保留原宽的断言不一致；该脚本和生产样式均未在本轮改动。不删除/放宽断言，不宣称 TC-REG-COMPAT-001 已全通过，后续应根据现行尺寸约定另行处理。
- 三份变更 JS 文件语法检查通过，Git 差异空白检查通过，14 个自然语言用例编号唯一，任务临时浏览器 profile 无残留。
- 本轮未重跑完整媒体套件或全仓库回归；未操作用户线上站点或日常屏蔽配置。

日志保留在本会话 scratch：`regression-cases-final-core.log` 与四个 `regression-cases-final-extension-*.log`。首次仅 3 套件合跑出现“107 项全通过但进程非零”，分开复跑均退出 0；最终文档所列 4 套件合跑退出 0，以最终结果为准。
