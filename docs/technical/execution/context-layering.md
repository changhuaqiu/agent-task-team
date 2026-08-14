# Agent 上下文分层与边界设计（Context Layering & Boundary Design）

> 日期：2026-07-14 ｜ 状态：有效·当前事实已同步 ｜ 归属：Agent Task Hub / 上下文管理模块
> 关联：`specs/context-manager/spec.md`（实现 spec，本设计是其分层与边界依据）、`docs/daily/2026-07-14-collab-efficiency-retro.md`（协作效率复盘·元病灶）、`docs/archive/specs/context-budget-management/`（已归档的预算守护基线）
> 参照：Claude 的 `tools→system→messages` 稳定性分层与 context editing/compaction；CrewAI 的作用域记忆模型与 hierarchical manager
> 一句话定位：**上下文管理器是“单一注入网关 + 稳定性三层 + Context Artifact/Registry”的纯组装引擎，并把角色过程/看板 schema 还给各自模块。**

---

## 0. 背景与动机

07-14 协作复盘给出元病灶：**不是没干活，是干的活在 agent 之间蒸发**。根因不是 token 不够，是上下文在 gate 前反复降维——六轮评审每轮重读看板、reject 写成 600 字散文、知会 @dk 不触发执行。

用户洞察凝成一条核心原则：

> **目标共享，轨迹隔离**（goals shared, trajectories isolated）

下游 agent 需要的是**目标与决策**（为什么做、什么算 done、谁在做），不是上游的**完整思考轨迹**（探索过哪些死路、中间怎么推理）。这条原则要落成可执行的机制，而不是口号。

历史 `ContextManager` 曾是**扁平的功能层 + P0–P4 优先级整数**，且把角色过程、看板 schema 混在一起；当前实现已按本设计收敛为 Tier renderer → Fragment → Registry/Artifact → Budget 的单向管线。

---

## 1. 设计原则（三条，全部贯穿）

1. **单一注入网关**：所有模块（记忆/角色/任务/A2A/协议/质量）的数据，**只经上下文管理器一道闸**进 agent。任何模块都不得直连 agent。
2. **稳定性分层**：按"多稳定"分三层（系统/工具/项目），**稳定性顺序 = 渲染顺序 = 裁剪逆序**，取代任意 P0–P4 整数。
3. **内容无感**：Registry 校验 Fragment 的 `kind/cluster/producer/scope/visibility/freshness` 后归一化为 Artifact；BudgetGuard 只消费 `delivery.importance/required` 等选择元数据，文本或 artifact reference 保持不透明。

---

## 2. 三层模型（Claude 校准）

Claude API 的渲染顺序是 `tools → system → messages`，对应三个缓存层级——位置越靠前越稳、越不动、越后裁。本设计采纳"位置即稳定性"的思想（注意：本项目每次 dispatch 是冷启动 CLI 进程，prompt caching 不直接生效，但稳定性顺序仍决定**裁剪顺序**与**基础提示精简度**）。

```
Tier 1 系统层   [稳·永不裁]  role / protocol / collaboration / behavior
                              ← Claude system + 持久指令
Tier 2 工具层   [按角色·极少裁]  skill / tool（按 RoleCard 抽，角色天然不同）
                              ← Claude tools（最稳，角色差异的天然落点）
Tier 3 项目层   [可裁]
   ├ 团队可见  scope=project(projectId), visibility=team       （目标/决策/看板）
   │                                       ← Claude mid-conversation system + durable memory
   └ 定向可见  scope=project(projectId), visibility=agent/role （任务、交接、轨迹）
                                     ← Claude messages（最易失效）+ context editing 裁剪对象
```

- **裁剪顺序**（取代 P0–P4）：系统层永不裁 → 工具层极度紧张才裁 → 项目层先裁；项目层内按 importance 升序，**轨迹(低)先于目标(高)**。
- **系统层 vs 工具层的前后**（开放问题 Q1）：Claude 把 tools 排在 system 前（工具更少变）。本设计默认**系统层在前**（符合"身份是根基"），可按实际变更频率调。

---

## 2.1 四层语义分组（代码组织层，2026-07-17 落地）

> 状态：已落地（`src/lib/agent-context/tiers/`）。与 §2 的稳定性三层是**正交**关系：三层管"裁剪顺序"，四层管"代码怎么组织 + 谁负责哪些 layer"。

