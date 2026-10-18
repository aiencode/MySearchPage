# 搜索词阻断消融记录

## 范围与结论

本轮只收敛搜索词阻断。删除控制器和后台中的重复 URL 解析、误导性的 YouTube 专用命名、重复关键词/URL 判断和事件祖先遍历。保留四站必要的域名、搜索路由、参数名和输入框选择器配置。

当时未修改搜索媒体隐藏、主页权限策略、UA、浏览层级开关、样式或搜索打开/历史记录流程；未更新 `dist/` 或 ZIP 安装包。现行规则命中后仅即时阻断，页面关卡持续有效，无等待时间、图片或声音。

完整读取后的事实修正：旧 `findYouTubeSearchKeywordMatch` 名称虽是 YouTube 专用，内部已经调用四站取词函数。旧实现的问题不是“四站全都各写一套”，而是部分通用代码与专用解析、后台解析及原生搜索框分支并存，且行为不一致。

## 保留的单一实现

- `extension/shared/blocking-rules.js`
  - `SEARCH_SITES`：只配置域名、搜索路径/主机、URL 参数、搜索输入框与容器。
  - `isSearchUrl` / `searchTextFromUrl`：共用路由识别，解码各站搜索词；不把详情页查询参数当成搜索词。
  - `findSearchMatch`：复用字面关键词、URL 和主页规则匹配，保留关键词列表优先级。
  - `getSearchRulesFromStorage`：仅为兼容搜索入口读取内容规则及显式主页权限；原有规则存储、导入导出接口不变。
- 控制器：使用通用函数名；搜索框不再被局部内容扫描替换；提交只依据实际事件目标（包括 Shadow DOM 的实际目标），不向上遍历整条事件路径借用别处搜索值。
- 后台和两个旧后台兼容入口：共用搜索匹配器。兼容入口保留打开方式、会话与返回结构，读取显式主页权限，避免高风险名单覆盖“允许主页”的配置。

历史消融记录显示，四个生产文件增加 128 行、删除 253 行，净减少 **125 行**（按文本行比较，忽略换行编码差异）。其中控制器减少 146 行、后台减少 46 行、导航页减少 28 行，共享规则增加 95 行。

## 消融前后对照

当时同一组 `^ablation` 用例分别运行于消融前与收敛后的源码，其他夹具保持相同；以下保留有效搜索逻辑的历史对照结果，不要求保留源码副本：

| 验证 | 消融前 | 收敛后 |
|---|---:|---:|
| 17 项行为测试 | 9 通过 / 8 失败 | 17 通过 / 0 失败 |
| 1 项重复/专用实现结构检查 | 失败 | 通过 |
| 总计 | 9/18 | 18/18 |

消融前失败包括：

- 后台仅从 YouTube URL 补取搜索词，抖音、小红书的编码 URL 与内容侧判定不一致。
- B 站 `search.bilibili.com/all` 缺少取词及搜索页识别。
- 仅注入阻断模块时，带屏蔽词的搜索输入框会被局部扫描替换，导致原生提交无法取得搜索值。

消融后保留与新增的负例：普通搜索、普通详情、未知/伪装域名、非法 URL、关闭阻断、同页无关表单、嵌套无关表单、空搜索路由、移动/旧版路由、相对 URL、字面大小写和规则优先级。

一次限定只读审查发现两个边界问题：祖先事件借值和兼容入口遗漏主页权限。新增 3 项回归，修复前 0/3，通过修复后 3/3；未开启第二轮审查。

## 最终验证

- `tests/extension-search-blocking-ablation.test.js`：**27/27 通过**，其中原始对照矩阵 18 项，额外边界 9 项。
- 当时相关回归合计 **204/204 通过**，包括阻断、主页权限、小红书卡片、原生搜索保护、设置、manifest 和搜索重定向等；这是历史运行总数，不代表本轮即时阻断改动的重新验收结果。
- 8 个修改的 JS/测试文件执行 `node --check`，全部通过。
- 对本轮新增/替换源码行检查尾部空白，未发现问题。
- 小红书和新 DOM 夹具关闭前断开观察器并等待队列清空，修复 jsdom 销毁后的异步错误；不改变产品生命周期逻辑或行为断言。

扩大运行 `tests/extension-local-history-and-ua.test.js`：20/22 通过，以下 2 项在消融前源码对照中也同样失败，未修改无关功能：

1. `navigation keeps one input handler for object history and focused search entry`：仍断言旧 `handleMySearchFocusHash` 函数形状。
2. `TC-RUNTIME-002`：断言不存在任何声明式 CSS，但现有 manifest 已包含 `native-search-redirect.css`。

## 复现

需要 Node.js 与 jsdom；本轮 jsdom@26 安装在会话临时目录，未修改项目依赖配置。

```sh
# JSDOM_MODULE 指向已安装的 jsdom 模块目录
export MYSEARCHPAGE_JSDOM_MODULE="$JSDOM_MODULE"
node --test tests/extension-search-blocking-ablation.test.js
node --test \
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

消融前矩阵仅作为历史结果保留，不再提供依赖旧源码副本的复现步骤。上一轮会话 scratch 的临时源码副本已清除，本轮不创建或保留任何源码或资源备份；上面的命令仅用于验证当前搜索逻辑。含旧源码正文的错误日志也已清除，历史结果以本记录中的摘要为准。

## 证据边界

这些结果证明本地规则与代表 DOM 夹具行为，不等于四站实时页面或浏览器商店安装包的线上兼容性验证；未执行线上浏览器验收、性能测量或打包。
