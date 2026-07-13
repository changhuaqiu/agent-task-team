# 实施任务拆解 — 上下文预算管理

> 按依赖顺序排列；每项完成须同步更新对应 `.test.ts` 与 `docs/wiki/01-architecture.md`。

## 阶段 1：基础设施

- [ ] T1 引入 `gpt-tokenizer` 依赖，封装 `countTokens(text): number` 工具（`src/lib/agent-context/tokenCounter.ts`）+ 单测
- [ ] T2 实现 `ContextBudget`（`maxTokens` / `reserveRatio` / `layerQuota` / `fromOpts` / `availableTokens`）+ 单测
- [ ] T3 定义层优先级常量 `LAYER_ORDER` 与 `P[layer]`（P0–P4 映射）+ `BudgetReport` 类型

## 阶段 2：历史层 GSSC 重写

- [ ] T4 实现 `relevance.ts`：`keywordRelevance(query, content)` + `recencyScore(timestamp, τ)` + `RelevanceProvider` 接口（预留 embedding）+ 单测
- [ ] T5 重写 `historyLayer.buildHistoryLayer`：
  - [ ] T5.1 Gather：`messages.slice(-CANDIDATE_POOL)`
  - [ ] T5.2 Select：`score = 0.7*relevance + 0.3*recency`，排序
  - [ ] T5.3 Compress：按 `budget` 配额取 top-K，单条 head+tail 截断，`enableLLMSummary` 开关位（默认关）
  - [ ] T5.4 保持原函数签名向后兼容；既有 `historyLayer` 测试适配
- [ ] T6 historyLayer 集成测试：候选 > 配额、全相关、全无关、空历史四种场景

## 阶段 3：预算守护

- [ ] T7 实现 `BudgetGuard.compose(parts, budget)`：
  - [ ] T7.1 P0 无条件纳入
  - [ ] T7.2 P1–P4 按优先级 + 配额填充
  - [ ] T7.3 超预算从 P4 逐级压缩/丢弃
  - [ ] T7.4 产出 `BudgetReport`
- [ ] T8 BudgetGuard 单测：超预算裁剪顺序、P0 不丢、配额边界

## 阶段 4：集成

- [ ] T9 改 `PromptComposer.composeUserPrompt`：各层 build 后包装成 `{layer, content, tokens, priority}`，交给 `BudgetGuard.compose`，返回 `{ prompt, report }`（注意：原函数返回 string，需评估调用方改动或保留兼容包装）
- [ ] T10 `budgetReport` 写日志（结构化）；预留 UI 消费的事件/接口
- [ ] T11 `PromptComposer` 既有测试全绿；新增预算场景集成测试

## 阶段 5：配置与文档

- [ ] T12 预算配置接入角色卡 / 项目配置读取路径（默认 8K token、reserve 0.15）
- [ ] T13 更新 `docs/wiki/01-architecture.md` 上下文层章节（架构图 + BudgetGuard + GSSC）
- [ ] T14 更新 `specs/context-budget-management/checklist.md` 全部勾选，准备归档