§2 的三层模型解决了"先裁谁"，但留下一个问题：15 个 `buildXxxLayer` 在 `assembleContext` 里扁平堆叠，新增一个 layer 要改 4 处（文件 / import / push / descriptor），且语义边界只在维护者脑子里。2026-07-17 的四层重构把它们按**语义职责**收进 4 个深模块（tier renderer），每个 tier 是一个 `render(ctx) → BudgetPart[]` 纯函数，内部管自己的 push（gated by injectionPolicy）。

```
SystemTier      role / collaboration / protocol / behavior          ← 你是谁 + 协作规则
KnowledgeTier   skill / tool / team / teamPack / history            ← 你知道什么（能力 + 记忆）
TaskTier        task / a2a                                          ← 你在做什么（焦点 + 交接包）
InteractionTier userMessage / teamLog                               ← 当前这轮说什么
```

**关键约束：tier 不改变 BudgetPart.tier 的值。** 四层是代码组织分组；BudgetGuard 仍按 §2 的 system/tool/project 三层裁剪。一个 layer 属于哪个语义 tier（代码放哪）和它带什么 tier 标签（怎么裁）是两个独立决策。

**修正了三处历史归属错误**（评估稿 `docs/plans/2026-07-17-agent-context-architecture-review.md` 诊断）：
- `projectStatus`：曾混在系统层 → 现归任务上下文（看板状态高频变化，不是身份）
- `history`：曾属 dialog → 现归知识层 memory（对话历史是"记忆"，不是"交互"）
- `teamLog` 投影：曾属知识层 → 现归交互层（每轮不同的增量，不是稳定知识）

**收益**：新增 layer 只改一个 tier 文件（深模块的 locality）；assembleContext 从扁平 push 清单收敛为编排；结构化 scope/visibility/source 在 Context Registry 中成为 BudgetGuard 之前的真正过滤 stage。

**退役记录（2026-07-22）**：主循环与 harness 已通过 `context-planner → ContextManager` 直接组装；生产代码与公共导出零调用审计通过后，`PromptComposer.ts` 兼容包装及只验证包装的测试已删除。仍有效的 role/team/collaboration/user-message/behavior layer 行为测试保留在各 layer 的同目录测试中，防止兼容层退役造成语义覆盖下降。

---

## 3. ContextArtifact 的 scope / visibility / importance

当前统一模型是 `ContextArtifact`。它把“目标共享/轨迹隔离”表达为结构化 scope 与 visibility，并把裁剪权重放在 delivery 中：

```ts
interface ContextArtifact {
  semantic: { kind: string; cluster: ContextCluster };
  scope: { kind: 'project'; projectId: string } | { kind: 'global'; key: string };
  visibility:
    | { kind: 'team' }
    | { kind: 'agent'; agentId: string }
    | { kind: 'role'; archetypes: ContextArchetype[] };
  source: { provider: string; owner: string; revision: string; observedAt: string };
  delivery: { mode: DeliveryMode; channel: DeliveryChannel; required: boolean; importance: number };
  content: string | { artifactRef: string };
}
```

标签值示例：

| 上下文 | scope | visibility | delivery.importance | semantic.kind |
|---|---|---|---|---|
| 项目目标/决策 | project(projectId) | team | 0.8 | decision |
| 看板/任务状态 | project(projectId) | team | 0.6 | kanban |
| 分配给“我”的任务 | project(projectId) | agent(agentId) | 0.8 | task |
| Mario 的协调轨迹 | project(projectId) | agent(mario) | 0.3 | trajectory |
| DoD / 验收标准 | project(projectId) | role(reviewer) | 0.9 | acceptance |

> importance 是建议默认值（可调），关键是**相对序**：系统层高、轨迹低。Registry 对 content 不透明：它先验证 Fragment 的 `kind/cluster/producer/scope/visibility/freshness`，再归一化生成 Artifact 的 `semantic/source/lifecycle/delivery`；新增业务语义不需要新增第二套记录模型。

---

## 4. 模块边界契约

### 一句话职责

