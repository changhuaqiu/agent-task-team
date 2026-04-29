---
feature_ids: [F004]
related_features: []
topics: [runtime, config]
doc_kind: note
created: 2026-02-26
---

# F004: 配置运行时修改

> **Status**: done | **Owner**: 三猫
> **Created**: 2026-02-26

## Why
- Phase 3.9

## What
- **F4**: Phase 5.2 — PATCH /api/config + ConfigStore overlay + /config set 前端命令。567 tests

## Acceptance Criteria
- [x] AC-A1: 本文档已补齐模板核心结构（Status/Why/What/Dependencies/Risk/Timeline）。

## Key Decisions
- Phase 5.2 — PATCH /api/config + ConfigStore overlay + `/config set` 前端命令

## Dependencies
- **Related**: F004（保留原始依赖记录见下）
- 无显式依赖声明

## Risk
| 风险 | 缓解 |
|------|------|
| 历史文档口径与当前实现可能漂移 | 在 F094 批次里持续复跑审计脚本并按批次回填 |
