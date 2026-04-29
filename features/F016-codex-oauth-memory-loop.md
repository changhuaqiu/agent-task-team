---
feature_ids: [F016]
related_features: []
topics: [codex, oauth, memory]
doc_kind: note
created: 2026-02-26
---

# F016: Codex OAuth + 记忆闭环

> **Status**: done | **Owner**: 三猫
> **Created**: 2026-02-26

## Why

## What
- **F16**: Phase F16：Codex 默认走 OAuth（隔离 HOME 下 auth.json/sessions 与真实 ~/.codex 打通），并新增 invocation-token 保护的 search-evidence / reflect / retain-memory callback + MCP 对应工具，形成Maine Coon记忆闭环。计划见 2026-02-10-f16-codex-oauth-memory-loop.md。

## Acceptance Criteria
- [x] AC-A1: 本文档已补齐模板核心结构（Status/Why/What/Dependencies/Risk/Timeline）。

## Key Decisions
- Phase F16：Codex 默认走 OAuth（隔离 HOME 下 `auth.json`/`sessions` 与真实 `~/.codex` 打通），并新增 invocation-token 保护的 `search-evidence` / `reflect` / `retain-memory` callback + MCP 对应工具，形成Maine Coon记忆闭环

## Dependencies
- **Related**: 无
- F016

## Risk
| 风险 | 缓解 |
|------|------|
| 历史文档口径与当前实现可能漂移 | 在 F094 批次里持续复跑审计脚本并按批次回填 |
