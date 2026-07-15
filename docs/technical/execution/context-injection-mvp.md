# 上下文注入策略 MVP（Context Injection Policy · MVP）

> 日期：2026-07-15 ｜ 评审：2026-07-16 ｜ 状态：已评审·通过（含修订） ｜ 归属：Agent Task Hub / 团队协作 Harness
> 关联：`docs/technical/execution/context-layering.md`（三层稳定性 + scope/private 边界）、`specs/context-manager/spec.md`（组装管道 v2）、`specs/a2a-possession-contract/spec.md`（传球状态机）、`src/lib/agent-context/ContextManager.ts`（15 层管道实现）
> 参照：CrewAI 的 task.context 依赖图、OpenAI Swarm 的 handoff 函数化、LangGraph 的 state 读投影、Cognition (Devin) "Don't Build Multi-Agents"、Amazon 6-pager / Linear Issue 结构化模板
> 一句话定位：**在已有的"组装管道 + 三层稳定性"之上，补一层显式的"场景 × 角色 → 注入策略"，让 agent 在正确的时间、以正确的方式、拿到正确的信息，同时把 loop 闭环的三条平台约束定死。**

---

## 0. 定位与前置

现有 `ContextManager` 已经解决"怎么装"（15 层管道 + BudgetGuard + scopeGuard + 三层稳定性）。**它没解决"什么时候给谁装什么"**——所有场景、所有角色都过同一条 pipeline，只由预算被动挤压。

本设计补的是**策略层**：把"团队协作 harness"里隐式散落的场景差异（首次进入 vs 迭代 vs 传球 vs 唤醒 vs 收敛）固化为显式的策略矩阵；同时给"agent 能自主 loop 起来"补三条平台侧强约束。

**核心边界**：本 MVP **不改** 15 个 `buildXxxLayer` 的内部实现、**不改** `A2AHandoffPacket` schema、**不改** `BudgetGuard` 算法、**不改** provider 接口。只加一个策略解析器 + 一条 autonomy-guard 规则 + 三处轻量校验。

---

## 1. 设计原则（沿用 context-layering + 三条新增）

沿用 `context-layering.md` 的三条：单一注入网关、稳定性分层、category 无感。

**本 MVP 追加**：

1. **场景 × 角色 = 策略键**：注入策略是 `f(scenario, archetype)` 的函数，不是每层内部的隐式判断。
2. **默认隔离，显式订阅**：dialog / handoff 等易越界簇，**默认 omit**；策略表要显式打开才注入。参考 LangGraph 的 state 读投影语义。
3. **loop 闭环由平台兜底**：agent 不需要"记得收敛"、"记得校验 handoff"——这些是平台的责任。

---

## 2. 概念模型：三个正交轴

```
InjectionPolicy = f(scenario, archetype) → Directive[cluster]
                        ↑         ↑            ↑
                    什么时候   给什么角色   每一类信息给不给
```

- **Scenario**：Agent 本次被唤醒的原因，5 个（§3）
- **Archetype**：Agent 的角色原型，3 个（§4）
- **Cluster**：信息类别，6 个，是现有 15 层的分组（§5）
- **Directive**：MVP 阶段二值 `include | omit`；后续可扩为多档优先级

---

## 3. 场景枚举（5 个）

比现有 3 个 trigger（`user_turn / a2a_handoff / resume`）更细。判定由 `scenarioResolver` 从 `ContextRequest` 推导。现有字段无法表达系统唤醒原因，因此新增一个窄的可选字段：

```ts
wakeup?: {
  reasonCode: string;
  reasonSummary?: string;
  rootTaskId?: string;
  subtreeSize?: number;
  partial?: boolean;
}
```

`HarnessTrigger`、`HarnessDispatchPlan` 与 terminal start payload 只透传这组场景元数据，不引入第二套上下文模型。

| Scenario | 判定条件 | 语义 |
|---|---|---|
| `init` | `isFirstWake === true` | Agent 首次进入本会话，需要建立完整世界模型 |
| `iterate` | `trigger==='user_turn'` 且非首次 | 已在会话内，用户继续说话 |
| `handoff` | `trigger==='a2a_handoff'` | 收到 A2A 传球 |
| `wakeup` | `trigger==='resume'` 且携带 wakeup metadata（`reasonCode` 非 `chain_ready_for_closure`） | 系统心跳唤醒（任务就绪 / 评审就位 / 静默兜底） |
| `closure` | `trigger==='resume'` 且 `reasonCode==='chain_ready_for_closure'` | 根任务子树全终态，需要收敛输出 |

