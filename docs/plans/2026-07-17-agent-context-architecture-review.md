---
状态：评估稿 · 待评审
doc_kind: plan
created: 2026-07-17
范围：src/lib/agent-context/
---

# 架构评估报告 — agent-context 模块

> ⚠️ **本文是架构评估稿，不是落地事实。** 描述的是"当前代码摩擦点 + 加深候选方案"，不描述系统当前行为。落地事实以 `specs/context-manager/` 和 `docs/technical/execution/context-layering.md` 为准。若任一候选被采纳并实施，再将结论回写到 spec/technical 后归档本文。

> **扫描范围**：`src/lib/agent-context/`
> **方法论**：improve-codebase-architecture + codebase-design 词汇表（module/interface/depth/seam/adapter/leverage/locality）
> **热点确认**：ContextManager.ts 近 7 周改动 9 次，是该模块绝对热点

---

## 核心词汇（报告全程用这套术语）

- **Module**：有 interface 和 implementation 的东西
- **Depth**：小 interface 藏住大 implementation = 深模块；反之浅模块
- **Seam**：不改代码就能换行为的位置
- **删除测试**：想象删掉这个模块，复杂度是消失了（pass-through）还是在 N 个调用方重新出现（它有价值）

---

## 6 个摩擦点

### ① assembleContext 是浅模块 【Strong】

**位置**：`ContextManager.ts:167-420`（整个类就一个方法，~254 行）

**interface 复杂度 ≈ implementation 复杂度**：
- interface 要求：10 个 provider 方法 + MemoryHook + 12 字段的 ContextRequest
- body 是一份"layer 清单"的 1:1 转录：13 个 `push()` 调用，每个要同时记住 cluster 名、layer 名、tier、importance、scope、private 等 ~11 个概念
- 存在**第二条平行组装路径**（systemPrompt，332-380 行）绕过 push 闭包，独立调 4 次 getDirective

**删除测试结果**：只有 2 个生产调用方（context-planner.ts、PromptComposer.ts）。内联会把 ~250 行搬到 2 处——**复杂度被重新分配，未被消除**。它唯一集中化的价值（统一的 layer 排序）被平行 systemPrompt 路径削弱了。

**Before（扁平组装器）**：
```
assembleContext()
├─ 10× provider.getX()       ← 取原料
├─ resolveScenario/Archetype ← 算策略
├─ push() × 13 次            ← 一个个塞，每个 11 个概念
├─ composeWithBudget()       ← 裁剪
└─ 【平行路径】systemPrompt
    再调 getDirective × 4    ← 第二套规则，不进 parts[]
```

**After（加深的分层引擎）**：
```
assembleContext()
├─ resolveScenario()
└─ layers.render(scenario)   ← 小接口：只传 scenario
    内部按 4 层语义分组
    ├─ systemTier.render()
    ├─ knowledgeTier.render()
    ├─ taskTier.render()
    └─ interactionTier.render()
        每层自己管 push + 裁剪
```

**收益**：locality（改一个 layer 只改所属 tier 文件）、leverage（新增 layer 不碰组装器）、testability（每 tier 独立测）

---

### ② 15 个 layer 扁平无语义分组，签名不一致 【Strong】

**位置**：`src/lib/agent-context/layers/*.ts`

**签名不一致**（都返回 string，但参数五花八门）：
- `buildRoleLayer(agent, roleCard)` — 位置参数
- `buildTaskContextLayer(task, projectId?)` — 位置参数 + 临时 scope throw
- `buildHistoryLayer(messages, selfId, opts?)` — 位置参数 + opts
- `buildA2ALayer(opts)` — 单 opts 对象
- `buildCollaborationLayer()` / `buildBehaviorLayer()` — **零参数纯常量字符串**（根本不是"layer"）

**3 种不同的 scope 处理方式并存**：
- taskContextLayer.ts:12 — 自己 reimplement 硬 throw
- historyLayer.ts:48 — 用已废弃的 filterByProjectId
- teamPackLayer.ts:2 — 死 import 了 scopeGuard 却没用（含 TODO 说没实现）

**新增一个 layer 要改 4 个地方**（其中 2 个失败静默）：
1. layers/ 新建文件
2. ContextManager import + push
3. PromptComposer 平行 import（纯为 re-export，无运行时原因）
4. contextArtifact.ts 的 CURRENT_LAYER_DESCRIPTORS（漏了静默落到 DEFAULT_DESCRIPTOR）

---

### ③ PromptComposer 重复组装 + 循环依赖 【Strong】

**位置**：`src/lib/agent-context/PromptComposer.ts`

**首次唤醒组装两次**：daemonStore.ts:331-332 连续调 composeSystemPrompt 和 composeUserPrompt，各自 `new ContextManager()` 然后 assembleContext——provider 接线代码重复 9 行，**整个上下文（provider 取数 + 15 layer build + budget + report）跑两遍**，一份 report 丢弃。

**循环依赖**：
```
ContextManager.ts:23  → 从 PromptComposer import extractToolsFromSkills + 类型
PromptComposer.ts:23  → 从 ContextManager import ContextManager
```
一个文件同时是"薄包装"和"ContextManager 依赖的工具模块"——两个不相关职责塞一起。

**删除测试**：删掉 PromptComposer，daemonStore 直接构造 ContextManager 一次（context-planner.ts 已经这么做了）→ 双组装和循环依赖都消失，**零损失**。

---

### ④ 3 个协调器职责模糊，决策路径分裂 【Worth exploring】

**位置**：scenarioResolver.ts · injectionPolicy.ts · BudgetGuard.ts

每个协调器单独看都干净。问题在 ContextManager 怎么接它们：单个 layer 的命运要跨**两个不同代码区域**决策。

