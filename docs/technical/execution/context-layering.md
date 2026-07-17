# Agent 上下文分层与边界设计（Context Layering & Boundary Design）

> 日期：2026-07-14 ｜ 状态：设计稿·待审 ｜ 归属：Agent Task Hub / 上下文管理模块
> 关联：`specs/context-manager/spec.md`（实现 spec，本设计是其分层与边界依据）、`docs/daily/2026-07-14-collab-efficiency-retro.md`（协作效率复盘·元病灶）、`docs/archive/specs/context-budget-management/`（已归档的预算守护基线）
> 参照：Claude 的 `tools→system→messages` 稳定性分层与 context editing/compaction；CrewAI 的 `scope + private + importance` 记忆模型与 hierarchical manager
> 一句话定位：**把上下文管理器重新定义为"单一注入网关 + 稳定性三层 + scope/private 标签"的纯组装引擎，并把它现在越界碰的角色过程/看板 schema 还给各自模块。**

---

## 0. 背景与动机

07-14 协作复盘给出元病灶：**不是没干活，是干的活在 agent 之间蒸发**。根因不是 token 不够，是上下文在 gate 前反复降维——六轮评审每轮重读看板、reject 写成 600 字散文、知会 @dk 不触发执行。

用户洞察凝成一条核心原则：

> **目标共享，轨迹隔离**（goals shared, trajectories isolated）

下游 agent 需要的是**目标与决策**（为什么做、什么算 done、谁在做），不是上游的**完整思考轨迹**（探索过哪些死路、中间怎么推理）。这条原则要落成可执行的机制，而不是口号。

现有一个 `ContextManager`（`specs/context-manager/`，正在 review），但它是**扁平的功能层 + P0–P4 优先级整数**，且把角色过程、看板 schema 混了进来。本设计重构它的分层与边界。

---

## 1. 设计原则（三条，全部贯穿）

1. **单一注入网关**：所有模块（记忆/角色/任务/A2A/协议/质量）的数据，**只经上下文管理器一道闸**进 agent。任何模块都不得直连 agent。
2. **稳定性分层**：按"多稳定"分三层（系统/工具/项目），**稳定性顺序 = 渲染顺序 = 裁剪逆序**，取代任意 P0–P4 整数。
3. **category 无感**：上下文管理器只用 `importance`（裁剪）和 `scope + private`（可见性）做决策，把 `category` 和 `content` 当不透明载荷。新场景 = 新 category 标签，核心零改动（留空间）。

---

## 2. 三层模型（Claude 校准）

Claude API 的渲染顺序是 `tools → system → messages`，对应三个缓存层级——位置越靠前越稳、越不动、越后裁。本设计采纳"位置即稳定性"的思想（注意：本项目每次 dispatch 是冷启动 CLI 进程，prompt caching 不直接生效，但稳定性顺序仍决定**裁剪顺序**与**基础提示精简度**）。