> **上下文管理器在 dispatch 时，为某个 (agent, project, trigger, task) 组装一份"最小、可见性正确、预算受控"的上下文——仅此而已。** 纯组装/选择引擎：只读输入 → `AssembledContext`。不控制行为、不执行质量、不调度任务、不存状态。

### IN（本模块拥有，高内聚）

1. 分层组装（系统/工具/项目三层裁剪 × 系统/知识/任务/交互四层语义组织，见 §2.1）
2. 可见性过滤（结构化 project/global scope + team/agent/role visibility）
3. 预算裁剪（importance 复合分）
4. 上下文归一化（每条带 semantic/scope/visibility/source/lifecycle/delivery）
5. 健康报告（`ContextReport` → observation span attributes → 项目观测投影）
6. 组装契约 + Artifact schema（`ContextArtifact`，版本化契约）

### OUT（别的模块的活，通过窄只读接口接入）

| 关注点 | 归属 | 接入缝（只读） |
|---|---|---|
| 每个角色如何处理事情（角色工作过程） | RoleCard + per-role Skill | `getRoleCard()` |
| agent 如何管理自己的上下文（自管理） | Memory / SelfMgmt（未来独立 spec） | 真实读取来源实现 `ContextContributor`；写入不属于 ContextManager |
| 如何做质量管理（DoD/评审/门禁） | quality_gate（Peach + gate 协议） | DoD 作 `category='acceptance'` 高优标签入上下文；enforcement 读 `ContextReport` |
| 任务拆解/调度 | orchestrator（daemon） | `getTask/getTasks/getRuntimeRoster` |
| 跨 agent 协议（handoff/持球） | platform-harness-state-machines | `a2aHandoff` source |
| 向量记忆/语义检索 | memory spec（deferred） | 不预留专用 seam；真实 owner 成立后复用 `ContextContributor` |

### 低耦合三条硬规则

1. **只读原则**：对所有外部数据只读不写（任务/消息/角色/交接包均不 mutate）。报告复用本轮 observation span 持久化，不由 ContextManager 建立独立写链。
2. **纯函数原则**：`assembleContext(req)` 是 `(ContextRequest, providers快照) → AssembledContext` 的纯函数，无隐藏状态。
3. **唯一耦合面 = `ContextProviders` 接口**：所有 store 访问走 Provider，不直连 store。

> ⚠️ 现存耦合债：`ContextManager.ts:23` 直接 `import { AGENT_ROSTER } from '@/store/agentStore'`，绕过 Provider。落地时改为 `providers.getRuntimeRoster()`。

### write 反向流（不画进注入图）

记忆写入属于 agent turn 之后的 OUT 自管理，**不经组装**。ContextManager 不声明写协议；未来 memory 模块自行拥有持久化与恢复契约，只把需要注入的读取结果通过 `ContextContributor` 送入 Registry。

---

## 5. 单一注入网关流程

```
   数据生产者（各自拥有域，只读出）              唯一注入网关                消费者
   ┌──────────────────────────────┐        ┌──────────────────────┐      ┌────────────┐
   │ 业务 ContextContributor      │fragment│ 组装：系统/工具/项目   │prompt│  单个 agent │
   │ 角色模块 RoleCard/TeamPack   │────────▶│ Registry：scope +     │─────▶│  运行时     │
   │ 任务/编排 daemon             │ getRole │ visibility + freshness│      │ (OpenCode/  │
   │ 消息/轨迹 messageRepo        │ getTask │ Budget：delivery 元数据│      │  Claude/CLI)│
   │ A2A 协议 possession          │ getMsg  │ 无感                  │      └────────────┘
   │ 质量模块 quality_gate(future)│ handoff │                      │ report
   │ 协作协议 .ath/PROTOCOLS.md   │ DoD标签 │ 纯函数·只读·无 mutate │─────▶ 可观测/质量
   └──────────────────────────────┘ getProto│                      │      (Peach 读 Report)
                                          └──────────────────────┘
        └── 所有生产者数据，只此一条路进 agent ⛔ 不得绕过网关直连 ──┘
```

不变量：**没有任何箭头从生产者直连 agent。** Contributor 产出 Fragment；Registry 按结构化 scope/visibility/freshness 过滤并归一化 Artifact，BudgetGuard 再按 delivery 元数据决定装多少——**生产者不碰组装，上下文管理器不碰检索，职责正交**。

