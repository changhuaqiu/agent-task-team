---
feature_ids: [F022]
related_features: []
topics: [rich, blocks]
doc_kind: note
created: 2026-02-26
---

# F022: Rich Blocks 富消息系统

> **Status**: done | **Owner**: 三猫
> **Created**: 2026-02-26

## Why

## What
- **F22**: bd8ae63 PR #34 — 全栈实现：4 种 block kind (card/diff/checklist/media_gallery) + 双路由 (MCP callback + cc_rich text) + RichBlockBuffer (invocationId 绑定 + dedup + post-completion 拒绝) + Zod discriminatedUnion 入口验证 + isValidRichBlock 全字段类型守卫 + 前端 5 组件 + 50 tests。7 轮 cloud review + Maine Coon本地 R1-R7。

## Acceptance Criteria
- [x] AC-A1: 本文档已补齐模板核心结构（Status/Why/What/Dependencies/Risk/Timeline）。

## Key Decisions
- 历史记录未单列关键决策

## Dependencies
- **Related**: 无
- 无显式依赖声明

## Risk
| 风险 | 缓解 |
|------|------|
| 历史文档口径与当前实现可能漂移 | 在 F094 批次里持续复跑审计脚本并按批次回填 |
