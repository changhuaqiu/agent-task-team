# 上下文管理器（Context Manager）— 作用域、身份与 A2A 协议化

> 状态：有效·上下文注入策略 MVP 已评审（2026-07-16）｜ 四层语义分组已落地（2026-07-17，见 `context-layering.md` §2.1）｜ `PromptComposer` 兼容包装已退役（2026-07-22）｜ 初始日期：2026-07-13
> 关联模块：`src/lib/agent-context/ContextManager.ts`（唯一组装入口）、`src/lib/agent-context/tiers/`（system/knowledge/task/interaction 四层渲染器）、`src/lib/agent-context/types.ts` + `skillTools.ts`（中立类型）、`src/server/invocation-pipeline/context-planner.ts`（派发接入）、`src/server/daemon.ts`、`src/server/a2a/context-builder.ts`、`src/server/repositories/session-repo.ts`
> 设计依据：`docs/technical/execution/context-layering.md`
> 依赖设计：`docs/technical/execution/platform-harness-state-machine-design.md`（A2A 聚合与结构化交接）；依赖规格：`acp-runtime-integration/`（执行协议，正交）
> 历史基线：`docs/archive/specs/context-budget-management/`（预算组件已落地并由本 spec 继续演进）
> **不在本期**：跨会话记忆系统（archival 存储 + recall/write 落地）—— 另立 spec
> 一句话定位：**管"上下文怎么用"（选层 / 裁剪 / 预算 / 作用域 / 健康度 / 记忆接入点），不管"怎么存"（消息归 message-repo，记忆归未来 memory-repo）。**

---

## 1. 目标

建立一个**统一的上下文管理器（ContextManager）**，作为 agent prompt 组装的唯一权威，解决四件事：

1. **收口两条并行的 prompt 管线**：初始基线中「主循环（用户→agent）」走 `PromptComposer`、「A2A 派发（agent→agent）」由 `a2a/context-builder.ts` 自拼。当前两者统一经 `context-planner → ContextManager.assembleContext()` 组装；零调用的 `PromptComposer` 兼容包装已删除。
2. **项目作用域（项目隔离）**：上下文按 `project_id`（= `conversationId`）隔离，agent 在项目 A 的历史/任务/团队不渗到项目 B。
3. **跨项目身份**：同一 agent（如 mario）可出现在 N 个项目，跨项目**只保留身份**（角色卡 / agentId / 人格 / 基础能力），项目上下文不跟随。
4. **填两个空壳字段**：`agent_session.context_health` 与 `usage_snapshot`（`migrate.ts:63-64`）声明后全代码库零写入——本 spec 让它们成为上下文健康度的真实载体。

并把 **A2A 降级为协议**：A2A（持球/交接）不再自建 prompt 管线，而是作为一个**上下文来源（source）**把交接包喂给 ContextManager；预算、层优先级、作用域、身份对两条路径统一生效。

---

## 2. 背景与现状

### 2.1 两条独立 prompt 管线（初始基线，历史）
| 路径 | 触发 | 组装器 | 预算 | 作用域 | 身份 |
|---|---|---|---|---|---|
| 主循环 | 用户 @ / user_turn | `PromptComposer.composeUserPrompt`（15 层 + `BudgetGuard` + GSSC history） | `ContextBudget`（token） | `project = {name, path}`（仅标签） | `agent.id`（局部） |
| A2A 派发 | agent→agent handoff | `context-builder.renderDispatchPrompt`（自带格式 + RESPONSE_GUIDANCE） | chain depth 8 | 无 | 无 |

`context-budget-management/` 只升级了主循环侧（已落地 `BudgetGuard` / `ContextBudget` / `relevance`），**A2A 侧完全没覆盖** —— "执行部队只覆盖一半战场"。

**主循环侧还有个隐性 bug**：`daemonStore.ts:266-304` 构造 `ComposeOptions` 时**未传 `budget` 字段**，因此主循环永远走 `new ContextBudget()`（恒定 8000 token 默认值），RoleCard / 项目配置里的预算阈值根本没生效。ContextManager 收口时一并修复。