**固定判定优先级**：`a2a_handoff → handoff`；`resume + chain_ready_for_closure → closure`；其他 `resume → wakeup`；然后才判断 `isFirstWake → init`；其余为 `iterate`。因此首次 handoff 和首次系统唤醒不会被误判为 init。

**未覆盖场景**（延后）：`review_reject / blocked_escalation / user_pivot / cross_chain`——MVP 先不区分，落入 `iterate` 或 `wakeup`，观察数据再拆。

---

## 4. 角色原型（3 类）

比完整的 5-role 精简，避免 MVP 阶段陷入角色差异细节。由 `RoleCard.category` 映射：

| Archetype | 映射来源 | 典型角色 |
|---|---|---|
| `planner` | `roleCard.category === 'planner'` | Mario |
| `reviewer` | `roleCard.category` ∈ `{'code_reviewer','arch_reviewer'}` | Peach |
| `worker` | 其余所有（含 implementer、assistant、未分类） | Luigi、DK、Toad |

**后续拆分信号**：如果 `worker` 内部 implementer 与 arch_advisor 在 iterate 场景的 token 消耗差异过大，或 reviewer 场景下 `code_reviewer` 与 `arch_reviewer` 需要的证据集有显著差异，拆回到完整 5 档。

---

## 5. 信息簇（6 个，映射现有 15 层）

不新建 provider、不改层实现，只在策略表引用时用簇名。

| Cluster | 包含现有层 | 稳定性归属（沿用 context-layering） |
|---|---|---|
| `identity` | `roleLayer` | 系统层，仅首次唤醒 |
| `protocol` | `protocolLayer` + `collaborationLayer` + `behaviorLayer` | 系统层，永不裁 |
| `capability` | `skillLayer` + `toolLayer` | 工具层 |
| `situation` | `teamLayer` + `projectLayer` + `teamPackLayer` + `projectStatusLayer` | 项目层 |
| `focus` | `taskContextLayer` + `a2aLayer` | 项目层，重要度最高 |
| `dialog` | `historyLayer` + `userMessageLayer` | 项目层，重要度最低 |

---

## 6. 策略矩阵（宽松初稿·二值）

`✅ include` / `∅ omit` / `-` 不适用。含"轻量"标注的仍走 `include`，由 BudgetGuard 按 importance 裁剪，不新增裁剪逻辑。

|  | identity | protocol | capability | situation | focus | dialog |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **init × planner** | ✅ | ✅ | ∅ | ✅ 全景 | ✅ 有任务时注入 | ✅ 用户原始请求 |
| **init × reviewer** | ✅ | ✅ | ✅ | ✅ 全景 | ✅ 有任务时注入 | ✅ 用户原始请求 |
| **init × worker** | ✅ | ✅ | ✅ | ✅ 全景 | ✅ 有任务时注入 | ✅ 用户原始请求 |
| **iterate × planner** | ∅ | ✅ | ∅ | ✅ 轻量 | ✅ 任务图 | ✅ 常规 |
| **iterate × reviewer** | ∅ | ✅ | ✅ | ✅ 轻量 | ✅ 当前任务 | ✅ 常规 |
| **iterate × worker** | ∅ | ✅ | ✅ | ✅ 轻量 | ✅ 当前任务 | ✅ 常规 |
| **handoff × any** | ∅ | ✅ + 回声防护段 | ✅ | ✅ 轻量 | ✅ packet 满血 | ∅ |
| **wakeup × any** | ∅ | ✅ + wakeup 提示段 | ✅ | ∅ | ✅ 任务卡满血 | ∅ |
| **closure × planner** | ∅ | ✅ + closure 提示段 | ∅ | ✅ 全景 | ✅ 整棵任务子树 | ✅ 仅用户原始请求 |
| **closure × reviewer/worker** | ∅ | ✅ + closure 提示段 | ∅ | ✅ 全景 | ✅ 整棵任务子树 | ✅ 仅用户原始请求 |

**关键差异化**（其余全部复用现有内容）：

