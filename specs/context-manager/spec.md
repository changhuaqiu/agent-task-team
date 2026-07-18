# 上下文管理器（Context Manager）— 作用域、身份与 A2A 协议化

> 状态：有效·上下文注入策略 MVP 已评审（2026-07-16）｜ 四层语义分组已落地（2026-07-17，见 `context-layering.md` §2.1）｜ 初始日期：2026-07-13
> 关联模块：`src/lib/agent-context/ContextManager.ts`（编排）、`src/lib/agent-context/tiers/`（system/knowledge/task/interaction 四层渲染器）、`src/lib/agent-context/types.ts` + `skillTools.ts`（中立类型，解循环依赖）、`src/lib/agent-context/PromptComposer.ts`（兼容包装，待删——见 context-layering.md §2.1 待办）、`src/store/daemonStore.ts`、`src/server/daemon.ts`、`src/server/a2a/context-builder.ts`、`src/server/repositories/session-repo.ts`
> 设计依据：`docs/technical/execution/context-layering.md`
> 依赖规格：`a2a-possession-contract/`（持球/交接包，语义不变）、`acp-runtime-integration/`（执行协议，正交）
> 历史基线：`docs/archive/specs/context-budget-management/`（预算组件已落地并由本 spec 继续演进）
> **不在本期**：跨会话记忆系统（archival 存储 + recall/write 落地）—— 另立 spec
> 一句话定位：**管"上下文怎么用"（选层 / 裁剪 / 预算 / 作用域 / 健康度 / 记忆接入点），不管"怎么存"（消息归 message-repo，记忆归未来 memory-repo）。**

---

## 1. 目标

建立一个**统一的上下文管理器（ContextManager）**，作为 agent prompt 组装的唯一权威，解决四件事：

1. **收口两条并行的 prompt 管线**：当前「主循环（用户→agent）」走 `PromptComposer`（前端 `daemonStore.ts:306-307` 调用），「A2A 派发（agent→agent）」走 `a2a/context-builder.ts:35-73` 自拼，两套格式、两套预算、互不复用。ContextManager 让两者走同一组装出口。
2. **项目作用域（项目隔离）**：上下文按 `project_id`（= `conversationId`）隔离，agent 在项目 A 的历史/任务/团队不渗到项目 B。
3. **跨项目身份**：同一 agent（如 mario）可出现在 N 个项目，跨项目**只保留身份**（角色卡 / agentId / 人格 / 基础能力），项目上下文不跟随。
4. **填两个空壳字段**：`agent_session.context_health` 与 `usage_snapshot`（`schema.ts:87-88`）声明后全代码库零写入——本 spec 让它们成为上下文健康度的真实载体。

并把 **A2A 降级为协议**：A2A（持球/交接）不再自建 prompt 管线，而是作为一个**上下文来源（source）**把交接包喂给 ContextManager；预算、层优先级、作用域、身份对两条路径统一生效。

---

## 2. 背景与现状

### 2.1 两条独立 prompt 管线（核心问题）
| 路径 | 触发 | 组装器 | 预算 | 作用域 | 身份 |
|---|---|---|---|---|---|
| 主循环 | 用户 @ / user_turn | `PromptComposer.composeUserPrompt`（15 层 + `BudgetGuard` + GSSC history） | `ContextBudget`（token） | `project = {name, path}`（仅标签） | `agent.id`（局部） |
| A2A 派发 | agent→agent handoff | `context-builder.renderDispatchPrompt`（自带格式 + RESPONSE_GUIDANCE） | chain depth 8 | 无 | 无 |

`context-budget-management/` 只升级了主循环侧（已落地 `BudgetGuard` / `ContextBudget` / `relevance`），**A2A 侧完全没覆盖** —— "执行部队只覆盖一半战场"。

**主循环侧还有个隐性 bug**：`daemonStore.ts:266-304` 构造 `ComposeOptions` 时**未传 `budget` 字段**，因此主循环永远走 `new ContextBudget()`（恒定 8000 token 默认值），RoleCard / 项目配置里的预算阈值根本没生效。ContextManager 收口时一并修复。