**架构味道**：prompt 组装当前在前端 Zustand store（`daemonStore`）里完成，而非服务端。本 spec P1 先在 lib 层建立抽象供前端调用（低风险），完全服务端化列为开放问题 Q1（P2 候选）。

### 2.2 项目隔离初始基线（历史）
`projectId === conversationId`，所有业务表以 `conversation_id` 为隔离键——**隔离主键已天然存在**。当前生产链在 `ContextManager` intake 对 project/message/task 失败关闭，并在 Context Registry 统一执行 project/global scope 与 agent/role/team visibility 过滤；旧的 `scopeGuard` 独立门面从未进入组装链，已由 Architecture Subtraction Round 16 删除。

### 2.3 跨项目身份现状
身份三层建模已存在：`agents` 表（DB，`migrate.ts:206`）→ `AGENT_ROSTER`（内存全局单例，`agentStore.ts:98`）→ `RuntimeAgent`（运行时）。RoleCard / TeamPack 全局共享。**身份全局 + 运行态按 conversation 隔离的事实已经成立**，但缺一条显式契约保证"跨项目只带身份"。本 spec 把这条事实上升为契约并钉死边界测试。

### 2.4 健康度空壳字段（v2 修正）
> ⚠️ **v1 草稿把空壳字段误判为"身份/作用域占位列"。侦察证伪：真实空壳字段是健康度/用量字段。**

`agent_session` 表（`migrate.ts:63-64`）：
```sql
context_health TEXT,  -- JSON，全代码库零写入
usage_snapshot TEXT,  -- JSON，当前零读写；本 spec 的 P1 Health 层负责首次激活
```
`session-repo.ts` 全文只有 `incrementMessageCount` / `seal` 在写，无任何点写入这两个字段。它们是**为健康度预留的空壳**，本 spec 的 Health 层负责激活。（身份/作用域字段如 `roleCardId`、`conversation.account_id` 早已存在且在用，无需迁移。）

---

## 3. 范围

### 3.1 包含（本期 P1 + P2）
- **P1 统一组装核心**：`ContextManager` 接口 + 主循环路径直接调用 `assembleContext()`；迁移期的 `PromptComposer` 包装在零调用审计后退役
- **P1 项目作用域**：`project` 升级为 `{id, name, path}`；仓储查询、`ContextManager` intake 与 Context Registry 共同执行项目隔离和可见性过滤
- **P1 健康度**：Health 层 + `ContextReport`，回写 `context_health` / `usage_snapshot`（激活空壳字段）
- **P1 记忆接入点**：冻结 `MemoryHook.recall/write` 契约签名，NoOp 实现
- **P2 A2A 协议化**：A2A 派发改走 `ContextManager`（交接包作为 source），退役 `renderDispatchPrompt` 的自建 prompt
- **P2 跨项目身份契约**：`IdentitySnapshot`（全局只读）vs `ScopedContext`（per project）分离建模落地

### 3.2 不包含（YAGNI / 后续）
- 跨会话 archival 记忆系统（存储 schema + recall/write 真实实现）—— **另立 spec**（已同意记忆单独立项）
- embedding 语义相关性（沿用 `context-budget-management/` 预留接口）
- LLM 摘要压缩运行时落地（沿用既有开关位）
- prompt 组装完全服务端化（P2 候选，见开放问题 Q1）
- 健康度 UI 面板（本期只出类型 + 日志，见 Q4）

---

## 4. 约束

- 技术栈 TypeScript / Next.js；`ContextManager.assembleContext()` 是唯一组装契约，不再新增或恢复平行兼容入口
- A2A 语义由 `platform-harness-state-machine-design.md` 的单一聚合契约负责，本规格只定义“交接包如何变成 prompt”
- 项目作用域 = **按 `project_id` 过滤**，不做跨项目 join
- 身份跨项目共享 = **只读快照**（角色卡 / agentId / 人格），项目内状态不写回身份
- 预算对两条路径统一：复用 `ContextBudget` + `BudgetGuard`，不引入第二套预算
- CLI 进程模型：每次 dispatch 是新进程，输出 prompt 必须自包含、全量发送
- 遵循 `docs/standards/technical.md`（实现期对齐）

