---
topics: [backlog]
doc_kind: note
created: 2026-02-26
---

# Agent Task Hub Project Roadmap

> 维护者：Admin | 最后更新：2026-05-04
>
> **规则**：只记录当前项目真实在推进的工作流与长期方向。
> 外部迁入的 feature/backlog 体系已移除，不再作为本项目规划依据。

| 工作流 | 状态 | Owner | 文档 |
|--------|------|-------|------|
| 文档架构与多 Agent 约束 | done | Admin | `docs/README.md` |
| 工程型角色卡机制 | in-progress | Admin | `docs/product/business/2026-05-01-engineering-role-card-business-plan.md` |
| 智能分派系统 | done | Admin | `docs/superpowers/specs/2026-05-04-intelligent-dispatch-design.md` — CapabilityProfile 能力图谱 + DispatchAdvisor 匹配引擎 + ProjectStatusLayer 任务看板 + 可配置角色系统 |
| 统一集成配置中心 | in-progress | Admin | `specs/unify-integration-config-center/` — 账号模型 + 角色卡绑定 + daemon 执行上下文扩展 |
| 任务系统增强 | done | Admin | `docs/superpowers/specs/2026-05-04-task-system-enhancement-design.md` — Dispatch 持久化 + Workdir 隔离 + Skill Config Tools + Token 追踪 |
| Role Card 生态系统 | in-progress | Admin | `docs/superpowers/specs/2026-05-05-role-card-ecosystem-design.md` — TeamPack 数据模型 + 导入管道 + 协作编排层 |
| 安全扫描 | in-progress | Admin | 基于导入管道的 SoulScan 精简版：Prompt 注入检测 + 敏感信息检测 + 危险指令检测 |
| 项目绑定 | in-progress | Admin | 项目与 TeamPack 1:1 绑定，生命周期内不可切换，projects 表新增 team_pack_id 外键 |
| 团队模式引擎 | in-progress | Admin | TeamModeEngine 四种策略：pipeline / parallel / hub_spoke / custom 状态机 |
| 来源追踪 | in-progress | Admin | TeamPack.source 字段记录导入来源（github/preset），支持 URL 和 importedAt 时间戳 |
| 输入验证 | in-progress | Admin | 导入管道的目录结构探测 + pack.json 格式校验 + role.json 语义化版本验证 |
| 速率限制 | in-progress | Admin | 导入管道 shallow clone 30s 超时 + GitHub API 调用频率控制 |
| 错误国际化 | in-progress | Admin | 统一错误码与 i18n 资源管理，支持多语言错误提示 |

## 说明

- 旧的 feature 编号、外部 backlog、社区 issue 映射已整体移除
- 当前路线图只保留和本仓库当前实现直接相关的工作流
