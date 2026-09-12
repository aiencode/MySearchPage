# 验证范围

- 权威场景为 `.agents/test-cases/extension-search-media.e2e.md`；自动化映射为 `tests/extension-search-media.mapping.md`。
- `tests/extension-search-media.test.js` 包含 111 项测试，覆盖五种 DOM 输入（B 站、抖音、小红书、YouTube 桌面和移动）、动态结果、SPA、详情隔离、文字入口、UA 独立性及设置持久化。2026-09-06 最终产品版本的 111 项全部通过。
- 测试通过真实 manifest 加载产品脚本；DOM 来自 jsdom，媒体播放和 Chrome 存储为可观察模拟。它们不证明四站线上渲染、真实 Chrome 重启持久化或原站全部卡片类型兼容。
- 相关回归合计 173 项分批验证通过：完整运行中新增 111 项和旧回归 60 项通过，旧 VM 的两项因缺少浏览器全局而执行失败；补齐该测试环境并按真实 manifest 加载所有匹配脚本后，受影响旧文件 21 项全部通过。其余 41 项复用前次通过结果，产品文件哈希一致。没有把首次运行的两项执行错误改记为当次通过。
- 本地 Chromium 148 验证使用禁止外网的隔离页面。B 站采用当日 HTTP 卡片片段和第一方 CSS，隐藏前后高度约 185px/90px，文字与链接相同，关闭后原高度及行内样式恢复。小红书代表布局输入验证了收起瀑布流空白及关闭恢复。真实 MediaStream 视频与音轨验证了结果预览暂停静音、移入详情后允许播放。设置区在 1200px、600px、390px 验证了对应间距、控件尺寸和无水平溢出。
- YouTube 移动、小红书的部分结构名称有第一方脚本静态证据；抖音使用代表结构输入。四站完整线上浏览器兼容性尚未验证，不能将上述结果写成线上 E2E 通过。
- 设置页“线上兼容诊断”只提供授权页面取证入口；诊断结果仍需人工审查，不能自动提升为线上通过。


本轮日志与本地浏览器证据保留在 `E:/Users/can/.codex/artifacts/mysearchpage-search-media-20260906/`，主要文件为 `full-validation.log`、`full-validation.evidence.json`、`legacy-vm-full-final.log`、`legacy-vm-full-final.evidence.json` 和 `offline-browser-validation.json`。本地工具链路径不属于产品运行依赖。