---

## 6. 协作规则的落点：`.ath/PROTOCOLS.md` + `getProtocol()`

第三节标记的"协作协议不写死"，具体落法：

**协议是项目/团队的数据产物，上下文管理器是消费者。** 这个家团队已自定（`protocolLayer.ts:68` 与 retro M1 均指向 `.ath/PROTOCOLS.md`）。

**三层合并**（类比 Claude CLAUDE.md 多 scope 向上拼接）：
1. **基础协议**（全系统通用）：A2A 唤醒语法、回声防护、自启动规则——随系统发布的**默认模板（数据文件，非代码常量）**。
2. **项目/团队协议** `.ath/PROTOCOLS.md`：覆盖/扩展基础协议。Mario/团队维护，正常 doc 流程演进——**改协议不改代码、不重新构建**。
3. **合并**：provider 合成最终文本。

**接入缝**：
```ts
getProtocol(scope: string): Promise<string>  // 读 .ath/PROTOCOLS.md + 合并基础默认
```
注入为 protocol cluster 的 project-scoped、team-visible Fragment，归一化后由 `delivery.importance` 参与选择；内容对 Registry 与预算模块不透明。

**三个别混**：

| 关注点 | 落点 | 缝 |
|---|---|---|
| 协作协议（A2A 语法/协调/回声） | `.ath/PROTOCOLS.md` + 基础默认 | `getProtocol()` |
| 看板 schema（TASKS.md 格式，泄漏 #2） | **orchestrator 拥有**（它管 TASKS.md） | `getTaskBoardContract()` |
| 角色过程（planner 拆解规则等，泄漏 #1） | **RoleCard / per-role Skill** | `getRoleCard()` |

---

## 7. 现有各层归位 + OUT 泄漏诊断

### 7.1 归位表

**Tier 1 系统层（永不裁）**

| Layer | 现 P | scope | visibility | importance | cluster | 裁决 |
|---|---|---|---|---|---|---|
| roleLayer | sys | project | agent/role | 0.9 | identity | IN，**有 OUT 泄漏**⚠️ |
| collaborationLayer | 1 | project | team | 0.8 | protocol | IN，建议外置 → `.ath/PROTOCOLS.md` |
| behaviorLayer | 0 | project | team | 0.7 | protocol | IN（收尾决策），可并入 collaboration |
| protocolLayer | 0 | project | team | 0.7 | protocol | **拆分**：身份行 IN（Tier1）/ 看板 schema OUT（orchestrator，泄漏 #2） |

**Tier 2 工具层（极少裁，按角色）**

| Layer | 现 P | scope | visibility | importance | cluster | 裁决 |
|---|---|---|---|---|---|---|
| skillLayer | 3 | project/global | agent/role | 0.6 | capability | IN |
| toolLayer | 3 | project/global | agent/role | 0.6 | capability | IN（已按 RoleCard 抽） |

**Tier 3 项目层（可裁）**

| Layer | 现 P | scope | visibility | importance | cluster | 裁决 |
|---|---|---|---|---|---|---|
| projectLayer | sys | project | team | 0.7 | situation | IN |
| projectStatusLayer（看板） | sys | project | team | 0.6 | situation | IN |
| teamLayer（花名册） | 2 | project | team | 0.5 | situation | IN |
| teamPackLayer（目标/规范） | 1 | project | team | 0.6 | situation | IN |
| taskContextLayer（分配任务） | 0 | project | agent | 0.8 | focus | IN |
| a2aLayer（交接目标段） | 1 | project | agent | 0.7 | focus | IN |
| historyLayer（轨迹） | 4 | project | agent | 0.3 | dialog | IN |
| userMessageLayer（触发） | 0 | project | agent | 0.9 | focus | IN（始终注入） |

### 7.2 OUT 泄漏（边界试金石）

**⚠️ 泄漏 1：`roleLayer.ts:60-93` 硬编码角色工作过程。** 三段 `if (roleCard.category === 'planner'/'code_reviewer'/'arch_reviewer')` 把 Mario 的 PHASE→TASK 拆解规则、Peach 的 quality_gate 职责写死在上下文管理器。→ 迁到 RoleCard / per-role Skill，roleLayer 只泛化渲染 RoleCard。