---

## 5. 设计

### 5.1 对外契约：ContextManager 唯一组装出口
```ts
// src/lib/agent-context/ContextManager.ts
assembleContext(req: ContextRequest): Promise<AssembledContext>
```
```ts
interface ContextRequest {
  agentId: string;
  conversationId: string;          // = projectId，作用域边界
  taskId?: string;                 // 主循环 dispatch 时带
  rawPrompt: string;
  trigger: 'user_turn' | 'a2a_handoff' | 'resume';
  a2aHandoff?: A2AHandoffPacket;   // 仅 trigger='a2a_handoff' 时带
  isFirstWake: boolean;
  budgetOverride?: ContextBudget;  // 默认从 RoleCard / 项目配置推导
}
interface AssembledContext {
  systemPrompt?: string;           // 仅首次唤醒
  userPrompt: string;
  report: ContextReport;           // 见 5.5
  sessionId: string;
}
```
**契约保证**：输入纯数据；输出 prompt 自包含全量可发送；`report` 是唯一可观测出口。

### 5.2 对内分层
```
┌─────────────────────────────────────────────────────────┐
│                   ContextManager                         │
├─────────────────────────────────────────────────────────┤
│  Provider 层 │ 取原料（只读）：messageRepo / taskRepo /   │
│              │ roster / roleCard / teamPack / handoff     │
├─────────────────────────────────────────────────────────┤
│  Record 层   │ category / scope / private / importance    │
├─────────────────────────────────────────────────────────┤
│  Layer 层    │ system / tool / project 三个稳定性层        │
├─────────────────────────────────────────────────────────┤
│  Budget 层   │ system 不裁；tool 次之；project 先裁；      │
│              │ 同层按 importance 从低到高裁剪              │
├─────────────────────────────────────────────────────────┤
│  Memory Hook │ recall(scope,query)/write(artifact) 契约   │
│              │ 本期 NoOp，记忆 spec 接入（见 5.6）         │
├─────────────────────────────────────────────────────────┤
│  Health 层   │ ContextReport → 回写 context_health/       │
│              │ usage_snapshot（激活空壳字段，见 5.5）      │
└─────────────────────────────────────────────────────────┘
```

当前 `ContextArtifact` 以 `cluster/semantic` 表达结构，以结构化 `scope/visibility` 表达可见性，以 `delivery.importance` 决定同层裁剪顺序。旧 `ContextRecord` 字符串 scope/private 模型与 P0–P4 priority 均已由 Registry/Artifact 契约取代并删除。

**四类上下文来源（source）**：
| source | 何时注入 | 来自 |
|---|---|---|
| `userMessage` | trigger=user_turn | 原始 prompt |
| `a2aHandoff` | trigger=a2a_handoff | possession 契约的交接包 |
| `task` / `history` | 始终（按 project_id 过滤） | task-graph / chat_message |
| `memory`（预留） | 后续 spec | archival recall/write |

持久层（与 trigger 无关，每次都装）：identity（role）、project scope、protocol、behavior、collaboration、teamPack、team roster、skill/tool。

### 5.3 项目作用域（D2）
- `project: { id, name, path }`；`id`（= conversationId）为隔离键
- history / task / teamPack / a2aHandoff 在注入前**按 `project_id` 过滤**
- `buildProjectLayer` 增加 `id` 展示；`ContextManager` intake 在组装前拒绝错项目或缺少项目标识的消息/任务，Context Registry 再过滤 fragment scope/visibility

### 5.4 跨项目身份（D3）
- **身份（全局，只读快照 `IdentitySnapshot`）**：roleCard、agentId、displayName、人格、基础 skill 集 —— 跨项目共享
- **项目内状态（per project `ScopedContext`）**：history、task、teamPack、session —— 不跨项目
- 契约：ContextManager 只在组装时读 `IdentitySnapshot`，**从不把项目状态写回身份**
- 边界纪律（钉死测试）：同一 agentId 在新 conversation 醒来 = 全新开始，身份层照常注入，历史层 / 任务层 / 记忆层为空