**架构味道**：prompt 组装当前在前端 Zustand store（`daemonStore`）里完成，而非服务端。本 spec P1 先在 lib 层建立抽象供前端调用（低风险），完全服务端化列为开放问题 Q1（P2 候选）。

### 2.2 项目隔离现状
`projectId === conversationId`（`daemonStore.ts:249`、`daemon.ts` 全链路），所有业务表以 `conversation_id` 为隔离键——**隔离主键已天然存在**。但 `PromptComposer` 的 `project` 只有 `{name, path}`，`buildProjectLayer` 只打印两行字符串；history / task / teamPack 各层**未显式按 project_id 断言过滤**。agent 在多项目间串话没有结构性阻断。

### 2.3 跨项目身份现状
身份三层建模已存在：`agents` 表（DB，`schema.ts:180`）→ `AGENT_ROSTER`（内存全局单例，`agentStore.ts:98`）→ `RuntimeAgent`（运行时）。RoleCard / TeamPack 全局共享。**身份全局 + 运行态按 conversation 隔离的事实已经成立**，但缺一条显式契约保证"跨项目只带身份"。本 spec 把这条事实上升为契约并钉死边界测试。

### 2.4 健康度空壳字段（v2 修正）
> ⚠️ **v1 草稿把空壳字段误判为"身份/作用域占位列"。侦察证伪：真实空壳字段是健康度/用量字段。**

`agent_session` 表（`schema.ts:87-88`）：
```ts
contextHealth: text('context_health'),    // JSON，全代码库零写入
usageSnapshot: text('usage_snapshot'),    // JSON，仅 tokens/summary API 读取，零写入
```
`session-repo.ts` 全文只有 `incrementMessageCount` / `seal` 在写，无任何点写入这两个字段。它们是**为健康度预留的空壳**，本 spec 的 Health 层负责激活。（身份/作用域字段如 `roleCardId`、`conversation.account_id` 早已存在且在用，无需迁移。）

---

## 3. 范围

### 3.1 包含（本期 P1 + P2）
- **P1 统一组装核心**：`ContextManager` 接口 + 主循环路径改走它（`PromptComposer` 退为渲染器，不破坏现有调用方，沿用 `composeUserPrompt` 返回 `string` 的向后兼容）
- **P1 项目作用域**：`project` 升级为 `{id, name, path}`，history / task / teamPack 按 `project_id` 过滤，新增 `scopeGuard` 断言
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

- 技术栈 TypeScript / Next.js，**不破坏 `PromptComposer.composeUserPrompt()` 返回 `string` 的对外契约**（沿用 context-budget-management 向后兼容策略）
- A2A 语义**不变**：`a2a-possession-contract/` 的持球 / 交接 / 反回声规则不动，本规格只改"交接包如何变成 prompt"
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