**⚠️ 泄漏 2：`protocolLayer.ts:17-70` 硬编码 orchestrator 的看板 schema。** TASKS.md 表结构、列说明、状态流转、planner guidance 写死。→ 看板 schema 归 orchestrator（`getTaskBoardContract()`），protocolLayer 只留通用身份约束 + 资源指引。

**🟡 边界案例：`collaborationLayer` + `behaviorLayer`。** 通用协作协议（A2A 语法、自启动、回声防护）是所有 agent 都需要的跨切面系统约束，**合法属于系统层 IN**，但应外置到 `.ath/PROTOCOLS.md`（见 §6）而非硬编码。

---

## 8. BudgetGuard 改造：P0–P4 整数 → 结构层 + importance

```ts
// 已删除的旧契约
interface BudgetPart { layer: string; content: string; priority: number } // 0–4

// 当前契约
interface BudgetPart {
  layer: string; content: string;
  tier: 'system' | 'tool' | 'project';   // 结构层（硬约束）
  importance: number;                      // 0–1（层内排序）
  required?: boolean;                      // 必需内容先建立预算最低配额
}
```
> `tier` 是 BudgetGuard 的兼容组装元数据；当前 Artifact 由 `semantic.cluster` 与 `delivery` 表达结构和重要性，Registry 在进入预算裁剪前完成 scope/visibility 过滤。

裁剪规则（取代 P0–P4 排序 + P0 硬上限 50%）：
1. `system` 层按既有规则先处理；
2. required tool/project part 先建立预算最低配额，跨层先于所有可选 part；
3. 剩余可选内容仍按 `tool` → `project`、同层 importance 降序选择；
4. required 集合自身无法装入时仍裁剪并 fail closed；
5. token 估算（字符/4）与"保持原呈现顺序"逻辑保留。

`ContextBudget`（maxTokens/reserveRatio）不动，消费方只读取 `tier + importance`；旧 `priority` 入口已删除。

---

## 9. 可见性矩阵（Lead/Teammate）

> 修正早先"对 teammate 藏共享目标"的过度简化——那会加重蒸发。retro 病根是 teammates 缺共享的决策/看板/DoD。

**"每个人看到的不一样"不靠藏共享目标，而靠结构化 scope 与 visibility：共享基底对团队可见，分配任务、交接和轨迹只对目标 agent/role 可见。**

| 维度 | 内容 | scope | visibility | subject / 接收者 |
|---|---|---|---|---|
| 共享基底 | 目标/决策/看板/花名册/协议 | `project(projectId)` | `team` | 当前项目团队 |
| 分配焦点 | 分配给“我”的 task | `project(projectId)` | `agent(agentId)` | assignee |
| 交接目标段 | 收到的 handoff | `project(projectId)` | `agent(agentId)` | 接收方 |
| 个体轨迹 | “我”的对话/探查摘要 | `project(projectId)` | `agent(agentId)` | 轨迹所有者 |
| 角色身份 | RoleCard 身份与职责 | `global` | `agent` 或 `role` | 指定 agent / archetype |

**Registry 过滤规则**：`project` scope 必须等于查询的 `conversationId`；`global` scope 只允许 identity/protocol/capability 等受控 cluster，并要求 agent/team subject。通过 scope 后，`team` 对项目团队可见，`agent` 必须精确匹配 `query.agentId`，`role` 必须命中查询 archetype。

Mario 的"全局视野"是**角色职责驱动他用全量共享基底**做分派，不是特权层。

---

## 10. L1 / L2 / L3 衔接（Artifact 统一机制）

同一套结构化 Artifact 契约跨三层边界：

```
L1 单 agent 组装：Registry 按 scope+visibility 选择 Artifact → 组装进单个 prompt
L2 跨 agent handoff：Contributor 生成 receiver-visible Handoff Artifact/Packet → 下游 a2aLayer 接收
L3 跨项目身份：身份 Artifact 使用 global scope + agent/role subject；project scope Artifact 不跨项目跟随
```

**L2 HandoffSnapshot 使用显式 packet schema，而不是从通用记录中按布尔标志抽取。** retro §5.2 的字段（task/acceptanceCriteria、openDecisions、selfCheckEvidence、changeScope、handoffNote）由 handoff contributor 明确产出，并标注当前项目 scope 与接收方 visibility；上游推理和探查轨迹不属于 packet schema，因此不会进入 handoff。