### 5.5 健康度度量与空壳字段回写（v2 新增）
定义 `ContextReport`（回写到 `context_health` / `usage_snapshot`）：
```ts
interface ContextReport {
  trigger: 'user_turn' | 'a2a_handoff' | 'resume';
  tokensUsed: number;
  tokensBudget: number;
  saturation: number;              // tokensUsed / tokensBudget
  layers: Array<{
    layer: string;
    tier: 'system' | 'tool' | 'project';
    importance: number;
    tokens: number;
    trimmed: boolean;
  }>;
  droppedLayers: string[];
  recalledArtifacts: number;       // 记忆命中数（本期恒 0）
}
```
**健康度判据**（写入 `context_health.summary`）：
- `healthy`：saturation < 0.8 且 required 上下文完整
- `saturated`：saturation ∈ [0.8, 1.0) 或 project 层发生裁剪
- `degraded`：saturation ≥ 1.0 或 required 上下文缺失（后者 fail closed）

**回写**：每次 `assembleContext` 完成后 `sessionRepo.writeContextHealth(sessionId, report)` 原子写入 `context_health`（报告 JSON）+ `usage_snapshot`（token 快照）。这两个字段**第一次有真实写入方**。回写同步/异步见开放问题 Q3。

### 5.6 记忆 recall/write 钩子契约（v2 新增，冻结签名）
```ts
// src/lib/agent-context/MemoryHook.ts
interface MemoryHook {
  recall(input: {
    scope: string;          // = conversationId（项目作用域）
    agentId: string;
    query: string;          // 召回锚点（本期用不到，预留）
    limit?: number;
  }): Promise<MemoryArtifact[]>;   // 本期 NoOp：返回 []

  write(artifact: {
    scope: string;
    agentId: string;
    kind: 'decision' | 'fact' | 'preference' | 'blocker';
    content: string;
    evidence?: string;
  }): Promise<void>;              // 本期 NoOp：直接 resolve
}
```
**为什么本期就要冻结签名**：记忆 spec 落地时只替换 `MemoryHook` 实现（接 memory-repo），组装管线零改动。签名在 P1 钉死 → 记忆系统是"插入式"工程，不返工组装层。

### 5.7 A2A 协议化（D4，降级）
- **降级前**：A2A 派发自建 prompt（`renderDispatchPrompt`），独立预算（chain depth 8），绕过统一的 ContextManager 管线
- **降级后**：A2A 只产出交接包（possession contract 不变）；派发时以 `trigger=a2a_handoff` + `a2aHandoff` source 调 ContextManager；chain depth 作为 source 内元数据保留（交接包内 `remainingBudget`），不再作为顶层预算
- 收益：A2A 派发的 prompt 与主循环**同享预算、层优先级、作用域、身份**；"一半战场"补齐

### 5.8 分阶段
- **P1（非破坏迁移，已完成）**：`ContextManager` 接口 + 主循环改走它 + `project_id` 作用域 + Health 层回写 + MemoryHook 契约 NoOp；迁移期先由 PromptComposer 委托，确认零调用后于 2026-07-22 删除包装。未接线的独立 `scopeGuard` 后由 P5 Registry 的真实过滤取代并删除。
- **P2（迁移）**：A2A 派发改走 ContextManager，退役 `renderDispatchPrompt` 自建 prompt；跨项目身份契约（IdentitySnapshot/ScopedContext）落地。
- **后续**：记忆 source 接入（另立 spec）。

### 5.9 场景化注入策略 MVP（2026-07-16）

本节是当前实现契约，详细设计见 `docs/technical/execution/context-injection-mvp.md`。

