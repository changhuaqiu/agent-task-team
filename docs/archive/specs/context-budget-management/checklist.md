# 验收清单 — 上下文预算管理

## 功能验收
- [ ] 超预算时 **P0 层（role/protocol/task/behavior）不丢**
- [ ] 超预算时从 **P4（history）开始压缩/丢弃**，逐级向上（P4 → P3 → P2 …）
- [ ] `historyLayer` 候选 > 配额时正确 Select（相关性+新近性）+ Compress（head+tail 截断）
- [ ] 候选全无关时，history 不占预算（被低分过滤）
- [ ] 空历史不报错，输出空 history 段
- [ ] `budgetReport` 真实反映每层 `{ tokens, quota, trimmed, compressionRatio }`

## 接口兼容
- [ ] `buildHistoryLayer` 函数签名向后兼容（新增 `budget?` 可选参）
- [ ] `composeUserPrompt` 调用方要么平滑升级到 `{prompt, report}`，要么提供返回 string 的兼容包装
- [ ] 既有 `PromptComposer` / `historyLayer` 测试全部通过

## 约束验收
- [ ] 预算单位为 token（`gpt-tokenizer`），无字符计数残留
- [ ] 仅新增 `gpt-tokenizer` 一个运行时依赖，无重型依赖
- [ ] `enableLLMSummary` 开关存在且默认关闭（首版不落地 LLM 摘要）
- [ ] 预算阈值可从角色卡 / 项目配置读取，默认 8K token

## 可观测性
- [ ] 每次派发的 `budgetReport` 写入日志
- [ ] 报告含裁剪事件（哪层被压、压了多少）

## 文档与规范
- [ ] `docs/wiki/01-architecture.md` 上下文层章节已同步（架构图 + BudgetGuard + GSSC）
- [ ] 遵循 `docs/standards/technical.md`（实现期对齐）
- [ ] 无根目录新增散落 markdown（遵循 AGENTS.md "No Root Clutter"）

## 非目标确认（确认未越界）
- [ ] 未实现跨会话 archival 记忆层（留后续 spec）
- [ ] 未落地 embedding 相关性（只预留 `RelevanceProvider` 接口）
- [ ] 未落地 LLM 摘要压缩运行时（只留开关位）