**同一个函数在一个方法里出现 6 次**：
- push 闭包内调 getDirective 13 次（决定进不进 parts[]）
- systemPrompt 平行路径又单独调 getDirective 4 次（不进 parts[]，不经过 BudgetGuard）

**archetype 在 3/5 场景是死权重**：INJECTION_POLICY 表假装 scenario × archetype 正交，但 handoff/wakeup/closure 三列 archetype 完全相同——archetype 只在 init/iterate 场景区分 planner vs contributor。

---

### ⑤ scopeGuard 标注了但从未接线 【Worth exploring】

**位置**：`src/lib/agent-context/scopeGuard.ts`

**新 API 只在测试里用**：`scopeGuard()` 和 `assertVisibility()` 的生产引用数为 0，只在 scopeGuard.test.ts 里调用。生产代码只 import 了已废弃的 `filterByProjectId`。

**可见性不是真正的 stage**：push 闭包给每个 artifact 盖了 scope/private/audience/sourceOwner 等 7 个字段，但 ContextManager.ts:284/308 只有两行注释 `// P2 接入`——**元数据存了，策略没跑**。BudgetGuard 是真 stage（318 行），可见性不是。

**额外重复**：MemoryHook interface 定义了两份——ContextManager.ts:50（无 timestamp/relevanceScore）和 MemoryHook.ts:10（有），同一契约两个事实源。

---

### ⑥ 测试是黑盒输入 + 白盒断言 【Speculative】

**位置**：`ContextManager.test.ts`

**断言依赖内部词汇表**：输入是黑盒（ContextRequest），但要断言"正确的层被注入"得 reach 进 `result.report.artifacts[].outcome.reasonCode`（'delivery_included' | 'policy_cluster_omitted' | 'budget_trimmed'）和 includedClusters——测试者必须知道模块内部的 reasonCode 分类法和 cluster 名。

**对比证明深度在哪**：15 个 buildXxxLayer 的单测是干净的纯函数测试（string→string，零 mock）——**深度实际在 layer 函数里**，assembleContext 是压在上面的浅组装器，也是最难点测的部分（10 个 provider mock + 9 字段 handoff packet）。

**覆盖缺口**：无 PromptComposer.test.ts——双组装、isFirstWake 拼接分支完全无测试。

---

## Top Recommendation（按 ROI 排序，不是按严重度）

### 第一步：删 PromptComposer（摩擦点 ③）

**风险最低、收益立竿见影**。删除测试确认零损失：daemonStore 改成像 context-planner 那样直接构造 ContextManager 一次，extractToolsFromSkills 和类型挪到中立 util。首次唤醒组装开销立即减半，循环依赖消除。**不改变任何 layer 行为，纯结构调整。**

### 第二步：四层分组（摩擦点 ①+②）

把 15 个 layer 按你的心智模型分成 4 个 tier 深模块（系统/知识/任务/交互），每个 tier 是深模块——内部管自己的 push+裁剪+scope，对外只暴露 `render(scenario): BudgetPart[]`。assembleContext 从 254 行的扁平 push 清单收敛为 ~20 行编排。同时解决"新增 layer 改 4 处"的痛点。

### 第三步：接线 scopeGuard（摩擦点 ⑤）

前两步落地后，可见性字段已统一由 tier 模块管理，这时把 assertVisibility 作为真正的 stage 接进流水线（BudgetGuard 之后），消除 3 种 scope 习惯并存。**单独做没意义，依赖前两步。**

---

## 你的四层心智模型 ↔ 当前 15 个 layer 的映射

| 理想层 | 稳定性 | 当前归属的 layer | 现状问题 |
|--------|--------|-----------------|---------|
| **系统层** | 永不裁 | role, collaboration, protocol, behavior | projectLayer/projectStatus **错误地混在这里**（高频变化） |
| **知识层** | 极少裁 | skill, tool, team, teamLog, teamPack, history | 能力(tool tier)和局势(project tier)被拆散；history 被当 dialog 不是 memory |
| **任务层** | 可裁但高优 | task, a2a | projectStatus **本应在这里** |
| **交互层** | 最易失效 | userMessage | teamLog 增量投影**本应在这里** |

**3 处需要修正的归属错误**：
1. **projectStatus**：系统层 → 任务层（看板状态是任务上下文，不是身份）
2. **history**：dialog → 知识层的 memory（对话历史是"记忆"，不是"交互"）
3. **teamLog 投影**：知识层 → 交互层（每次轮次不同的增量，不是稳定知识）

---

## 摩擦点总览

| # | 摩擦点 | 强度 | 根因 | 删除测试 |
|---|--------|------|------|---------|
| ① | assembleContext 浅模块 | Strong | 13 个 push + 第二条 systemPrompt 路径 | 复杂度重分配到 2 调用方，未消除 |
| ② | 15 个 layer 扁平无分组 | Strong | 签名不一致、2 个零参数常量、3 种 scope 习惯 | — |
| ③ | PromptComposer 重复组装 | Strong | 首次唤醒组装两次、循环 import | 删除即消除双组装 + 循环，零损失 |
| ④ | 3 个协调器路径分裂 | Worth exploring | getDirective 出现 6 次、archetype 3/5 死权重 | — |
| ⑤ | scopeGuard 没接线 | Worth exploring | 7 个可见性字段存了没跑、3 种 scope 并存 | — |
| ⑥ | 测试黑盒输入白盒断言 | Speculative | 10 provider mock + 内部 reasonCode 词汇 | — |

---

*扫描方法论：[improve-codebase-architecture](https://skills.sh/mattpocock/skills/improve-codebase-architecture) + [codebase-design](https://skills.sh/mattpocock/skills/codebase-design)*
*词汇：module · interface · depth · seam · adapter · leverage · locality*