```
Tier 1 系统层   [稳·永不裁]  role / protocol / collaboration / behavior
                              ← Claude system + 持久指令
Tier 2 工具层   [按角色·极少裁]  skill / tool（按 RoleCard 抽，角色天然不同）
                              ← Claude tools（最稳，角色差异的天然落点）
Tier 3 项目层   [可裁]
   ├ 共享体  private=false, scope=/project        （目标/决策/看板/task/handoff目标）
   │                                       ← Claude mid-conversation system + durable memory
   └ 私有体  private=true,  scope=/project/<agent> （该 agent 的轨迹）
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

**收益**：新增 layer 只改一个 tier 文件（深模块的 locality）；assembleContext 从 254 行的扁平 push 清单收敛为 ~20 行编排；可见性标签（scope/private/source）接线成 BudgetGuard 之前的真正 stage（spec §9，此前只写不读）。

**待办**：`PromptComposer.ts` 的删除（消除首次唤醒双组装 + 循环依赖）留到下一轮，届时 daemonStore 改为直接构造 ContextManager。当前 PromptComposer 作为兼容包装仍存在。

---

## 3. scope / private / importance 标签机制（CrewAI 校准）

参考 CrewAI 的 `MemoryRecord`（`memory/types.py`），把"目标共享/轨迹隔离"从**结构切分**升级为**字段标签**——更灵活，且直接回答"谁看到什么"：

```ts
interface ContextRecord {
  scope: string;        // 层级路径 "/project" 或 "/project/<agentId>"  ← 可见性边界
  private: boolean;     // true=仅同源可见 / false=共享                  ← 轨迹隔离开关
  importance: number;   // 0.0–1.0，裁剪排序键                            ← 取代 P0–P4
  category: string;     // 标签：identity|protocol|task|trajectory|handoff-goal|acceptance|... （对核心无感）
  content: string;      // 文本载荷（对核心无感）
  source?: string;      // 来源 agent/session，溯源 + 隐私过滤
}
```

标签值示例：

| 上下文 | scope | private | importance | category |
|---|---|---|---|---|
| 项目目标/决策 | `/project` | false | 0.8 | decision |
| 看板/任务状态 | `/project` | false | 0.6 | kanban |
| 分配给"我"的任务 | `/project`（按 assignee 过滤）| false | 0.8 | task |
| Mario 的协调轨迹 | `/project/mario` | true | 0.3 | trajectory |
| DoD / 验收标准 | `/project` | false | 0.9 | acceptance |

> importance 是建议默认值（可调），关键是**相对序**：系统层高、轨迹低。`category` 和 `content` 对上下文管理器不透明——未来质量模块塞 `category='acceptance'`、自管理模块塞 `category='reflection'`，核心不动。这就是"留空间"。

---

## 4. 模块边界契约

### 一句话职责

> **上下文管理器在 dispatch 时，为某个 (agent, project, trigger, task) 组装一份"最小、可见性正确、预算受控"的上下文——仅此而已。** 纯组装/选择引擎：只读输入 → `AssembledContext`。不控制行为、不执行质量、不调度任务、不存状态。

### IN（本模块拥有，高内聚）

1. 分层组装（系统/工具/项目三层裁剪 × 系统/知识/任务/交互四层语义组织，见 §2.1）
2. 可见性过滤（scope 路径 + private 标志 + source 归属，2026-07-17 接线为真正的 stage）
3. 预算裁剪（importance 复合分）
4. 上下文打标（每条带 scope/private/importance/category/source）
5. 健康报告（`ContextReport` → `context_health` / `usage_snapshot`）
6. 组装契约 + 标签 schema（`ContextRecord`，版本化契约）

### OUT（别的模块的活，通过窄只读接口接入）

| 关注点 | 归属 | 接入缝（只读） |
|---|---|---|
| 每个角色如何处理事情（角色工作过程） | RoleCard + per-role Skill | `getRoleCard()` |
| agent 如何管理自己的上下文（自管理） | Memory / SelfMgmt（L3 spec） | `MemoryHook.recall/write`（已冻结 NoOp） |
| 如何做质量管理（DoD/评审/门禁） | quality_gate（Peach + gate 协议） | DoD 作 `category='acceptance'` 高优标签入上下文；enforcement 读 `ContextReport` |
| 任务拆解/调度 | orchestrator（daemon） | `getTask/getTasks/getRuntimeRoster` |
| 跨 agent 协议（handoff/持球） | a2a-possession-contract | `a2aHandoff` source |
| 向量记忆/语义检索 | memory spec（L3，deferred） | `MemoryHook` 预留位 |

### 低耦合三条硬规则

1. **只读原则**：对所有外部数据只读不写（任务/消息/角色/交接包均不 mutate）。唯一"副作用"是健康度回写，`fire-and-forget`，不构成控制依赖。
2. **纯函数原则**：`assembleContext(req)` 是 `(ContextRequest, providers快照) → AssembledContext` 的纯函数，无隐藏状态。
3. **唯一耦合面 = `ContextProviders` 接口**：所有 store 访问走 Provider，不直连 store。

> ⚠️ 现存耦合债：`ContextManager.ts:23` 直接 `import { AGENT_ROSTER } from '@/store/agentStore'`，绕过 Provider。落地时改为 `providers.getRuntimeRoster()`。

### write 反向流（不画进注入图）

`MemoryHook.write()` 是 agent turn 之后往记忆写——属于 OUT 的"自管理"，**不经组装**。上下文管理器只托管该 seam 的签名（保证契约稳定），不参与 write 策略。

---

## 5. 单一注入网关流程

```
   数据生产者（各自拥有域，只读出）              唯一注入网关                消费者
   ┌──────────────────────────────┐        ┌──────────────────────┐      ┌────────────┐
   │ 记忆模块 Memory (L3)         │ recall │ 组装：系统/工具/项目   │prompt│  单个 agent │
   │ 角色模块 RoleCard/TeamPack   │────────▶│ 可见性：scope+private │─────▶│  运行时     │
   │ 任务/编排 daemon             │ getRole │ 裁剪：importance 复合 │      │ (OpenCode/  │
   │ 消息/轨迹 messageRepo        │ getTask │ 打标：4字段·category  │      │  Claude/CLI)│
   │ A2A 协议 possession          │ getMsg  │ 无感                  │      └────────────┘
   │ 质量模块 quality_gate(future)│ handoff │                      │ report
   │ 协作协议 .ath/PROTOCOLS.md   │ DoD标签 │ 纯函数·只读·无 mutate │─────▶ 可观测/质量
   └──────────────────────────────┘ getProto│                      │      (Peach 读 Report)
                                          └──────────────────────┘
        └── 所有生产者数据，只此一条路进 agent ⛔ 不得绕过网关直连 ──┘