---

## 11. 范围与非目标

**本设计覆盖**：上下文管理器的分层模型、边界契约、标签机制、可见性、裁剪改造、协作协议落点。

**明确不在本期**：
- 向量记忆 / 语义检索 / consolidation 合并（CrewAI Unified Memory 级）→ L3 memory spec，deferred。本期只采用结构化 `scope/visibility` 与 `delivery.importance`，不引入向量库。
- 角色工作过程的具体定义（Mario 怎么拆解、Peach 怎么评审）→ RoleCard / Skill。
- 质量门禁的 enforcement（DoD/评审/门禁执行）→ quality_gate 模块；上下文管理器只携带 DoD 作标签。
- 任务拆解/调度 → orchestrator。
- A2A 持球/交接语义本身 → platform-harness-state-machines。

**排序约束**：OUT 泄漏迁移（roleLayer/protocolLayer 重构）仍排在 TASK-006 收口之后；结构化 Fragment/Artifact、Registry scope/visibility 过滤与 delivery importance 已成为当前事实，不再为 history 层维护第二套标签模型。

---

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 分层重构冲击在审的 TASK-006 | OUT 泄漏迁移延后到 TASK-006 收口后；立即可做的（BudgetGuard 字段、标签）低风险 |
| importance 默认值拍脑袋 | 明确为"可调建议值"，关键是相对序；上线后按 `ContextReport` 实测调 |
| `.ath/PROTOCOLS.md` 协议碎片化 | 基础默认模板 + 项目覆盖两层合并；retro M1 已建维护流程 |
| scope/visibility 漏标导致串话/泄漏 | ContextManager intake 失败关闭 + Registry 过滤 + 每层单测；跨 agent/跨项目边界钉死测试 |
| category 滥用退化为散文 | category 对核心无感，但每条须带可执行语义（acceptance 带 DoD 命令，非散文）|

---

## 13. 开放问题

- **Q1**：系统层 vs 工具层的前后顺序（默认系统层在前，可按变更频率调）。
- **Q2**：`.ath/PROTOCOLS.md` 是否分文件（协作协议 / gate 定义 / 看板 schema）还是单文件分节——由协议维护方（Mario/团队）定，不影响本设计。
- **Q3**：handoff 内“目标段 vs 轨迹段”的切分粒度——由显式 Handoff Packet schema 与接收方 visibility 决定，不由渲染层解析通用记录。

---

## 14. 与现有产出关系

- **`specs/context-manager/spec.md`**：活动实现 spec，本设计是其**分层与边界依据**。该 spec 的 §5.2（对内分层）、§5.5（健康度）已同步当前契约；P0–P4 优先级已被 §8 的结构层与 importance 取代。
- **`docs/daily/2026-07-14-collab-efficiency-retro.md`**：元病灶来源。本设计的 §3 标签机制 + §10 L2 衔接直接对应 retro 的 M8（HandoffSnapshot）与"上下文管理器"元论点。
- **`hello-agents/context-management-research.md`**：调研基线（Claude / OpenCode / MemGPT / mem0 分类），本设计在其分类框架内选定"显式管理派 + 稳定性分层"。
# 2026-07-18 线上缺陷修正规则

- `trigger` 表示输入来源，`scenario` 表示注入策略。目标 agent 在当前项目没有 active session 时，无论来源是 user 还是 A2A，都必须采用 `init` 注入策略。
- 首次 A2A 仍保留 handoff artifact，因此 bootstrap identity/system prompt 与交接 focus 必须同时存在；已有 session 的 A2A 才省略 identity。
- 会话资源路径只能由 runtime 注入绝对路径。protocol layer 不得硬编码 `.ath/TASKS.md` 等相对路径。
- role、teamPack、protocol、collaboration、behavior 的职责边界以 `docs/archive/specs/open-issues-33-35/spec.md` §3.3 为准，禁止在多个 layer 重复同一动作规则。

---

## 15. Team Harness Context Module（2026-07-19，已落地第一阶段）

### 背景

