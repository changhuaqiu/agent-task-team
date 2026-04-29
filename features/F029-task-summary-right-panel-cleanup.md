---
feature_ids: [F029]
related_features: [F026]
topics: [task, summary, right]
doc_kind: note
created: 2026-02-26
---

# F029: 删除右面板"任务统计"死区 + TaskExtractor 清理

> **Status**: done | **Owner**: 三猫
> **Created**: 2026-02-26

## Why
- ✅ `e532ab4` + `9ebb93f`

## What
- **~~F29~~**: 右面板"任务统计"永远是 0——TaskExtractor 从对话文本提取 - [ ] / TODO: 标记，但猫猫实际用 CLI 工具 (TaskCreate/write_todos) 管理任务，两套系统不搭。删除：RightStatusPanel 的任务统计 section + taskSummary prop + ChatContainer taskSummary 计算。TaskExtractor 后端逻辑（TaskStore/fetchTasks）暂保留给 sidebar 毛线球用；前端右面板的任务展示由 F26 的实时 task 进度取代（放在每只猫的调用卡片里）。

## Acceptance Criteria
- [x] AC-A1: 本文档已补齐模板核心结构（Status/Why/What/Dependencies/Risk/Timeline）。

## Key Decisions
- 历史记录未单列关键决策

## Dependencies
- **Related**: F026
- F026

## Risk
| 风险 | 缓解 |
|------|------|
| 历史文档口径与当前实现可能漂移 | 在 F094 批次里持续复跑审计脚本并按批次回填 |
