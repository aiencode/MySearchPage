---
name: extension--high-risk-content-control--change
description: 继续 MySearchPage 高风险内容访问控制、资料检索边界、搜索会话、行为反馈、收藏历史或跨平台适配的分阶段需求时使用。
---

本 change 承载“把高风险内容平台改造成主动、限时、不可横向游走的资料检索工具”的完整产品设计；它不是一次性实现全部功能的授权。

- [完整产品 change](change.md)：记录总体目标、现状、稳定边界、分模块要求、完成标准、待确认决策、依赖与来源映射。
- 每轮只实现用户当轮明确指定并授权进入代码阶段的模块；未被点名的模块只作为整体兼容背景。
- 继续使用现有 MySearchPage 搜索入口和现有浏览器扩展，不创建第二套搜索页、第二个扩展或并行规则系统。
- 现行搜索结果媒体行为见 `../extension-search-media--behavior/SKILL.md`；明确命中阻断规则时，本 change 的彻底隐藏要求优先。
- 功能完成并确认后按 `converge` 将已实现行为写入相应 facts，再回收本 change 中已经完成且不再需要保留的变更正文。