```

不变量：**没有任何箭头从生产者直连 agent。** 记忆模块决定"召回哪 10 条 durable 事实"，但召回结果作 source 喂给网关，由它按 scope/private/importance 决定怎么塞/塞多少/给谁看——**记忆模块不碰组装，上下文管理器不碰检索，职责正交**。

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
注入为系统层共享记录 `{scope:'/project', private:false, importance:0.8, category:'protocol'}`，内容对核心不透明。

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

| Layer | 现 P | scope | private | imp | category | 裁决 |
|---|---|---|---|---|---|---|
| roleLayer | sys | /project | F | 0.9 | identity | IN，**有 OUT 泄漏**⚠️ |
| collaborationLayer | 1 | /project | F | 0.8 | protocol | IN，建议外置 → `.ath/PROTOCOLS.md` |
| behaviorLayer | 0 | /project | F | 0.7 | protocol | IN（收尾决策），可并入 collaboration |
| protocolLayer | 0 | /project | F | 0.7 | protocol | **拆分**：身份行 IN（Tier1）/ 看板 schema OUT（orchestrator，泄漏 #2） |

**Tier 2 工具层（极少裁，按角色）**

| Layer | 现 P | scope | private | imp | category | 裁决 |
|---|---|---|---|---|---|---|
| skillLayer | 3 | /project | F | 0.6 | capability | IN |
| toolLayer | 3 | /project | F | 0.6 | capability | IN（已按 RoleCard 抽） |

**Tier 3 项目层（可裁）**

| Layer | 现 P | scope | private | imp | category | 裁决 |
|---|---|---|---|---|---|---|
| projectLayer | sys | /project | F | 0.7 | project | IN |
| projectStatusLayer（看板） | sys | /project | F | 0.6 | kanban | IN |
| teamLayer（花名册） | 2 | /project | F | 0.5 | roster | IN |
| teamPackLayer（目标/规范） | 1 | /project | F | 0.6 | norms | IN |
| taskContextLayer（分配任务） | 0 | /project | F | 0.8 | task | IN |
| a2aLayer（交接目标段） | 1 | /project | F | 0.7 | handoff-goal | IN |
| historyLayer（轨迹） | 4 | /project/**&lt;agent&gt;** | **T** | 0.3 | trajectory | IN（relevance stub 待修） |
| userMessageLayer（触发） | 0 | /project | — | 0.9 | user-input | IN（始终注入） |

### 7.2 OUT 泄漏（边界试金石）

**⚠️ 泄漏 1：`roleLayer.ts:60-93` 硬编码角色工作过程。** 三段 `if (roleCard.category === 'planner'/'code_reviewer'/'arch_reviewer')` 把 Mario 的 PHASE→TASK 拆解规则、Peach 的 quality_gate 职责写死在上下文管理器。→ 迁到 RoleCard / per-role Skill，roleLayer 只泛化渲染 RoleCard。

**⚠️ 泄漏 2：`protocolLayer.ts:17-70` 硬编码 orchestrator 的看板 schema。** TASKS.md 表结构、列说明、状态流转、planner guidance 写死。→ 看板 schema 归 orchestrator（`getTaskBoardContract()`），protocolLayer 只留通用身份约束 + 资源指引。

**🟡 边界案例：`collaborationLayer` + `behaviorLayer`。** 通用协作协议（A2A 语法、自启动、回声防护）是所有 agent 都需要的跨切面系统约束，**合法属于系统层 IN**，但应外置到 `.ath/PROTOCOLS.md`（见 §6）而非硬编码。

---

## 8. BudgetGuard 改造：P0–P4 整数 → 结构层 + importance

```ts
// 现在
interface BudgetPart { layer: string; content: string; priority: number } // 0–4