当前 ContextManager 已统一预算、四层渲染、可见性和场景策略，但固定 `ContextProviders` 仍让新增业务上下文必须修改 Manager；`ContextReport` 主要描述 Prompt layer，无法证明本轮使用了哪一版事实、哪些事实过期或缺失。

### 决策

保持 `assembleContext(request)` 这个深模块 interface 不变，在内部增加 Fragment 管线：

```text
Native Tier Fragments ┐
Project/Delivery/... ─┼─> Contributor Registry
Future real source ───┘       ↓
                        validate / normalize
                  Fragment → six-dimensional Artifact
                              ↓
                            dedupe
                        scope / visibility
                        freshness / scenario
                        budget / required gate
                              ↓
                       ContextSnapshot
                              ↓
                    compiled prompt + report
```

Context State 由各事实域拥有；ContextManager 不复制事实源，只在 dispatch 时生成场景化只读 Snapshot。Contributor 是多个事实域接入同一 seam 的 adapter，不拥有 Prompt 排版权。`ContextFragment` 是接入格式，Registry 会把它归一化为 `semantic/source/lifecycle/visibility/consistency/delivery` 六维 `ContextArtifact`，复用既有结构化上下文设计，不形成第二套模型。

### 事实源与责任

| 事实 | Owner | Context 模块责任 |
|---|---|---|
| Task、Ownership、Blocker | Task/A2A 模块 | 查询并选择相关 Fragment |
| Repo、文档、ADR | Project Knowledge | 按场景、freshness 和预算投影 |
| Decision、Fact、Lesson（未来） | Memory | 真实 owner 成立后通过 Contributor 进入统一过滤 |
| Tool、账号、权限 | Capability/Control Plane | 注入本轮可用能力与限制 |
| Review、Web UI E2E、CI | Evidence Plane | 注入精确 Receipt 引用，不复制结果真相 |
| Prompt / ContextSnapshot | ContextManager | 唯一组装权与本轮投影事实 |

### 替代方案

- **新增第二个 Context Service**：拒绝。会形成新旧两条 Prompt 管线，调用方需要理解两套接口。
- **让每个业务模块返回 Prompt 字符串**：拒绝。作用域、时效、预算和可见性规则会重新散落。
- **保留 Tier/Artifact 双身份**：拒绝。Tier renderer 只负责确定性内容构建，并直接赋予稳定 Fragment 身份；Registry 后不再恢复旧 Prompt part。

### 后果

- 新上下文来源只需实现 Contributor，ContextManager 主流程保持稳定。
- Snapshot 成为 Harness 的可观察输入证据，可支持 no-progress、恢复和调试。
- 四个 Tier renderer 与业务 Contributor 都只通过同一 Fragment → Artifact → budget 管线，没有 legacy 往返。
- 当前动作、Goal/验收、授权约束和 required Skill 缺失时 fail closed；不能为了“让 Loop 继续”牺牲正确环境。
- Task/project 双层隔离、global subject 白名单和错误脱敏属于 Registry 的机械边界，不交给 Prompt 自觉。
- 成功 Snapshot 使用完整脱敏 manifest 的 SHA-256 标识，并暴露 scope、subject、visibility、source owner、consistency 与 delivery 元数据。
- required 失败在 dispatch 前写入脱敏 error context span，调试页可以直接看到场景、缺失项和 omission，而不是只在后端日志中失败。

### 15.1 能力复用边界

Harness 不重新实现成熟执行能力，只建设“能力发现、场景选择、权限门禁、调用回执和失败恢复”的环境层：

| 能力 | 复用事实源 | Harness 增量责任 |
|---|---|---|
| 任务方法 | 版本化 Skill Runtime | 激活、revision/hash 校验、按需资源引用、required fail-closed |
| 工具接入 | ACP/MCP runtime 实际注册目录 | Capability Snapshot、scope/policy 门禁、调用回执 |
| Web UI 验证 | Browser/Playwright | 验收步骤、浏览器级 Receipt、失败分类 |
| Provider 操作 | 官方 API/CLI/Provider Adapter | 幂等键、权限边界、终态 reconcile |
| 项目知识 | repo/docs/ADR/测试入口 | 索引、freshness、provenance、JIT 引用 |

平台不复制这些工具的执行内核；只保证 Agent 在自己的 Loop 中拿到正确能力，并把结果写回下一轮可消费的事实。
