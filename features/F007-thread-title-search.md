---
feature_ids: [F007]
related_features: []
topics: [thread, title, search]
doc_kind: note
created: 2026-02-26
---

# F007: Thread 名字检索

> **Status**: done | **Owner**: 三猫
> **Created**: 2026-02-26

## Why
- 功能性试用

## What
- **F7**: 81939c1 — GET /api/threads?q= 大小写不敏感搜索

## Acceptance Criteria
- [x] AC-A1: 本文档已补齐模板核心结构（Status/Why/What/Dependencies/Risk/Timeline）。

## Key Decisions
- 历史记录未单列关键决策

## Dependencies
- **Related**: F007（保留原始依赖记录见下）
- 无显式依赖声明

## Risk
| 风险 | 缓解 |
|------|------|
| 历史文档口径与当前实现可能漂移 | 在 F094 批次里持续复跑审计脚本并按批次回填 |
