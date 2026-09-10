# 剩余事项

## 扩展重载后的旧标签设置同步

2026-09-06 已用真实 Cent Browser 扩展重载复现：重载后在新设置页关闭 B 站，存储为 `false`，新标签恢复媒体，重载前的旧标签仍隐藏。旧隔离世界的 DOM 逻辑残留，但 `chrome.runtime.id` 已失效，不能再用残留样式证明设置连接有效。证据为本轮产物 `real-extension-reload-toggle/report.json`。S-19 已补入权威 TC，修复与独立回归尚未完成；这一缺陷还不能认定为用户当前四站失效的唯一原因。

修复必须重新连接已打开页面，安全撤销旧实例覆盖并防止新旧实例冲突；不得自动刷新搜索或详情页面。当前已运行旧版本没有销毁入口，首次升级的历史孤儿实例无法凭空恢复其闭包账本，需要如实说明一次性页面重建的迁移限制。

本轮临时现场诊断页位于 `extension/diagnostics/search-media-probe.html`，只读取四目标域名页面的脚本、结构和状态，将报告存入独立的 `searchMediaRuntimeProbe` 键。取证结束后清除该键并回收两份诊断页文件。最近一次现场报告没有目标站标签，正在等待用户保持失效页打开并提供网址。

## 四站线上兼容验证

本地自动化和离线 Chromium 验证已完成已记录范围。完整线上搜索、悬停预览、真实详情导航和各站其他卡片类型尚未实测。此前线上浏览器取证动作被自动审批以 `blocked by policy` 拒绝，未提供具体原因；没有用本地 fixture 结果替代线上通过结论。后续在允许的环境取得真实页面证据，若发现不兼容，先补对应行为 RED 再修复。

## 项目总图同步

`CONVERGE_SYNC` 未完成，未写源图或候选。2026-09-06 按统一调用契约直接执行 broker 的 `schema graph-sync`，在第 30 行失败：

```text
/Users/exec/.agents/skills/change-map/scripts/change-map-paths.sh: No such file or directory
```

本机为 Windows，已安装脚本固定引用另一主机的 `/Users/exec` 路径。恢复适用本机的 broker 后，从 schema、prepare 开始，按 `E:/Users/can/.agent/skills/seed/references/graph-sync.md` 协议同步本能力及实现状态。不得手工编辑源图绕过 broker；不将该同步失败解释为产品行为失败。
