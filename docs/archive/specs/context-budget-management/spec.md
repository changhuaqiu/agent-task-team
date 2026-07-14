# 上下文预算管理（Context Budget Management）

> 归档状态：superseded（2026-07-14）｜替代规格：`specs/context-manager/`；基础预算组件已实现

> 状态：草案（draft）｜ 关联：`src/lib/agent-context/`、`src/server/a2a/context-builder.ts`
> 理论参照：Datawhale《Hello-Agents》第 9 章 ContextBuilder（GSSC + 预算守护 + 分区骨架）

## 1. 目标

给 `PromptComposer` 引入 **token 预算守护 + 分层裁剪**，并把 `historyLayer` 从「滑动窗口 + 字符截断」升级为 **GSSC（Gather → Select → Compress）**，解决多 Agent 协作中的上下文 token 膨胀，补齐作者在 `PromptComposer.ts:145` 自标的 `future: add compression` 缺口。

## 2. 背景与现状

### 2.1 当前上下文架构（强项）
- `src/lib/agent-context/`：15 个 layer + `PromptComposer` 组合（比第 9 章六分区更细粒度）
- `src/server/a2a/context-builder.ts`：cursor-based 增量消息、链深度预算（8 轮上限）、编辑互斥

### 2.2 缺口（本次重构机会）
| 缺口 | 现状代码 | 本次对策 |
|---|---|---|
| 历史层最朴素 | `historyLayer.ts`：`MAX_MESSAGES=10` + `MAX_CONTENT_LENGTH=200` 字符截断（head 40%+tail） | GSSC：Gather 候选 → Select 评分 → Compress |
| 无压缩 | `PromptComposer.ts:145` `// future: add compression`（作者自标） | Compress 阶段 + budgetReport |
| 无 token 预算 | 只有 chain depth 8 + 字符 200 | `ContextBudget` token-level 预算守护 |
| 无相关性/新近性 | 纯时间排序（最近 N 条） | Select：相关性（关键词）+ 新近性（指数衰减） |

## 3. 范围

### 3.1 包含
- `ContextBudget`：预算配置（总量 / 各层配额 / 生成余量）
- `BudgetGuard`：按层优先级 + token 预算组装，超预算时裁剪/压缩，输出 `budgetReport`
- `GSSCHistoryLayer`：重写 `historyLayer`（接口签名不变，内部 GSSC）
- `PromptComposer.composeUserPrompt` 集成预算流水线
- `budgetReport` 可观测性（日志 + UI 可选）

### 3.2 不包含（YAGNI，留后续 spec）
- 跨会话 archival 持久记忆层（分层记忆架构，另立 spec）
- embedding 语义相关性（本次只预留接口，不实现）
- LLM 摘要压缩的运行时落地（本次只留配置开关，默认 head+tail 截断）

## 4. 约束

- **技术栈**：TypeScript / Next.js，不破坏现有 15 层 `buildXxxLayer` 接口签名
- **CLI 进程模型**：每次派发是新进程，prompt 必须自包含、全量发送，不能依赖进程内缓存
- **预算单位 = token**：用 `gpt-tokenizer`（纯 JS、零原生依赖）
- **零新增重型依赖**：关键词重叠起步，不接向量库
- **可配置**：预算阈值从角色卡 / 项目配置读，默认上下文层 8K token
- 遵循 `docs/standards/technical.md`（实现期对齐）

## 5. 设计

### 5.1 架构（改动点）
```
composeUserPrompt(opts):
  budget  = ContextBudget.fromOpts(opts)          // 新增
  parts   = []
  for layer in LAYER_ORDER:                       // 按优先级有序
    content = build[layer](opts)
    parts.push({ layer, content, tokens: countTokens(content), priority: P[layer] })
  return BudgetGuard.compose(parts, budget)       // 新增：组装 + 裁剪 + report
```

### 5.2 新增组件
1. **`ContextBudget`**（`src/lib/agent-context/ContextBudget.ts`）
   - 字段：`maxTokens`（默认 8000）、`reserveRatio`（默认 0.15）、`layerQuota`（各层配额覆盖）
   - `fromOpts(opts)`：从角色卡 / 项目配置 / 默认值推导
   - `availableTokens()`：`maxTokens * (1 - reserveRatio)`

