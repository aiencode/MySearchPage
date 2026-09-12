# 剩余事项

## 扩展重载后的旧标签设置同步

代码已增加更新/启动后的四站标签重新注入、重复实例保护，以及样式和媒体状态 DOM 恢复账本。设置页也提供手动“重连旧标签”。该路径不自动刷新或替换页面。

升级前旧版本已经留下且没有 DOM 账本的历史孤儿覆盖仍无法可靠恢复，首次升级可能需要用户手动重建该页面。新账本路径仍需真实浏览器重载回归确认。

诊断页位于 `extension/diagnostics/search-media-probe.html`，设置页已有入口。它只读取四目标域名页面的脚本、结构和状态，并将报告保存到独立的 `searchMediaRuntimeProbe` 键。

## 四站线上兼容验证

本地自动化和离线 Chromium 验证已完成已记录范围。完整线上搜索、悬停预览、真实详情导航和各站其他卡片类型尚未实测。此前线上浏览器取证动作被自动审批以 `blocked by policy` 拒绝，未提供具体原因；没有用本地 fixture 结果替代线上通过结论。后续在允许的环境取得真实页面证据，若发现不兼容，先补对应行为 RED 再修复。

## 项目总图同步

`CONVERGE_SYNC` 未完成，未写源图或候选。2026-09-06 按统一调用契约直接执行 broker 的 `schema graph-sync`，在第 30 行失败：

```text
/Users/exec/.agents/skills/change-map/scripts/change-map-paths.sh: No such file or directory
```

本机为 Windows，已安装脚本固定引用另一主机的 `/Users/exec` 路径。恢复适用本机的 broker 后，从 schema、prepare 开始，按 `E:/Users/can/.agent/skills/seed/references/graph-sync.md` 协议同步本能力及实现状态。不得手工编辑源图绕过 broker；不将该同步失败解释为产品行为失败。
