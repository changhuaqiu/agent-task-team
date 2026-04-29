---
feature_ids: [F003]
related_features: []
topics: [hindsight, lite]
doc_kind: note
created: 2026-02-26
---

# F003: 显式记忆 (F3-lite)

> **Status**: done | **Owner**: 三猫
> **Created**: 2026-02-26

## Why
- Phase 4.0 计划
- 上下文工程讨论

## What
- **F3**: Phase 4.0 Step 6 25ca123 — /remember /recall 命令 + MemoryStore
- **F3b**: Phase 5.0 全完成: HindsightClient + Evidence 路由 + 治理状态机 + /evidence /reflect /approve /archive 前端命令 + MCP evidence/reflect 工具 + anchor 验证。567 tests

## Acceptance Criteria
- [x] AC-A1: 本文档已补齐模板核心结构（Status/Why/What/Dependencies/Risk/Timeline）。

## Key Decisions
- Phase 4.0 Step 6 `25ca123` — /remember /recall 命令 + MemoryStore
- Phase 5.0 全完成: HindsightClient + Evidence 路由 + 治理状态机 + /evidence /reflect /approve /archive 前端命令 + MCP evidence/reflect 工具 + anchor 验证

## Dependencies
- **Related**: F003（保留原始依赖记录见下）
- 无显式依赖声明

## Risk
| 风险 | 缓解 |
|------|------|
| 历史文档口径与当前实现可能漂移 | 在 F094 批次里持续复跑审计脚本并按批次回填 |