2. **`BudgetGuard`**（`src/lib/agent-context/BudgetGuard.ts`）
   - `compose(parts, budget)`：
     - P0 层无条件纳入（role / protocol / task / behavior）
     - P1–P4 按优先级与配额填充
     - 超预算时从最低优先级（P4 history）开始压缩/丢弃，逐级向上
   - 返回 `{ prompt: string, report: BudgetReport }`

3. **`GSSCHistoryLayer`**（重写 `src/lib/agent-context/layers/historyLayer.ts`）
   - 接口不变：`buildHistoryLayer(messages, selfId, budget?)`
   - 内部流水线：
     - **Gather**：取候选 `messages.slice(-CANDIDATE_POOL)`（`CANDIDATE_POOL` 默认 30，>现状 10）
     - **Select**：对每条算 `score = 0.7*relevance + 0.3*recency`
       - `relevance`：关键词重叠（query tokens ∩ content tokens）/ query 长度
       - `recency`：`exp(-Δt / τ)`，`τ` 默认 3600s（暴露到配置）
     - **Compress**：按 `budget` 配额取 top-K；单条超长用 head+tail 截断（保结构）；`enableLLMSummary` 开关位预留

### 5.3 层优先级（裁剪顺序，先丢 ↓）
| 优先级 | 层 | 理由 |
|---|---|---|
| **P0 几乎不丢** | role, protocol, task, behavior | 身份 / 约束 / 任务 / 闭环动作 |
| P1 | collaboration, teamPack, a2a | 协作上下文 |
| P2 | team | 团队成员名单 |
| P3 先被压 | skill, tool | 能力（可 JIT 按需） |
| **P4 最先压** | history | 历史（GSSC 吸收） |

### 5.4 4 个关键决策（已采用）
1. **预算单位 = token**（`gpt-tokenizer`），废弃字符计数
2. **Compress 默认 head+tail 截断**（零延迟）；LLM 摘要作 `enableLLMSummary` 可选开关（默认关，因 CLI 每次新进程，调 LLM 摘要会显著拖慢 + 加成本）
3. **Select 相关性 = 关键词重叠起步**（零依赖、兼容现状）；预留 `RelevanceProvider` 接口，后续可接 embedding（第 8 章向量）
4. **预算来源 = 可配置**（角色卡 / 项目配置 / 默认 8K token）

### 5.5 数据流与可观测性
```
opts → 各层 build → countTokens + 优先级 → BudgetGuard 组装
     → { prompt: string, report: BudgetReport }
```
**对外兼容**：`composeUserPrompt` 仍返回 `string`（取 `.prompt`，向后兼容现有调用方）；新增导出 `composeUserPromptWithReport()` 返回完整 `{ prompt, report }` 供 UI / 日志消费。

`BudgetReport`：每层 `{ tokens, quota, trimmed: bool, compressionRatio }`，写日志；UI 侧后续可在派发面板展示（本次只出日志 + 类型，UI 另议）。

## 6. 影响面

- **改**：`src/lib/agent-context/PromptComposer.ts`（composeUserPrompt 接 BudgetGuard）、`src/lib/agent-context/layers/historyLayer.ts`（GSSC 重写）
- **新增**：`src/lib/agent-context/ContextBudget.ts`、`BudgetGuard.ts`、`budgetReport.ts`、`relevance.ts`（关键词 + 接口）
- **依赖**：新增 `gpt-tokenizer`（package.json）
- **测试**：上述各文件配套 `.test.ts`；`PromptComposer` 既有测试不破
- **文档**：`docs/wiki/01-architecture.md` 上下文层章节同步更新（AGENTS.md 要求实现必先改设计文档）

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| tokenizer 引入依赖 | `gpt-tokenizer` 纯 JS、无原生编译，可接受 |
| 截断丢关键历史 | head+tail 保结构 + budgetReport 可观测 + CANDIDATE_POOL 扩到 30 |
| 预算阈值需调 | 默认 8K + 可配 + report 驱动调参 |
| 关键词相关性中文弱 | 预留 embedding 接口；中文分词后续可接 jieba/分词 layer |

## 8. 验收指向

详见 `checklist.md`。核心三条：
1. 超预算时 P0 层不丢、P4 先被压
2. historyLayer 在候选 > 配额时正确 Select + Compress，输出稳定
3. budgetReport 真实反映每层 token 与裁剪情况
