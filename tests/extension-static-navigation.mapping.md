# 插件完整导航页迁移：TC-MIG 自动化映射

唯一权威测试用例是 extension-static-navigation-page.e2e.md 中的 TC-MIG-001 至 TC-MIG-011。本映射不保留旧的 TC-FULL、简化版 controller、Gitee 同步、凭据、endpoint/token 或 URL 协议白名单预期。

测试文件：extension-static-navigation.test.js。Node 测试以根目录 mysearch.html、SiteUrls.json、pinyin_dict_firstletter.js 为基线，验证资源、结构、样式与事件绑定/关键调用的迁入；它不执行浏览器 DOM。每一个 TC 仍需要文档规定的两个干净 Chromium 资料做实际差分操作。

| 权威 TC | Node 回归测试 | 自动化证据 | 必须补充的人工差分证据 |
| --- | --- | --- | --- |
| TC-MIG-001 | canonical new-tab and direct entry use navigation.html | MV3 canonical 页面、搜索/设置页面壳、共享本地持久化来源 | 新标签与直接 URL 的搜索、设置、修改后重开一致 |
| TC-MIG-002 | legacy non-Gitee structure and three responsive layout tiers are retained | 原页面静态 HTML 中的非 Gitee ID（不把 JS 动态模板 ID 当作静态页面约束）、原 CSS 迁入 | 769px、768px、480px 截图、顺序、间距、边框、滚动和表格 |
| TC-MIG-003 | legacy default configuration, pinyin resource, and local site state foundation are copied | SiteUrls / 拼音字典逐字节复制、加载、localStorage/IndexedDB/defaults 来源；完整非 Gitee function declaration 清单；DOMContentLoaded 初始化、持久化和动态站点调用链 | 默认站点、导入、编辑、拖拽、重开及站点按钮行为 |
| TC-MIG-004 | main search controls preserve non-Gitee click and keyboard action bindings | 原页主搜索控件的 click/keydown 绑定和关联调用迁入 | 单站、空关键词、多选批量、地址栏、提示、历史 |
| TC-MIG-005 | quick search binds input and Enter to performQuickSearch with pinyin support | 快速搜索 input、Enter、performQuickSearch、拼音、方向键/高亮标志 | 汉字/拼音/多词筛选、光标、滚动、Tab/Ctrl+Tab 和 Enter |
| TC-MIG-006 | handleGlobalKeyDown is document-bound and every legacy shortcut branch retains its action call | document 绑定 handleGlobalKeyDown；以可靠花括号范围提取其函数体后，在同一键值 if 分支检查 key/ctrlKey 条件、旧页有时的 preventDefault 与行动调用；纯焦点/状态分支验证同分支仍有有效语句 | 全部快捷键实际的焦点、排序、选择、编辑、删除、撤销和浏览器默认动作抑制 |
| TC-MIG-007 | GlobalQuit remains the shared desktop Escape and mobile Esc action | Escape 分支、GlobalQuit 与 mobile-esc-btn click 调用 | 主页连续 Escape 状态顺序及移动按钮结果 |
| TC-MIG-008 | history sorting and edit/delete/undo/import/export controls keep their concrete bindings | 五种排序和原页历史编辑/删除/撤销/导入/导出绑定及调用 | 标签、排序、编辑确认/取消、删除、撤销、导入导出文件兼容性 |
| TC-MIG-009 | settings opening, filtering, saving, table drag, tri-state, and local export bindings are retained | 设置打开/筛选、控件状态调用、dragstart/dragover/drop、三态、配置/UA 导出关联绑定 | 设置表格、拖拽、二/三态、保存、配置和 UA 文件 |
| TC-MIG-010 | settings keyboard state machine retains filter, arrows, Enter, Escape, and save action calls | Backspace/F8/四方向/Enter/Escape 分支及调用、模态/筛选状态标志 | 焦点跨行/跨列、保存、不泄漏回主页、三段 Escape |
| TC-MIG-011 | every Gitee surface and generic sync replacement is absent from navigation resources | 导航资源递归扫描任意大小写 gitee，并逐项扫描 sync-gitee、sync-from-gitee、gitee-config、upload-history、download-history、上传/下载配置、giteeConfig、API；generic sync 只检查同步 UI/配置/API 的组合标记，不误禁普通 endpoint/token 字段 | 页面/设置/存储/网络均无 Gitee，且本地功能不抛缺失元素异常 |

运行命令：node --test tests/extension-static-navigation.test.js。