1. **`init` vs `iterate`**：init 给完整世界模型 + identity 首次注入；若调用方同时提供任务则保留任务卡，未提供时 focus 自然为空。iterate 假设 agent 已在会话内，不重讲角色和团队。
2. **`handoff`**：dialog **默认关闭**（防动作漂移 / 回声回流 / 过程污染），focus 走 `a2aLayer` 满血；protocol 追加回声防护段。
3. **`wakeup` / `closure`**：protocol 追加对应提示段（§8），让 LLM 一眼识别本轮不是普通对话。
4. **策略是全函数**：所有 `scenario × archetype × cluster` 都有确定值；closure 正常只派给 planner，reviewer/worker 行是防御性回退，避免未知或错误路由时退回通用注入。

---

## 7. 平台三约束（Loop 闭环）

**MVP 阶段全部只记日志、不阻断**（用户 2026-07-15 决策）。观察一段时间后再决定是否升级为硬拦截。

### 约束 A：每个 scenario 有合法出口

每个场景在协议段（§8）里明确本轮结束时 agent 应该产出以下之一。落不到出口 → 记 `no_valid_exit` 事件（含 `scenario` / `agentId` / `raw_outcome` 摘要）。

| Scenario | 合法出口 |
|---|---|
| `init` / `iterate` | ① 更新 TASKS.md 任务行；② 发起 A2A 交接；③ 完成本轮并静默 |
| `handoff` | ① 接受并推进（更新任务状态）；② 拒绝并说明原因；③ 转传给更合适角色 |
| `wakeup` | ① 推进对应任务；② 更新状态说明为什么未推进 |
| `closure` | ① 输出 closure report；② 声明 partial 并列出未完成子树 |

**检测点**：现有 `outcome-reducer` 只处理运行时接单结果，拿不到完整 agent 输出。应在 daemon 收到 terminal done、完成输出聚合后调用纯函数 `checkValidExit(scenario, outcome)`；scenario 随 dispatch plan/terminal payload 传递。无匹配就写 proof event。**不重发 wakeup、不 block 后续 dispatch**。

### 约束 B：闭环必被触发

在 `autonomy-guard.ts` 的四条规则外新增：

```
if 根任务的所有子任务都进入终态（done / abandoned / cancelled）
   且 根任务本身未终态：
     wakeup(rootTask.plannerId ?? conversationPlannerId,
            reasonCode='chain_ready_for_closure')
```

**触发时机**：沿用 autonomy-guard 现有的定时扫描（用户 2026-07-15 决策，避免改动 task-flow）。延迟最多一个 tick，可接受。扫描输入增加 task graph edges，但不修改图 schema。

**根与子树定义**：`subtask_of` 方向为 child → parent。根任务是“作为 parent 出现、但自身不作为 child 出现”的任务；从根沿 `edge.to_task_id === parentId` 递归收集 `edge.from_task_id`。仅当根任务未终态、至少有一个后代、且全部后代处于 `done / abandoned / cancelled` 时触发。目标 agent 优先取 root owner（若属于 coordinator 集合），否则取首个 coordinator，最后回退到 root owner。

**持久幂等键**：`${conversationId}:${rootTaskId}:chain_ready_for_closure`。触发记录写入 `control_proof_event`；后续 tick 通过 proof repository 查询该 key 后跳过。现有内存 TTL 去重只能抑制短时重复，不能承担“一次且仅一次”语义。

### 约束 C：Handoff 有可执行 action

现有 `DispatchRequest.content` 即 requestedAction 来源。`orchestrator.requestDispatch` 在创建 pass 前做保守的空白/通用占位检测，创建 pass 后记 `missing_action` audit 事件（此时才能携带 `passId / fromAgentId / toAgentId / chainId`）。

**MVP 阶段不阻断**，pass 仍然进 `offered`。观察数据决定后续是否改为直接 `blocked`。

---

## 8. 协议段模板（5 个 scenario 的追加提示段）

`protocolLayer` 现有内容不动，按 scenario 追加一段。所有模板都要短、动词开头、给出合法出口。

### `init` / `iterate`
不追加特殊段。现有 `collaborationLayer` 的三选一决策树（更新 TASKS.md / 知会 / A2A）已覆盖。

### `handoff` 提示段
```
本轮触发方式：你收到了一次 A2A 交接。
你必须做以下之一：
  ① 接受任务并更新 TASKS.md 状态为 doing/in_progress；
  ② 判断不合适你，拒绝并在回复中说明理由与建议接手方；
  ③ 更合适由他人处理时，用 A2A 转传（需给出新的 requestedAction）。
不要仅回复"收到"、"好的"、"我看看"；不要因为礼貌而反 @ 上游。
```

