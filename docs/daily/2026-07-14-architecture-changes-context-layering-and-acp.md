# 今日架构说明：上下文分层 + ACP 运行时统一接入（2026-07-14）

> 作者：Claude（与 @铲屎官 协作）｜ 状态：说明稿（未提交，随团队迁移统一提交）
> 一句话：今天推进了 agent team 的两块架构升级——**上下文分层（P1 已落地并 push）** 和 **ACP 运行时统一接入（设计 + 计划 + 可行性已确认，待实现）**。

---

## Why — 为什么要切

### 1. 上下文分层：上下文在 agent 之间"蒸发"

07-14 协作复盘给出元病灶：**不是没干活，是干的活在 agent 之间蒸发**——六轮评审每轮重读看板、reject 写成 600 字散文、知会 @dk 不触发执行。根因不是 token 不够，是上下文在每次交接中降维。

凝成一条核心原则：**目标共享，轨迹隔离**（goals shared, trajectories isolated）——下游 agent 要的是目标与决策，不是上游的完整思考轨迹。

而当时的 `ContextManager` 是**扁平的 15 功能层 + P0–P4 优先级整数**，还越界碰了角色工作过程和看板 schema。

### 2. ACP 运行时：框架绑死在 bespoke CLI 适配上

框架为 claude / opencode / codex 各维护一套**私有输出解析**（stream-json / ndjson / events），加新 runtime 就得写新 backend、手维护能力表。

业界已有正式标准 **ACP（Agent Client Protocol，"AI 版 LSP"）**——而且我们用的 runtime 都支持（实测：opencode 原生、claude/codex 经官方适配器）。**现有 bespoke 适配 = 在重新发明 ACP**。

---

## What — 切了什么 / 架构变化

### 1. 上下文分层（P1 已落地，合并 main 并 push origin）

- **三层模型**（系统层·永不裁 / 工具层·按角色 / 项目层·目标共享 + 轨迹隔离），取代扁平 P0–P4。
- **scope / private / importance 标签**（参考 CrewAI `MemoryRecord`）：`/project` 共享 vs `/project/<agent>` 私有。
- **单一注入网关 + category 无感**：上下文管理器只管"组装/可见/裁剪"，角色过程/质量/记忆等靠打标签留空间接入，核心零改动。
- **BudgetGuard**：P0–P4 整数 → `tier + importance`（系统层永不裁、项目层内轨迹先于目标裁）。
- 落地代码（6 提交，`a7ae55b` 在 main / origin）：
  - `BudgetGuard` tier+importance（priority legacy 兼容）
  - `ContextRecord` + `filterVisible`（§9 可见性过滤）
  - `assertVisibility`（私有泄漏防御）
  - `ContextManager` 接线（11 处 push 显式分层、history/userMessage 打 `private`、解耦 `AGENT_ROSTER`）
- 文档：spec、plan、自审齐全。

### 2. ACP 运行时统一接入（设计 + 计划 + 可行性确认，待实现）

- **一个 `AcpBackend`（`@agentclientprotocol/sdk`）驱动所有 runtime**：opencode 原生（`opencode acp`）、claude/codex 经官方适配器（`claude-agent-acp` / `codex-acp`）。
- **`AgentCatalog` 取代 factory switch**；**`CapabilitySet` 从 `initialize` 握手自取**；**`AgentEvent` 从 `session/update` 映射一次**。
- **权限本期搁置**（`requestPermission` 用 auto-approve 占位，真实 profile 见 spec §6 后续）。
- 架构：daemon / ContextManager / A2A 在 **ACP 线之上，不动**。
- 文档：团队 spec `specs/acp-runtime-integration/spec.md`（权威）、执行计划 `docs/plans/2026-07-14-acp-adoption.md`。
- **可行性已实测**：三 runtime ACP `initialize` 握手全过（opencode 1.14.35 / claude 适配器 0.59.0 / codex 适配器 1.1.2）。

---

## How — 怎么切

### 过程（superpowers 流程，全程 TDD + 逐任务 review）

`brainstorm（澄清目标/原则）→ spec（设计+自审+用户审）→ writing-plans（计划）→ subagent-driven-development（逐任务 implementer+reviewer）→ 最终全分支 review → 合并`

- **上下文分层**：走完全流程，subagent 实现 + 每任务两阶段 review + 最终 review + 一轮修复，合并 main 并 push origin。
- **ACP**：走到 spec + plan + 可行性探测；**实现待干净 git 基线 + 新会话**（团队文档迁移 staged 未提交，逐任务提交会缠夹；且为 11 任务大工程）。

### 关键发现（影响决策，均核对非猜）

- **ACP 是 native vs 桥接问题，与版本无关**：opencode 原生；claude/codex 经 `@agentclientprotocol/*-acp` 适配器（非厂商 CLI 原生）。
- **Windows spawn ENOENT**：opencode/npx 是 `.cmd` shim → 需 `shell:true` 或 cross-spawn（沿用项目 `CliBridge`）。
- **OpenClaw 实现（参考）**：`/acp doctor` 健康检查、进程树清理 + 孤儿回收、codex `CODEX_HOME` 隔离、model 跨 runtime 规范化、permission profile（非交互必须 approve-all/deny）。

---

## 效果 / 架构变化

### 已落地（上下文分层 P1）

- BudgetGuard 按 **tier + importance** 裁剪：系统层永不裁、项目层轨迹先于目标裁——修正了 legacy priority→tier 映射把 task/userMessage/teamPack/a2a 误划成 system 的问题。
- history / userMessage 带 `private=true, scope=/project/<agent>`——轨迹隔离**元数据就位**（`filterVisible` / `assertVisibility` 的强制执行接线留 P2）。
- ContextManager 解耦 `AGENT_ROSTER`（唯一耦合面 = `ContextProviders`）。
- 测试：机制层 40/40 绿，全量无新增失败（33 个 pre-existing 来自 TASK-006 WIP）。

### 待实现（ACP，可行性已消风险）

- 一旦落地：框架**平台无关**（任何 ACP runtime 零适配接入）、删 bespoke backend、daemon 只剩 ACP 路径、附赠远程 runtime + 双向 fs/terminal/permission 中介能力。

---

## 待办（后续）

- **上下文分层 P2**：`filterVisible`/`assertVisibility` 强制执行接线、`AGENT_ROSTER` 在 `PromptComposer.ts`/`teamLayer.ts` 的剩余解耦、`getProtocol` + `.ath/PROTOCOLS.md`、OUT 泄漏迁移（roleLayer/protocolLayer）、L2 `HandoffSnapshot`。
- **ACP 实现**：11 任务（见 `docs/plans/2026-07-14-acp-adoption.md`），需先让团队文档迁移落定（提交）建立干净基线。

---

*两块升级的关系：上下文分层在 ACP 线之上（决定"发什么"给 agent），ACP 是其下传输层（决定"怎么发给任何 runtime"）。互补，互不侵入。*
