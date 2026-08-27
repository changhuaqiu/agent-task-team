---
topics: [backlog]
doc_kind: note
created: 2026-02-26
---

# Agent Task Hub Project Roadmap

> 维护者：Admin | 最后更新：2026-08-15
>
> **规则**：只记录当前项目真实在推进的工作流与长期方向。
> 外部迁入的 feature/backlog 体系已移除，不再作为本项目规划依据。

| 工作流 | 状态 | Owner | 文档 |
|--------|------|-------|------|
| 文档架构与多 Agent 约束 | done | Admin | `docs/README.md` |
| 工程型角色卡机制 | in-progress | Admin | `docs/product/business/2026-05-01-engineering-role-card-business-plan.md` |
| 智能分派系统 | done | Admin | `docs/wiki/01-architecture.md` — CapabilityProfile 能力图谱 + DispatchAdvisor 匹配引擎 + ProjectStatusLayer 任务看板 + 可配置角色系统 |
| Agent-first 配置入口 | done | Admin | Agent Definition 统一拥有身份、工作指令、技能和执行选择；设置只管理账号、运行环境与共享技能 |
| ACP 运行时统一接入 | in-progress | Admin | `specs/acp-runtime-integration/` — OpenCode 原生 ACP + Claude/Codex ACP 适配器 |
| 上下文管理收敛 | in-progress | Admin | `specs/context-manager/` — 单一注入网关 + 项目隔离 + 可见性与预算 |
| 默认团队精简 | in-progress | Admin | `specs/team-simplification/` — 6 人默认团队收敛为 4 人 |
| 任务系统增强 | done | Admin | `docs/technical/execution/group-chat-task-graph.md` — Dispatch 持久化 + Workdir 隔离 + Skill Config Tools + Token 追踪 |
| Role Card 生态系统 | in-progress | Admin | `docs/product/business/2026-05-05-role-card-ecosystem-analysis.md` 与 `specs/team-role-card-compatibility/` |
| 安全扫描 | in-progress | Admin | 基于导入管道的 SoulScan 精简版：Prompt 注入检测 + 敏感信息检测 + 危险指令检测 |
| 项目绑定 | in-progress | Admin | 项目与 TeamPack 1:1 绑定，生命周期内不可切换，projects 表新增 team_pack_id 外键 |
| 团队初始分配策略 | in-progress | Admin | Team Runtime 按 pipeline / parallel / hub_spoke / custom workflow 选择初始负责人；后续推进由 Task Graph / Platform Harness 负责 |
| 来源追踪 | in-progress | Admin | TeamPack.source 字段记录导入来源（github/preset），支持 URL 和 importedAt 时间戳 |
| 输入验证 | in-progress | Admin | 导入管道的目录结构探测 + pack.json 格式校验 + role.json 语义化版本验证 |
| 速率限制 | in-progress | Admin | 导入管道 shallow clone 30s 超时 + GitHub API 调用频率控制 |
| 错误国际化 | in-progress | Admin | 统一错误码与 i18n 资源管理，支持多语言错误提示 |

## 说明

- 旧的 feature 编号、外部 backlog、社区 issue 映射已整体移除
- 当前路线图只保留和本仓库当前实现直接相关的工作流
