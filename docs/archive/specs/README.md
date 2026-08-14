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
| `platform-runtime-events/` | implemented | 四类平台事件、Durable Dispatcher、Agent Inbox、9 领域 inline seam、delivery Process Manager 与 Runtime 消费者迁移已完成；长期事实见 `docs/technical/execution/platform-runtime-event-model.md` 与 `docs/wiki/04-backend-daemon.md` |
| `durable-effect-outbox/` | implemented | 通用 Effect Outbox、Runtime completion 六类 adapter、v51 suppression bridge 与 A2A 事务边界已完成；长期设计见 `docs/technical/execution/durable-effect-outbox.md`，当前事实见 `docs/wiki/04-backend-daemon.md` |
| `platform-harness-state-machines/` | implemented | Platform Harness 已收敛为领域 owner 状态机、WorkContract、Agent 自主循环、确定性 ControlAction、Gate/A2A/Delivery 闭环；长期设计见 `docs/technical/execution/platform-harness-state-machine-design.md` |
| `agent-observability/` | implemented | Span、投影与项目观测工作台已落地；长期事实见 `docs/technical/observability/agent-observability.md` |
| `agent-session-identity/` | implemented | 项目 × Agent session 隔离、ACP resume 与服务端事实源已落地 |
| `architecture-subtraction/` | implemented | 第一轮依赖/产物、历史 worktree 与无生产消费者 Module 清理完成；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-2/` | implemented | 第二轮从真实运行入口反推调用图，删除幽灵 UI、孤立 Module、自嗨测试并归档已完成规格；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-3/` | implemented | 第三轮将评估 Pages API 收敛到唯一 `/api/eval/*`，删除重复公开入口并补齐交互回归保护；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-4/` | implemented | 第四轮删除已被 ACP 替代的 OpenCode HTTP Bridge 隐藏执行链、服务、脚本和无消费者 API，并清理旧节点状态；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-5/` | implemented | 第五轮删除不可用的独立 backend daemon、硬编码旧团队的 standalone MCP 包及失效构建/依赖；当前安全 MCP 保留在逐 Invocation 授权链路，长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-6/` | implemented | 第六轮删除无消费者的 token summary 与工程协作 HTTP transport，保留 Token UI、工程协作深模块及 AgentOutcome 契约；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-7/` | implemented | 第七轮删除无入口且已被标准 real-runtime smoke 与自动化测试替代的两个旧 ACP 探针；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-8/` | implemented | 第八轮删除陈旧 npm lockfile、重复高亮直依赖并归位纯类型包，统一 pnpm 依赖事实源；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-9/` | implemented | 第九轮删除无消费者的平行 Drizzle schema/tooling 与旧 Chokidar 类型包，数据库事实收敛到 better-sqlite3 + SQL migrations；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-10/` | implemented | 第十轮删除评估模块重复转发和固定失败的公开 route，保留唯一 runs 提交入口与内部 pairwise 算法；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-11/` | implemented | 第十一轮删除重复独立配置中心、前端假配置状态及 `terminal:start` 无消费者协议字段，设置抽屉收敛为唯一入口；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-12/` | implemented | 第十二轮删除空 runtime catalog、Mock Runner 前后端兼容层及不可执行的生产 mock runtime 身份，保留 ACP 测试 mock；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-13/` | implemented | 第十三轮删除绕过 ACP 的 tmux 厂商 CLI 平行执行链、pane registry 与 legacy 参数模块，收敛唯一 ACP backend；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-14/` | implemented | 第十四轮保留真实 Google/Gemini API Key 账号能力，将执行收敛到 OpenCode ACP，并删除假 Gemini runtime 与 OAuth 假可达入口；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-15/` | implemented | 第十五轮删除假账号验证旁路、OpenCode-routed OAuth 与自嗨 probe wrapper，把连接测试和最终执行收口到同一 provider/model/readiness 边界；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-16/` | implemented | 第十六轮删除未接线的 scopeGuard、旧 ContextRecord 可见性模型及其自嗨测试，把项目隔离与可见性收口到 ContextManager intake 和 Context Registry；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-17/` | implemented | 第十七轮删除 ACP-only 链中恒等的 CapabilityRouter、手工能力矩阵与合成测试，执行参数直接进入唯一 AcpBackend；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-18/` | implemented | 第十八轮删除 `/api/mutations` 中零生产调用的 Task 取消别名及 Session/Invocation 生命周期写入口，写权收口到 Task Graph、Session identity 与 Invocation Pipeline owner；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-19/` | implemented | 第十九轮把 Phase CRUD 收敛到唯一 `/api/phases` interface，删除通用 mutation 中的重复 upsert/delete 写入口；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-20/` | implemented | 第二十轮删除无生产调用且绕过 Invocation grant 的浏览器 `tool.invoke`，Agent 工具只保留受控 Skill/MCP executor；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-21/` | implemented | 第二十一轮删除无产品入口且依赖不可验证自由文本身份的人工 annotation route 与自循环统计，保留并修复历史 schema、retention 与聚合删除兼容；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-22/` | implemented | 第二十二轮删除浏览器旧 Task 六态、兼容投影与无效直接动作，统一 repository、API、store、socket、UI 和 Agent preset 的七态契约；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-23/` | implemented | 第二十三轮删除 ContextManager Legacy Tier 往返、P0–P4 priority、p0Intact 与未消费 Skill 文件投影，Tier 内容直接进入原生 Fragment/Artifact 管线；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-24/` | implemented | 第二十四轮删除只有 NoOp 实现的 MemoryHook 专用 seam、内建空 Contributor 与恒零报告字段，未来真实来源统一复用 ContextContributor；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-25/` | implemented | 第二十五轮删除八个零生产消费者的浏览器 Store action、自嗨测试及无 producer 的进度卡 UI 尾巴，Store interface 只保留真实消费者与正式命令；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-26/` | implemented | 第二十六轮删除零生产消费者的 Proof Log 验收回执二次解析、旁路 policy 与失败构造器，真实 QualityGate admission 只接受项目内可信验收物；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-27/` | implemented | 第二十七轮删除 socket transport 对 legacy proposal 的重复 DeliveryRun policy 与无消费者 Proof，统一由 Invocation Planner admission 覆盖 socket、Inbox、重试和恢复；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-28/` | implemented | 第二十八轮删除单调用者、零行为的 `cliBridge` spawn 透传模块，由唯一 `AcpBackend` 直接拥有跨平台 `cross-spawn`；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `architecture-subtraction-29/` | implemented | 第二十九轮删除 daemon 对 ACP 事件流的二次终止包装与独立浅 helper，将 `done` 归一化收口到唯一 `AcpBackend`；长期决策见 `docs/technical/execution/architecture-subtraction.md` |
| `four-agent-pr-review-loop/` | implemented | 四 Agent PR 交付、评审、修复与合并证据闭环已落地 |
| `github-issue-agent-hook/` | implemented | GitHub Issue 验签、幂等建项与自主交付链已落地；长期设计见 `docs/technical/integrations/github-issue-agent-hook.md` |
| `open-issues-33-35/` | implemented | A2A 分派意图、首次交接身份、默认 TeamPack 升级与上下文去重修复已验收 |