`ContextRecord` 的 `category` 决定结构层，`scope/private` 决定可见性，`importance` 决定同层裁剪顺序。旧 P0–P4 priority 只保留为迁移兼容字段，不再作为新实现的事实源。

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
- `buildProjectLayer` 增加 `id` 展示；新增 `scopeGuard`：组装前断言所有 source 同属一个 `project_id`

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
    tier?: 'system' | 'tool' | 'project';
    importance?: number;
    priority?: number;             // 仅迁移兼容
    tokens: number;
    trimmed: boolean;
  }>;
  p0Intact: boolean;               // 兼容字段；现表示 system 层完整
  droppedLayers: string[];
  recalledArtifacts: number;       // 记忆命中数（本期恒 0）
}
```
**健康度判据**（写入 `context_health.summary`）：
- `healthy`：saturation < 0.8 且 p0Intact = true
- `saturated`：saturation ∈ [0.8, 1.0) 或 project 层发生裁剪
- `degraded`：saturation ≥ 1.0 或 p0Intact = false（告警）

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
- **降级前**：A2A 派发自建 prompt（`renderDispatchPrompt`），独立预算（chain depth 8），绕过 PromptComposer
- **降级后**：A2A 只产出交接包（possession contract 不变）；派发时以 `trigger=a2a_handoff` + `a2aHandoff` source 调 ContextManager；chain depth 作为 source 内元数据保留（交接包内 `remainingBudget`），不再作为顶层预算
- 收益：A2A 派发的 prompt 与主循环**同享预算、层优先级、作用域、身份**；"一半战场"补齐

### 5.8 分阶段
- **P1（非破坏）**：`ContextManager` 接口 + 主循环改走它（PromptComposer 委托）+ `project_id` 作用域 + scopeGuard + Health 层回写 + MemoryHook 契约 NoOp。A2A 路径**暂不动**，并行运行。
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

---

## 6. 影响面

- **新增**：`src/lib/agent-context/ContextManager.ts`、`ContextProviders.ts`、`MemoryHook.ts`、`ContextReport.ts`、`scopeGuard.ts`、`IdentitySnapshot` 类型
- **改**：`PromptComposer.ts`（委托 ContextManager）、`src/store/daemonStore.ts`（dispatch 改调 `assembleContext` + 显式传 budget）、`layers/projectLayer.ts`（加 id + scope）、`layers/historyLayer.ts` / `taskContextLayer.ts` / `teamPackLayer.ts`（按 project_id 过滤）、`src/server/repositories/session-repo.ts`（新增 `writeContextHealth`）
- **P2 改**：`src/server/a2a/context-builder.ts`（`renderDispatchPrompt` 退役，改为构造 a2aHandoff source）、`daemon.ts`（A2A 派发点改调 ContextManager）
- **不改**：`a2a-possession-contract/` 语义、`BudgetGuard` / `ContextBudget` 算法（复用）、`cli-bridge-layer/`、15 个 `buildXxxLayer` 签名
- **测试**：ContextManager / scopeGuard / identity 边界 / ContextReport / MemoryHook NoOp 各配套 `.test.ts`；A2A 派发 prompt 等价性测试（降级前后行为对齐，P2）
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
| 主循环收口回归面大（前端 dispatch 是主路径） | P1 保留 `PromptComposer` 旧入口灰度，feature flag 切换 |
| A2A 降级改变派发 prompt 文案，影响 agent 行为 | P2 先加等价性测试（关键段不丢），灰度 |
| project_id 过滤漏掉某层 → 串话 | scopeGuard 断言 + 每层单测；history/task/teamPack 逐层验证 |
| 健康度回写拖慢 dispatch | Q3 选异步 fire-and-forget |
| Memory 契约签名单点返工 | P1 即冻结签名 + NoOp 测试，记忆 spec 接入零组装层改动 |
| 身份快照陈旧 | 只读快照 + 角色/人格变更走既有 role_cards / team_pack 更新通道，不在 ContextManager 内写 |
| 跨项目隔离被未来需求侵蚀 | 5.4 边界纪律写进 spec + 钉死边界测试；任何"跨项目带历史"需求必须先改本 spec |

---

## 9. 验收指向（checklist.md 于 spec 通过后补）

核心五条：
1. 主循环与 A2A 派发**同走 ContextManager**，共享同一 `ContextBudget` 与层优先级（A2A 验收在 P2）
2. `agent_session.context_health` / `usage_snapshot` 在每次 dispatch 后有真实写入，可查
3. 跨项目：agent 在项目 A 的 history / task 不出现在项目 B 的 prompt 中（scopeGuard 生效）
4. 跨项目身份：同一 agent 多项目，prompt 中身份段一致、项目段隔离；记忆层为空
5. `MemoryHook.recall/write` 契约签名冻结，NoOp 实现可被记忆 spec 平滑替换；A2A 降级后交接包经 ContextManager 注入，关键约束段不丢