- `ContextManager` 在组装前解析 `Scenario = init | iterate | handoff | wakeup | closure` 与 `Archetype = planner | reviewer | worker`，再按 `identity / protocol / capability / situation / focus / dialog` 六个信息簇执行 `include | omit`。
- 场景优先级固定为：handoff；closure resume；其他 resume；首次 user turn；普通 iterate。系统唤醒通过 `ContextRequest.wakeup` 显式携带 `reasonCode` 和可选 closure 元数据。
- 策略必须覆盖全部 `5 × 3 × 6` 组合；未知角色类别回退 worker；closure 非 planner 使用与 planner 相同的防御性策略，但正常路由只选择 planner/coordinator。
- init 在调用方提供任务时保留任务卡，未提供时 focus 自然为空；handoff 与 wakeup 默认不注入 dialog；handoff 依赖 possession packet，wakeup 依赖任务卡与 reason metadata；closure 注入全景、任务子树及用户原始请求。
- 平台以只观测、不阻断的方式检查三项约束：完整输出是否存在合法出口、handoff action 是否缺失、根任务子树是否应触发 closure。
- closure 基于既有 `subtask_of`（child → parent）边递归判断，要求根未终态、后代非空且全部终态，并以 control proof event 持久去重。
- `no_valid_exit`、`chain_closure_dispatched` 写 control proof log；`missing_action` 写 A2A audit log。除 closure 幂等查询外，本期不消费这些观测数据。

### 5.10 Team Log Projection（2026-07-16）

- `chat_message` 与协作型 `control_proof_event` 是唯一事实源；`.ath/team-log.md` 是可重建 read model。
- hot 保留最近 50 条且不超过 24 小时；其余 7 天内条目按日进入 `team-log-archive/`；更早内容只保留 INDEX 摘要与 DB cold source。
- ContextManager 只注入 ≤150 token 的未消费 envelope；正文由 agent 按需读取文件。
- envelope 携带 `upToEntryId`，daemon 只在本轮执行完成后将该快照末尾写入 per-project/per-agent cursor。
- handoff/wakeup envelope 按 task 过滤；init/iterate/closure 使用 agent 可见的全部未消费条目。
- historyLayer 只保留 agent 自身历史，群聊历史不再重复进入 dialog。
- 详细数据模型、文件格式和归档规则以 `docs/technical/execution/context-injection-mvp.md` §16 为准。

### 5.11 首次 A2A Bootstrap（2026-07-18）

- `trigger` 表示上下文来源，`scenario` 表示注入策略；两者不再一一绑定。
- A2A 接收方在当前项目没有 active session 时采用 `init` scenario，生成 identity/system prompt；同时继续携带 `a2aHandoff` focus artifact。
- 接收方已有 active session 时仍采用 `handoff` scenario，省略 identity，避免重复 bootstrap。

### 5.12 Team Harness Context Snapshot（2026-07-19）

> 状态：implemented。该阶段把 ContextManager 从“固定 Provider 的 Prompt Composer”推进为 Team Harness 的一等上下文模块。

#### 决策

`assembleContext()` 继续作为唯一外部 seam。调用方不直接操作 Registry、排序器或 Prompt Part；ContextManager 内部新增：

1. `ContextContributor`：业务模块只贡献带来源、作用域、版本、时效性和可见性的轻量 `ContextFragment`。
2. Contributor Registry：并行收集、结构校验、去重、作用域/可见性/时效性过滤和失败隔离，并把 Fragment 统一归一化为既有六维 `ContextArtifact`，业务模块不重复实现生命周期、一致性和交付策略。
3. Scenario Selection：显式支持 `goal_intake / planning / architecture_review / execution / handoff / code_review / verification / recovery / closure / escalation`；旧 `init / iterate / wakeup` 作为兼容场景保留。
4. `ContextSnapshot`：每次组装返回版本化只读快照，记录实际加载的 Artifact、缺失必需上下文、裁剪/过期/越域原因、能力、约束和最终编译文本。

#### 核心契约

```ts
interface ContextContributor {
  readonly id: string;
  contribute(query: ContextQuery): Promise<ContextFragment[]>;
}

interface ContextFragment {
  id: string;
  kind: string;
  cluster: ContextCluster;
  scope: ContextScope;
  subject: ContextSubject;
  producer: string;
  version: string;
  content: string | { artifactRef: string; summary?: string };
  visibility: ContextVisibility;
  freshness: { observedAt: string; expiresAt?: string };
  evidenceRefs: string[];
  required?: boolean;
}

interface ContextArtifact extends ContextFragment {
  semantic: { kind: string; cluster: ContextCluster };
  source: { provider: string; owner: string; revision: string; observedAt: string };
  lifecycle: { class: 'static' | 'versioned' | 'event' | 'snapshot' | 'ephemeral'; expiresAt?: string };
  consistency: 'strong' | 'causal' | 'eventual';
  delivery: {
    mode: 'bootstrap' | 'on_change' | 'always' | 'delta' | 'jit';
    channel: 'tools' | 'system' | 'message' | 'reference';
    required: boolean;
    importance: number;
  };
}
```