// 改后
interface BudgetPart {
  layer: string; content: string;
  tier: 'system' | 'tool' | 'project';   // 结构层（硬约束）
  importance: number;                      // 0–1（层内排序）
  scope: string; private: boolean;         // 可见性（不影响裁剪，影响谁见）
}
```
> `tier` 是**组装单元的元数据**，由 `category` 在组装时派生（identity/protocol→system、capability→tool、task/kanban/history/...→project）；`ContextRecord`（§3 数据模型）只存 category，不存 tier。

裁剪规则（取代 P0–P4 排序 + P0 硬上限 50%）：
1. `system` 层永不裁；
2. `tool` 层极度紧张才裁，按 importance 升序；
3. `project` 层先裁，按 importance 升序——轨迹(0.3)先于目标(0.8)；
4. token 估算（字符/4）与"保持原呈现顺序"逻辑保留。

`ContextBudget`（maxTokens/reserveRatio）不动，消费方从 `priority` 改读 `tier + importance`。

---

## 9. 可见性矩阵（Lead/Teammate）

> 修正早先"对 teammate 藏共享目标"的过度简化——那会加重蒸发。retro 病根是 teammates 缺共享的决策/看板/DoD。

**"每个人看到的不一样"不靠藏共享目标，而靠：①私有轨迹隔离 ②分配任务按 assignee 过滤 ③角色身份不同。共享基底全员可见——这正是治蒸发的药。**

| 维度 | 内容 | scope | private | 谁见 |
|---|---|---|---|---|
| 共享基底 | 目标/决策/看板/花名册/协议 | `/project` | F | 全员 |
| 分配焦点 | 分配给"我"的 task | `/project`（按 assignee 过滤）| F | 该 assignee |
| 交接目标段 | 收到的 handoff | `/project` | F | 接收方 |
| 私有轨迹 | "我"的对话/探查/推理 | `/project/<self>` | **T** | 仅自己 |
| 角色身份 | RoleCard 身份+职责 | 系统层 | — | 该角色 |

**recall 过滤规则**：一条记录对 agent X 可见 ⟺ `(scope 以 X 允许路径开头) 且 (private=false 或 source===X)`。
- Mario 允许 `/project` → 全量共享基底 + 自己 `/project/mario` 私有；
- Luigi 允许 `/project` + `/project/luigi` → 全量共享基底 + 自己私有，**看不到** `/project/toad`、`/project/mario` 的私有轨迹。

Mario 的"全局视野"是**角色职责驱动他用全量共享基底**做分派，不是特权层。

---

## 10. L1 / L2 / L3 衔接（scope/private 统一机制）

同一套 `scope/private` 标志，跨三层边界：

```
L1 单 agent 组装：recall 按 scope+private 过滤 → 组装进单个 prompt
L2 跨 agent handoff：抽取 private=false 记录 → HandoffSnapshot → 下游 a2aLayer 接收
L3 跨项目身份：scope 升到 /agent/<id>（身份全局只读），项目段 scope=/project 不跟随
```

**L2 HandoffSnapshot 抽取规则 = "只取 `private=false` 的相关记录"**。retro §5.2 的字段（task/acceptanceCriteria、openDecisions、selfCheckEvidence、changeScope、handoffNote）全部是共享体内容；上游私有轨迹（怎么推理、探查过哪些死路）永不进 handoff。"目标共享/轨迹隔离"一条原则，从单 agent 组装到跨 agent 交接到跨项目身份，用的是**同一个标志机制**。

---

## 11. 范围与非目标

**本设计覆盖**：上下文管理器的分层模型、边界契约、标签机制、可见性、裁剪改造、协作协议落点。

**明确不在本期**：
- 向量记忆 / 语义检索 / consolidation 合并（CrewAI Unified Memory 级）→ L3 memory spec，deferred。本期只采纳 scope/private/importance **概念**，不引入向量库。
- 角色工作过程的具体定义（Mario 怎么拆解、Peach 怎么评审）→ RoleCard / Skill。
- 质量门禁的 enforcement（DoD/评审/门禁执行）→ quality_gate 模块；上下文管理器只携带 DoD 作标签。
- 任务拆解/调度 → orchestrator。
- A2A 持球/交接语义本身 → a2a-possession-contract（不变）。

**排序约束**：本设计是设计稿，不立即改代码。OUT 泄漏迁移（roleLayer/protocolLayer 重构）**排在 TASK-006 收口之后**（retro §5.5：改进不得吞掉实现带宽）。立即可做（低风险）：BudgetGuard 加 `tier+importance` 字段、history 层补 scope/private 标签。

---

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 分层重构冲击在审的 TASK-006 | OUT 泄漏迁移延后到 TASK-006 收口后；立即可做的（BudgetGuard 字段、标签）低风险 |
| importance 默认值拍脑袋 | 明确为"可调建议值"，关键是相对序；上线后按 `ContextReport` 实测调 |
| `.ath/PROTOCOLS.md` 协议碎片化 | 基础默认模板 + 项目覆盖两层合并；retro M1 已建维护流程 |
| scope/private 漏标导致串话/泄漏 | scopeGuard 断言 + 每层单测；跨 agent/跨项目边界钉死测试 |
| category 滥用退化为散文 | category 对核心无感，但每条须带可执行语义（acceptance 带 DoD 命令，非散文）|

---

## 13. 开放问题

- **Q1**：系统层 vs 工具层的前后顺序（默认系统层在前，可按变更频率调）。
- **Q2**：`.ath/PROTOCOLS.md` 是否分文件（协作协议 / gate 定义 / 看板 schema）还是单文件分节——由协议维护方（Mario/团队）定，不影响本设计。
- **Q3**：handoff 内"目标段 vs 轨迹段"的切分粒度（`a2aLayer` 渲染时按 private 过滤）——L2 落地时定。

---

## 14. 与现有产出关系

- **`specs/context-manager/spec.md`**：实现 spec，本设计是其**分层与边界的重构依据**。落地时该 spec 的 §5.2（对内分层）、§5.5（健康度）需按本设计更新；P0–P4 优先级被 §8 取代。
- **`docs/daily/2026-07-14-collab-efficiency-retro.md`**：元病灶来源。本设计的 §3 标签机制 + §10 L2 衔接直接对应 retro 的 M8（HandoffSnapshot）与"上下文管理器"元论点。
- **`hello-agents/context-management-research.md`**：调研基线（Claude / OpenCode / MemGPT / mem0 分类），本设计在其分类框架内选定"显式管理派 + 稳定性分层"。
