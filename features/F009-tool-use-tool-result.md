---
feature_ids: [F009]
related_features: []
topics: [tool, use, result]
doc_kind: note
created: 2026-02-26
---

# F009: tool_use/tool_result 事件显示

> **Status**: done | **Owner**: 三猫
> **Created**: 2026-02-26

## Why
- Phase 5 拍板发现

## What
- **F9**: 5.0-pre: useAgentMessages 新增 tool_use/tool_result handler + ChatMessage 'tool' variant

## Acceptance Criteria
- [x] AC-A1: 本文档已补齐模板核心结构（Status/Why/What/Dependencies/Risk/Timeline）。

## Key Decisions
- 历史记录未单列关键决策

## Dependencies
- **Related**: F009（保留原始依赖记录见下）
- 无显式依赖声明

## Risk
| 风险 | 缓解 |
|------|------|
| 历史文档口径与当前实现可能漂移 | 在 F094 批次里持续复跑审计脚本并按批次回填 |