#### 统一接入

- 现有四层 Tier renderer 直接产出原生 Fragment，与业务 Contributor 一起进入同一选择、预算与 Snapshot 管线；不存在第二套 Prompt part 身份或 legacy 包装。
- `MemoryHook` 通过内建 Memory Contributor 接入，不再在主流程里作为特殊分支处理。
- 新业务模块不得直接修改 `rawPrompt` 或追加 Prompt 字符串；只允许注册 Contributor。
- PromptComposer 兼容包装已于 2026-07-22 删除；role/project/task/team/history/tool 的稳定生产 owner 已明确，Legacy Tier Adapter 的退出条件于 2026-08-15 满足并删除。

#### 不变量

- project fragment 的 projectId 必须与 query.conversationId 一致。
- global scope 只允许 identity、protocol、capability；不得携带项目工作事实。
- global scope 的 subject 只允许 agent/team；task/project/goal/artifact 即使伪装为 identity 也必须拒绝。
- agent-private fragment 只对目标 agent 可见；role fragment 只对匹配 archetype 可见。
- 过期 fragment 不进入 Prompt；Contributor 失败不得让其他来源丢失，但必须进入 omission 与 missing-required 报告。
- 当前动作、验收目标、授权约束和 required Skill 是必需上下文；被场景策略或预算裁掉时必须 fail closed。
- 预算选择必须先建立 required floor：system 规则处理后，required tool/project part
  先于所有可选 part 占用剩余预算；只有 required 集合本身无法装入预算时才允许
  `budget_trimmed` 并 fail closed，可选内容不得导致 `required_context_missing`。
- Task 必须属于当前 conversation/project；越域 Task 在 ContextManager 与 Harness Planner 两层拒绝。
- Snapshot id 对完整脱敏 manifest 使用 SHA-256；manifest 必须包含 scope、subject、visibility、source、consistency 与 delivery 投影。
- required 失败也必须生成 error context span，提供脱敏的 missing-required 与 omission 观测证据。
- Snapshot 只描述实际送入本轮 Agent 的上下文，不把“策略允许”误报为“内容已经存在”。
- Provider 返回的历史消息必须显式携带当前 `conversationId`；无作用域消息与跨项目消息同样 fail closed，不允许兼容层猜测归属。
- `ContextContributor.id` 是 Registry 认证的生产者身份。Contributor 返回的每个 Fragment，其 `producer` 必须与注册 id 一致；请求声明的 required Contributor 即使未注册，也必须进入 missing-required。
- ContextManager 生成 assembly snapshot；Daemon 在确定 transport、workdir 指令与 system prompt 投递通道后生成 runtime snapshot。对外观测使用 runtime snapshot id，确保 id 覆盖实际输入。
- Snapshot manifest 必须包含 Fragment `kind / semantic`。运行时哈希必须包含 prompt、system prompt、transport 与 system prompt channel 的摘要。
- 同一 system context 在一个 Runtime 中只能通过一个通道投递。OpenCode 使用配置文件 `instructions` 时，ACP prompt 不得再次内联同一 system context。

---

## 6. 影响面

