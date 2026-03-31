# MySearchPage 项目规则

## 项目概述

单文件静态网页应用（`mysearch.html`），通过 VS Code Live Server 启动本地开发服务。
地址栏显示 `127.0.0.1:5500` 是 Live Server 扩展的默认行为，与项目代码无关。

---

## 设计系统：尺寸与间距规则

### 1. 核心间距单位

| 场景 | 桌面端（>768px） | 移动端（≤768px） | 超小屏（≤480px） |
|------|------------------|------------------|------------------|
| **主间距（gap / margin）** | `6px` | `2px` | `1px` |
| **次间距（flex1 gap）** | `2px` | `1px` | `1px` |
| **左右内边距（padding-left/right）** | `8px` | `2px` | `1px` |
| **上下内边距（padding-top/bottom）** | `6px` | `1px` | `1px` |

**规则：所有视觉间距统一使用 `6px`（桌面）→ `2px`（移动）→ `1px`（超小）的三级递减体系。**

### 2. 按钮尺寸

| 属性 | 桌面端 | 移动端 |
|------|--------|--------|
| padding | `1px 6px` | `0 2px` |
| font-size | `16px`（!important） | `12px` |
| line-height | `1.2` | `1.2` |
| border | `1px solid #000` | `1px solid #000` |
| transition | `all 0.2s` | `all 0.2s` |

**小按钮（`.small`）：** padding `1px 2px`，line-height `1.2`。

### 3. 搜索输入框

| 属性 | 桌面端 | 移动端 |
|------|--------|--------|
| font-size | `16px` | `12px` |
| padding | `10px 40px 10px 6px` | `2px 26px 2px 2px` |
| border | `1px solid #000` | `1px solid #000` |

**清空按钮（`.clear-input`）：** 桌面 width `36px` / font-size `60px`；移动 width `24px` / font-size `40px`。

### 4. 历史标签（`.history-item`）

| 属性 | 桌面端 | 移动端 |
|------|--------|--------|
| padding | `2px 6px` | `1px 2px` |
| font-size | `12px` | `12px` |
| margin-right | `6px` | `1px` |
| margin-bottom | `6px` | `1px` |
| line-height | `1.2` | `1.2` |
| border | `1px solid #ddd` | `1px solid #ddd` |

### 5. 标题字号

| 元素 | 字号 |
|------|------|
| 按钮文字 | `16px`（桌面）/ `12px`（移动） |
| 历史标签 | `12px` |
| 历史标题（`.history-title`） | `14px` |
| 快速搜索输入（`#quick-search-input`） | `14px`（桌面）/ `12px`（移动） |
| 模态框段落 | `16px` |
| 模态框 h2（移动） | `16px` |
| 模态框 h3 | `14px`（移动）/ `12px`（超小） |

### 6. 表格（设置模态框内 `#sites-table`）

| 属性 | 桌面端 | 移动端（≤768px） | 超小屏（≤480px） |
|------|--------|------------------|------------------|
| 行高 | `24px` | `18px` | `14px` |
| 单元格 padding | `1px` | `1px` | `1px` |
| 单元格 font-size | — | `10px` | `8px` |
| 输入框 height | `20px` | `16px` | `12px` |
| 输入框 font-size | `12px` | `10px` | `8px` |
| 删除按钮 height | `18px` | `14px` | `10px` |
| 删除按钮 font-size | `10px` | `8px` | `6px` |
| 拖拽手柄 font-size | `10px` | `8px` | `6px` |

### 7. 复选框（三状态 / 二状态）

| 属性 | 桌面端 | 移动端 |
|------|--------|--------|
| width × height | `18px × 18px` | `20px × 20px`（≤768px）/ `18px × 18px`（≤480px） |
| font-size | `14px` | `16px`（≤768px）/ `14px`（≤480px） |
| line-height | `18px` | 同 height |

### 8. 模态框

| 属性 | 值 |
|------|-----|
| border-radius | `5px` |
| box-shadow | `0 0 10px rgba(0,0,0,0.3)` |
| 遮罩背景 | `rgba(0,0,0,0.5)` |
| z-index | `1000` |
| 桌面 padding | `20px` |
| 移动端 padding | `4px 8px`（上下4px，左右8px，左右对称） |
| 移动端宽度 | `90vw`，max-width `600px`，max-height `82vh` |

### 9. 高亮与选中状态

| 状态 | border | box-shadow |
|------|--------|------------|
| 高亮（`.highlight`） | `2px solid #2563eb` | `0 0 0 2px rgba(37,99,235,0.4)` |
| 光标高亮（`.cursor-highlight`） | `2px solid #10B981` | `0 0 0 1px rgba(16,185,129,0.5)` |
| 光标高亮+选中 | `2px solid #10B981` | `0 0 0 1px rgba(16,185,129,0.5)` + 背景 `#FFE066` |
| 选中（`.selected`） | — | 背景 `#e0e0e0` |
| 焦点（`:focus`） | — | 背景 `rgba(76,175,80,0.2)` |
| 可编辑（`.editable`） | `2px dashed #000` | 背景 `#fff9f9` |

### 10. 布局对齐规则

- **固定头部（`.fixed-header`）** 的左右 padding 与 **滚动内容区（`.scrollable-content`）** 的左右 padding 保持一致，确保垂直对齐。
  - 桌面：头部 `padding: 6px 8px` ↔ 内容区 `padding: 0 8px`（左右均为 `8px`）
  - 移动：头部 `padding: 1px 2px` ↔ 内容区 `padding: 0 2px`（左右均为 `2px`）
- **所有容器使用 `box-sizing: border-box`**，确保 padding 不影响总宽度计算。
- **滚动内容区高度** 由 JS 动态计算：`calc(100vh - fixedHeaderHeight)`。
- **隐藏滚动条** 但保留滚动功能（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`）。

### 11. 动画与过渡

- 所有交互元素统一使用 `transition: all 0.2s`。
- 拖拽悬停：`transform: translateX(2px)` 或 `translateY(-1px)`。
- 拖拽中：`transform: rotate(2deg) scale(1.02)` ~ `rotate(3deg) scale(1.05)`。

### 12. 响应式断点

| 断点 | 说明 |
|------|------|
| `>768px` | 桌面端，标准间距 |
| `≤768px` | 移动端，间距压缩为 1/3 |
| `≤480px` | 超小屏，极致压缩 |

### 13. 边框规范

| 元素类型 | border |
|----------|--------|
| 主交互按钮 | `1px solid #000` |
| 历史标签 | `1px solid #ddd` |
| 表格输入框 | `1px solid #ccc` |
| 高亮状态 | `2px solid #2563eb`（蓝色）或 `2px solid #10B981`（绿色） |
| 可编辑状态 | `2px dashed #000` |

---

## 开发约定

1. **单文件架构**：所有 HTML / CSS / JS 均在 `mysearch.html` 中，不拆分。
2. **外部依赖仅一个**：`pinyin_dict_firstletter.js`（拼音首字母字典，通过 `<script src>` 加载）。
3. **数据存储**：使用 `localStorage` + `IndexedDB` 做本地持久化，可选同步到 Gitee。
4. **修改样式时**：必须同时检查桌面端和移动端（≤768px）两个媒体查询，保持间距比例一致。
5. **新增按钮时**：遵循 `padding: 1px 6px`（桌面）/ `0 2px`（移动）、`font-size: 16px`（桌面）/ `12px`（移动）的规范。
6. **新增间距时**：优先使用 `gap` 而非 `margin`，统一使用 `6px`（桌面）/ `2px`（移动）。
