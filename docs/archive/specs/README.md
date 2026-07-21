# 历史规格索引

本目录保存已经完成、被替代或不再实施的规格，仅用于追溯，不再指导新实现。当前实施契约以 [`specs/`](../../../specs/) 为准。

| 规格 | 归档状态 | 原因或替代规格 |
| --- | --- | --- |
| `unify-integration-config-center/` | implemented | 账号、配置中心和多 backend 基线已完成；长期事实见 `docs/technical/integrations/2026-05-01-cli-channel-auth-config-center.md` |
| `team-runtime-contract/` | implemented | TeamRuntime 解析与接线已完成；长期事实见 `docs/wiki/01-architecture.md` |
| `git-collaboration-skill-config/` | implemented | Git 协作 Skill 配置和测试已完成 |
| `default-team-collaboration-template/` | implemented | 旧 6 人模板已完成历史使命；当前团队收敛由 `specs/team-simplification/` 指导 |
| `personality-led-autonomy/` | implemented | 自治守护、派发回执和 UI 已完成；长期事实已进入产品与架构文档 |
| `context-budget-management/` | superseded | 基础预算组件已实现，P0–P4 方案由 `specs/context-manager/` 与 `docs/technical/execution/context-layering.md` 的 tier + importance 模型替代 |
| `cli-bridge-layer/` | superseded | 跨平台 spawn 基线已实现，按厂商 CLI 适配与手工能力矩阵由 `specs/acp-runtime-integration/` 替代 |
| `platform-harness-loop/` | implemented | 服务端闭环第一阶段已落地（2026-07-14）；tasks/checklist 全勾，长期事实见 `docs/technical/execution/platform-harness-loop.md` 与 ADR-023 |
| `frontend-runtime-performance-refactor/` | implemented | 运行时缓存、订阅边界与性能验收 P1–P3 全部完成；仅剩 Non-Goals 的后续工作 |
| `group-chat-task-flow/` | implemented | baseline 已实现（tasks 全勾），roadmap 已标 done；长期事实见 `docs/technical/execution/group-chat-task-graph.md` |
| `project-context-bootstrap/` | implemented | 分层项目上下文、增量加载、同路径 workstream、Harness 接线和 C 级评测已完成；长期事实见 `docs/technical/execution/project-context-bootstrap.md` 与 `docs/wiki/project-context.md` |