### `wakeup` 提示段
```
本轮触发方式：系统 Wakeup（reason=${reasonCode}），不是新的对话或交接。
你被叫醒是因为：${reasonSummary}。
你必须做以下之一：
  ① 直接推进对应任务（更新状态 / 产出 deliverable）；
  ② 在群聊中说明为什么现在还没推进，并更新 TASKS.md 阻塞原因。
不要总结"我曾经做过什么"；不要反 @ 系统。
```

### `closure` 提示段
```
本轮触发方式：根任务 ${rootTaskId} 的所有子任务已进入终态，需要你收敛闭环。
你必须产出一份 Closure Report，结构如下：
  - GOAL：用户原始请求（一句话）
  - DELIVERED：已交付项（task id + deliverable 路径）
  - DECISIONS：过程中拍板的关键决策
  - NOT DONE：未做的事及原因（若为 partial closure）
  - NEXT：用户可能需要的下一步动作
Closure Report 是本轮唯一预期产出。不要再发起新 A2A，不要重新拆任务。
若确有必须的遗漏工作，用 NOT DONE 段说明，由用户决定下一轮。
```

---

## 9. 代码改动清单（最小）

### 新增 4 个文件

```
src/lib/agent-context/scenarioResolver.ts
  fn resolveScenario(req: ContextRequest): Scenario
  纯函数，从 isFirstWake + trigger + wakeup metadata 判定

src/lib/agent-context/injectionPolicy.ts
  const POLICY: Record<Scenario, Record<Archetype, Record<Cluster, Directive>>>
  fn getDirective(scenario, archetype, cluster): Directive
  fn resolveArchetype(roleCard?: RoleCard): Archetype

src/lib/agent-context/protocolHints.ts
  fn buildProtocolHint(scenario: Scenario, ctx: HintContext): string
  5 个 scenario 的追加文案（handoff / wakeup / closure 各一段，init/iterate 返回空）

src/server/harness/valid-exit.ts
  fn checkValidExit(scenario: Scenario, outcome: string): ValidExitResult
  纯函数、保守匹配，只提供观测信号
```

### 修改范围

- **`ContextManager.assembleContext`**（`src/lib/agent-context/ContextManager.ts`）：
  - 组装前调 `resolveScenario` + `resolveArchetype`
  - 每次 `push(cluster, ...)` 前查 `getDirective`；`omit` 则跳过
  - `protocol` 簇的 content 追加 `buildProtocolHint` 的返回值

- **`autonomy-guard.ts`**（`src/server/task-flow/autonomy-guard.ts`）：
  - 新增 reasonCode `chain_ready_for_closure`
  - 新增规则：根任务子树全终态检测
  - 读取 task graph edges，按 child → parent 递归判断完整子树

- **`orchestrator.ts`**（`src/server/a2a/orchestrator.ts`）：
  - `requestDispatch` 入口校验 `requestedAction`
  - 不阻断，只经 audit logger 记 `missing_action` 事件

- **Harness / daemon 透传与观测**：
  - `TaskWakeup → HarnessTrigger → ContextRequest` 透传 `reasonCode` 与 closure 元数据
  - dispatch plan / terminal payload 透传已解析 scenario
  - daemon 在完整输出聚合后执行 valid-exit 观测
  - proof repository 提供持久幂等查询；daemon 在 closure dispatch 时写 proof event

### 不改

- 15 个 `buildXxxLayer` 内部实现
- `A2AHandoffPacket` schema
- `BudgetGuard` / `ContextBudget` 算法
- `ContextProviders` 接口
- Task graph schema（只读取既有 edges）

---

## 10. 事件 Schema（新增观测点）

事件按领域归属复用现有通道，而不是新建一个混合事件表：`no_valid_exit` 与 `chain_closure_dispatched` 写 `control_proof_event`；`missing_action` 写既有 `a2a_audit_log`。MVP 阶段只将 closure proof 用于幂等查询，其余只写不阻断。