- **新增**：`src/lib/agent-context/ContextManager.ts`、`MemoryHook.ts`、`ContextReport.ts`、Context Registry、`IdentitySnapshot` 类型
- **改**：dispatch 经 `context-planner` 调 `assembleContext` + 显式传 budget；`layers/projectLayer.ts` 增加 id + scope；`layers/historyLayer.ts` / `taskContextLayer.ts` / `teamPackLayer.ts` 按 project_id 过滤；`src/server/repositories/session-repo.ts` 新增 `writeContextHealth`
- **退役**：`src/lib/agent-context/PromptComposer.ts` 及只验证该包装的测试；仍有效的 role/team/collaboration/user-message/behavior layer 行为迁入各 layer 的同目录测试
- **P2 改**：`src/server/a2a/context-builder.ts`（`renderDispatchPrompt` 退役，改为构造 a2aHandoff source）、`daemon.ts`（A2A 派发点改调 ContextManager）
- **不改**：`platform-harness-state-machine-design.md` 的 A2A 语义、`ContextBudget` 容量模型、`cli-bridge-layer/`、15 个 `buildXxxLayer` 签名；`BudgetGuard` 在既有 tier + importance 选择前补 required floor
- **测试**：ContextManager intake / Context Registry / identity 边界 / ContextReport / MemoryHook NoOp 各配套 `.test.ts`；A2A 派发 prompt 等价性测试（降级前后行为对齐，P2）
- **文档**：`specs/README.md`（草案→生效）、`docs/wiki/01-architecture.md` 上下文章节同步（AGENTS.md：实现必先改设计文档）

---

## 7. 关键决策与开放问题（需用户拍板）

> **[已定·前几轮共识]** A2A 降级为协议仍引入；本期 P1+P2，记忆另立 spec；跨项目只保留身份。
> **[已定·2026-07-13·全按 recommended]** 本轮浮出的 4 个决策点全部采纳推荐项（用户 2026-07-13 拍板"按推荐处理"）：

- **Q1：prompt 组装是否服务端化？** → **采纳 (a)**：P1 先建 lib 抽象供前端调用，服务端化推迟（P1 风险可控）。完全服务端化列开放问题 Q1，作 P2 候选。
- **Q2：A2A 路径收口放 P1 还是 P2？** → **采纳 (a)**：放 P2（P1 先稳主循环，A2A 收口动 orchestrator/dispatch，风险隔离）。
- **Q3：健康度回写同步还是异步？** → **采纳 (a)**：异步 fire-and-forget（健康度不影响 prompt 本身，不阻塞 dispatch）。
- **Q4：`ContextReport` 本期是否暴露到 UI？** → **采纳 (a)**：本期只出类型 + 日志，UI 另议（控制范围，frontend lane 本期不加入）。

---

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 主循环收口回归面大 | 迁移期保留兼容入口；零调用审计与上游回归通过后删除，并由各 layer + ContextManager + harness 测试持续守护 |
| A2A 降级改变派发 prompt 文案，影响 agent 行为 | P2 先加等价性测试（关键段不丢），灰度 |
| project_id 过滤漏掉某层 → 串话 | 仓储查询 + ContextManager intake + Registry 过滤；跨 agent/跨项目边界钉死测试 |
| 健康度回写拖慢 dispatch | Q3 选异步 fire-and-forget |
| Memory 契约签名单点返工 | P1 即冻结签名 + NoOp 测试，记忆 spec 接入零组装层改动 |
| 身份快照陈旧 | 只读快照 + 角色/人格变更走既有 role_cards / team_pack 更新通道，不在 ContextManager 内写 |
| 跨项目隔离被未来需求侵蚀 | 5.4 边界纪律写进 spec + 钉死边界测试；任何"跨项目带历史"需求必须先改本 spec |

---

## 9. 验收指向（checklist.md 于 spec 通过后补）

核心五条：
1. 主循环与 A2A 派发**同走 ContextManager**，共享同一 `ContextBudget` 与层优先级（A2A 验收在 P2）
2. `agent_session.context_health` / `usage_snapshot` 在每次 dispatch 后有真实写入，可查
3. 跨项目：agent 在项目 A 的 history / task 不出现在项目 B 的 prompt 中（intake 与 Registry 过滤生效）
4. 跨项目身份：同一 agent 多项目，prompt 中身份段一致、项目段隔离；记忆层为空
5. `MemoryHook.recall/write` 契约签名冻结，NoOp 实现可被记忆 spec 平滑替换；A2A 降级后交接包经 ContextManager 注入，关键约束段不丢