```ts
type ContextInjectionEvent =
  | {
      type: 'no_valid_exit';
      scenario: Scenario;
      agentId: string;
      conversationId: string;
      taskId?: string;
      outcomeSummary: string;   // 前 200 字符
      at: string;
    }
  | {
      type: 'missing_action';
      passId: string;
      chainId: string;
      fromAgentId: string;
      toAgentId: string;
      rawAction: string;         // 原始（可能为空 / 占位）
      at: string;
    }
  | {
      type: 'chain_closure_dispatched';
      rootTaskId: string;
      conversationId: string;
      plannerId: string;
      subtreeSize: number;       // 覆盖的子任务数
      partial: boolean;          // 是否含 abandoned / cancelled
      at: string;
    };
```

---

## 11. 迭代信号（观察多久决定下一步）

MVP 上线后基于以下信号决定下一轮设计：

| 观测信号 | 触发下一步 |
|---|---|
| `no_valid_exit` 频发（某场景 > 20% 轮次） | 该场景协议段模板改硬 / outcome-reducer 强制路由 |
| `missing_action` 频发（> 10% pass） | 约束 C 升级为硬拦截，pass 直接进 `blocked` |
| `chain_closure_dispatched` 中 planner 输出质量差 | 补 `deliverables` / `decisions` 聚合 cluster（新 provider 方法） |
| `handoff` 场景下下游频繁通过工具 recall 上游历史 | 补 `A2AHandoffPacket.successCriteria / attemptTrace / rejectedAlternatives` |
| `iterate` 场景 tokens 用量常态偏高 | 引入 P0–P4 五档优先级 + BudgetGuard 按 priority 排序 |
| worker archetype 内部差异明显 | 拆出 implementer / arch_advisor 独立分档 |

---

## 12. 本期不做（YAGNI）

- `A2AHandoffPacket` 新字段（`successCriteria` / `attemptTrace` / `rejectedAlternatives`）——等 handoff 场景 recall 信号出来再决定
- `deliverables` / `decisions` 聚合 cluster——等 closure 输出质量数据决定
- 五档优先级（P0–P4）——等 iterate token 数据决定
- `review_reject / blocked_escalation / user_pivot / cross_chain` 独立 scenario——等 iterate 场景内的行为分布决定
- `recall_upstream(messageIds)` 内建工具——等 handoff 后下游"信息不足"信号决定
- 硬阻断（约束 A / C）——等误报率数据决定

---

## 13. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 策略表默认过宽，token 消耗回落不明显 | MVP 观察一周迭代信号；`iterate × worker` 场景是重点观察对象 |
| `dialog` 默认关闭导致 handoff / wakeup 场景下下游信息不足 | 观察 `recall` 频率（若引入内建工具）或 `no_valid_exit` 事件；必要时按角色恢复 dialog |
| `chain_ready_for_closure` 在 partial 状态误触发 | wakeup content 中显式携带 `partial=true`，闭环模板明确允许 partial closure |
| `resolveArchetype` 对未知 `category` 默认落入 `worker` 导致覆盖错误 | 首次遇到未知 category 时记事件；后续扩档时以此为线索 |
| 协议段追加导致 `protocol` 层超出稳定性预算 | 协议段模板全部限制在 ~200 tokens；BudgetGuard 的稳定性排序保证系统层最后裁 |

---

## 14. 验收指向

核心五条：

1. 五个 scenario 都能被 `resolveScenario` 正确识别，边界样例（首次 handoff / wakeup 后紧接 user_turn / 空 wakeup reasonCode）不错分；
2. 六簇的 `include/omit` 与策略表一致；三个角色原型下同一 scenario 的 prompt 差异可观察且可回归；
3. `chain_ready_for_closure` 在根任务全子树终态时被触发一次且仅一次（幂等）；planner 能收到含 `subtreeSize / partial` 元数据的 wakeup；
4. 三类事件（`no_valid_exit / missing_action / chain_closure_dispatched`）在对应触发点被记录，字段完整；
5. 现有主循环仍经唯一 ContextManager 组装且原有关键协议/能力/任务/用户输入不丢失；策略导致的预期裁剪不作为回归，现有构建与测试不得退化。

---

## 15. 关联决策记录

- **2026-07-15**：策略配置形态采用"代码常量 + 每 archetype 一个函数"
- **2026-07-15**：Handoff 上游历史默认不注入（走 packet + 未来的 recall 工具兜底）
- **2026-07-15**：MVP 阶段三约束全部只记日志、不阻断
- **2026-07-15**：`chain_ready_for_closure` 走 autonomy-guard 定时扫描，不改动 task-flow
- **2026-07-15**：先设计（本文档），暂不立 spec、不动代码；spec 立项与否等本文档评审通过后决定
