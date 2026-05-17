# 08 — 开发流程门控规范（Review Protocols）

> **操作版**：[`.ath/PROTOCOLS.md`](../../.ath/PROTOCOLS.md)（团队协作工具链引用此路径）
>
> 版本：1.3 | 创建：2026-05-04 | 最后更新：2026-05-17
>
> 守门人：@peach（G2）、@dk（G3 协审）
> 架构评审：@dk | 方案评审：@dk @yoshi | 统筹：@mario

本文定义了任务从方案到合并的三个必经门控点。每个门控有明确的触发条件、参与人、通过标准和阻塞规则。

## 状态流转总览

```
todo ──[G1 通过]──→ doing ──[实现完成]──→ draft MR ──[review issues 清零]──→ G3 ──→ done
                          ↑                    ↑                             ↑
                      方案评审             质量守卫 + issue 修复循环       合并门控

hotfix ──[跳过 G1]──→ doing ──[draft MR + G2 精简]──→ G3 单人 ──→ done ──[48h 补全 G2]
```

---

## G1: 方案评审（Planning Gate）

### 触发条件
- Mario 输出 PHASE/TASK 拆解方案后
- 状态变更：方案中的任务准备从 `todo → doing`

### 参与人

| 角色 | Agent | 关注维度 | 权重 |
|------|-------|---------|------|
| 架构评审 | @dk | 系统设计合理性、依赖方向、接口边界 | **必须通过** |
| 测试评审 | @yoshi | 可测性、是否有不可 mock 的硬依赖 | **无阻塞异议即可** |
| 质量守卫（可选） | @peach | 命名规范、类型设计是否对齐已有约定 | 仅公共类型变更时参与 |

### 通过条件
1. `@dk` 明确通过（无保留意见）
2. `@yoshi` 无阻塞性异议（可提建议但不阻塞）
3. 如涉及公共类型/接口变更，`@peach` 确认对齐现有约定

### 阻塞规则
- 未通过 G1 的任务**禁止**从 `todo → doing`
- 有异议时，Mario 修订方案后重新提交 G1

### 超时规则
- G1 提交后 **24 小时**内无响应 → @mario 有权决定是否放行（记录理由）
- 有明确异议时，超时规则不适用（必须先解决异议）

### 退出路径
- 连续 **2 次** G1 未通过 → 升级到用户决策（继续 / 换方向 / 取消）
- 防止方案方向根本性偏差时陷入无限循环

---

## G2: 质量守卫（Review Gate）

### 触发条件
- 实现者完成任务，自测通过，并提交 draft PR/MR 作为审查面
- 或：实现者标 `doing` 并提交代码后主动请求 review
- 任务状态从 `doing → review` 时，应附带 PR/MR 链接或明确说明无法创建 PR/MR 的认证/远端阻塞

### 守门人
- **@peach**（主要负责）
- **@dk 协审**（满足以下任一条件时触发）：
  - 改动涉及 **2 个及以上 store 文件**
  - **新增或删除**公共 interface/type（[`src/store/types.ts`](../../src/store/types.ts)、[`src/types/`](../../src/types/)）
  - 改动涉及 **socket/事件机制**（[`src/store/daemonStore.ts`](../../src/store/daemonStore.ts) 事件监听段）

### 检查力度分级

| 档位 | 检查项范围 | 适用场景 |
|------|-----------|---------|
| 标准（Standard） | A~G 全部 | 新功能、涉及公共接口变更 |
| 精简（Reduced） | A+C+D+F | Bugfix、内部重构、单文件改动 |
| 最小（Minimal） | A+F | 紧急修复（Hotfix 走独立流程，不在此分级内） |

**精简级使用条件**（必须同时满足）：
1. 改动文件数 ≤ 3
2. 不涉及公共 interface/type 变更
3. 不新建文件（仅修改已有文件）

**精简级注意事项**：
1. 跳过的检查项不代表可以忽略，而是默认实现者已自检
2. 如审查过程中发现异常，可随时升级到标准级

**判定规则**：
- 默认使用**标准级**
- 实现者可在提交 review 时标注建议档位，审查人有权升级
- 同一任务涉及多种类型时，取最严格档位
- Hotfix 通道有独立的精简流程，与本分级不冲突

### 检查清单

#### A. 类型安全（Type Safety）
- [ ] 无 `as any`、`@ts-ignore`、`@ts-expect-error`
- [ ] 新增 interface/type 有 JSDoc 注释说明用途
- [ ] 函数参数和返回值类型完整（不含隐式 `any`）
- [ ] 泛型使用合理，未为绕过类型检查而滥用

**验证方式**：`npx tsc --noEmit` 无新增错误

#### B. 规范一致性（Convention Alignment）
- [ ] 文件命名与现有同类文件一致（参照 `src/store/`、`src/hooks/`、`src/components/` 下已有文件）
- [ ] 导出方式与模块风格统一（named export vs default export）
- [ ] 变量/函数命名符合项目约定（camelCase 变量，PascalCase 组件/类型）
- [ ] 新文件放在正确的目录层级（store → `src/store/`，hooks → `src/hooks/`，组件 → `src/components/`）

**验证方式**：对比同类文件的命名和导出模式

#### C. 边界条件（Edge Cases）
- [ ] `null` / `undefined` / 空数组路径有显式处理（不允许依赖短路隐式返回）
- [ ] 异步操作有错误处理（不允许空 `.catch(() => {})`，除非有明确注释说明忽略原因）
- [ ] 资源泄漏检查：`setTimeout` / `setInterval` / 事件监听器有对应清理
- [ ] 并发安全：共享状态的并发访问有防护（参照 [`daemonStore.ts`](../../src/store/daemonStore.ts) 的 `pendingDispatches` 模式）

**验证方式**：逐条检查 `if (!xxx)` 和 `catch` 分支

#### D. 安全审计（Security）
- [ ] 无硬编码密钥、token、凭证（含 `.env` 以外的文件）
- [ ] 无 `eval()`、`innerHTML`、`dangerouslySetInnerHTML`
- [ ] 用户输入有校验/转义
- [ ] API 调用不暴露内部实现细节到客户端

**验证方式**：grep 检查敏感模式

#### E. 测试覆盖（Test Coverage）
- [ ] Store 逻辑（slice/action）有单元测试
- [ ] Hook 有 `renderHook` 测试覆盖 happy path + 至少 1 条 error path
- [ ] 新增的工具函数有对应的 `*.test.ts` 文件
- [ ] 测试文件放在与源文件对应的 `__tests__/` 或同级目录

**验证方式**：`npx vitest run --reporter=verbose` 查看覆盖率

#### F. 改动范围控制（Scope Boundary）
- [ ] 改动未超出 TASK 定义中的 Deliverable 范围
- [ ] 未引入 TASK 未提及的新依赖
- [ ] 未修改与 TASK 无关的已有文件（除非是必要的类型联动）
- [ ] 修改已有逻辑时，相关既有测试仍然通过（`npx vitest run` 无新增失败）

**验证方式**：`git diff --stat` 对比 TASK 的 Deliverable 描述

#### G. 文档同步（Documentation Sync）
- [ ] 涉及领域模型变更 → 更新 [`03-store-model.md`](./03-store-model.md)
- [ ] 涉及 API 变更 → 更新对应的技术文档
- [ ] 涉及 UX 变更 → 更新对应的产品文档
- [ ] 遵循 `AGENTS.md` 中的 Multi-Agent Documentation Rules

**验证方式**：对照 `AGENTS.md` 的文档规则逐项检查

### 产出格式

审查报告必须包含以下结构：

```markdown
# Review Report: [TASK-ID] [Task Title]

## 结论
- [ ] pass — 通过，可进入 G3
- [ ] pass-with-notes — 通过，但有建议项（不阻塞）
- [ ] block — 不通过，需返工

## 检查项结果

| 类别 | 状态 | 备注 |
|------|------|------|
| A. 类型安全 | ✅/⚠️/❌ | 具体发现 |
| B. 规范一致性 | ✅/⚠️/❌ | 具体发现 |
| ... | ... | ... |

## 具体问题

### ❌ [BLOCK] 问题描述
- **文件**: `src/store/xxx.ts:L42`
- **问题**: 具体描述
- **修复方向**: 建议的修复方式

### ⚠️ [NOTE] 建议描述
- **文件**: `src/store/xxx.ts:L55`
- **建议**: 改进建议（不阻塞）
```

### 阻塞规则
- 未提交 draft PR/MR 的实现任务不得进入 G3，除非明确记录认证、远端或用户授权阻塞
- `block` 结论必须转化为 linked issue，作为实现者的返工队列
- 实现者修复 linked issue 后，继续向同一个 PR/MR 推送提交，并请求对应审查人复核
- `pass-with-notes` 可进入 G3，但建议项应跟进

---

## Review Issue Fix Loop（MR/PR 上的问题修复闭环）

### 默认流程
1. 实现者完成代码与自测后，创建 draft PR/MR。
2. @peach、@dk、@yoshi 或其他相关审查角色基于 PR/MR diff、CI、测试证据审查。
3. 需要代码、测试、文档、UX 或架构返工的问题，审查人创建 linked issue；纯建议可保留为 review note。
4. 实现者按 issue 修复，在同一个 PR/MR 分支追加提交，并在 issue 中附测试证据。
5. 审查人复核 issue，确认解决后关闭或标记 resolved。
6. 所有 blocking linked issues 清零后，PR/MR 进入 G3。

### Issue 要求
- 标题包含任务 ID 或 PR/MR 编号，避免脱离上下文。
- 正文包含问题、证据、影响、期望行为、修复验收标准。
- 必须链接 PR/MR、相关 TASK、失败测试或文件位置。
- 不重复创建同一问题；已有 issue 应追加证据和状态。

### 权限要求
- Git token / SSH / provider app / `gh` / `glab` 认证是外部凭证，不写入任务、评论或 Skill。
- 如果无法创建 PR/MR 或 issue，agent 必须说明缺少的认证或工具，并给出下一步配置命令。
- 合并仍由用户或明确授权的 maintainer 执行，agent 不默认 merge。

---

## G3: MR 合并门控（Merge Gate）

### 触发条件
- G2 blocking linked issues 清零后，draft PR/MR 准备进入合并门控
- 任务状态：`review` → 准备标 `done`

### 审批人
- **@peach**（质量确认 — blocking）
- **@dk**（架构一致性确认 — blocking）
- **@mario**（Deliverable 完整性确认 — 知会，不 blocking 除非主动提异议）

### 通过条件
- @peach 确认：实现与 G2 审查结论一致，block 项已修复
- @dk 确认：实现未偏离 G1 架构设计，接口边界未被破坏
- @mario 确认：Deliverable 完整（知会性质，不阻塞合并）
- **@peach + @dk 双人 approve 后方可合并**

### 合并冲突处理
- 冲突由**后提交者**解决 + 重新过 G2（仅冲突部分）
- 如果冲突范围超出 50 行，@dk 介入判断是否需要重新架构

### 阻塞规则
- 未经双人 approve 的 MR **禁止**合并
- 合并后任务状态 → `done`

---

## Hotfix 快速通道

适用于 **P0 线上故障**（由 @mario 判定是否适用）。

### 流程简化
- **跳过 G1**（无需方案评审，直接进入实现）
- **G2 精简**：只检查 A（类型安全）、C（边界条件）、D（安全审计）三项
- **G3 精简**：只需 @peach 单人 approve

### 事后补全
- 合并后 **48 小时内**补全 G2 剩余检查项（B/E/F/G）
- 补全结果记录到任务备注

---

## 附录：状态转换前置条件速查

| 转换 | 前置条件 | 门控 |
|------|---------|------|
| `todo → doing` | G1 方案评审通过 | G1 |
| `doing → review` | 代码实现完成 + 自测通过 | — |
| `doing/review → draft MR` | 实现完成 + 自测通过 + 可创建远端分支 | G2 输入 |
| `review → G3` | G2 blocking linked issues 清零 | G2 |
| `G3 → done` | G3 双人审批通过 + 合并完成 | G3 |
| `任意 → blocked` | 遇到阻塞（技术/依赖/外部） | 记录到风险表 |
| `hotfix → doing` | @mario 判定 P0 | 跳过 G1 |
| `hotfix draft MR → done` | G2 精简通过 + G3 单人 approve | 精简 G2/G3 |

---

## 修订历史

| 版本 | 日期 | 变更 | 作者 |
|------|------|------|------|
| 1.0 | 2026-05-04 | 初始版本：G1/G2/G3 三门控 | @peach |
| 1.1 | 2026-05-04 | DK 架构评审反馈：G1 退出路径+超时、G2 协审量化+E/F 项修正、G3 审批人+冲突机制、Hotfix 通道 | @peach |
| 1.2 | 2026-05-04 | Yoshi 反馈：G2 检查力度三级分级（标准/精简/最小），按任务类型选择审查深度 | @peach |
| 1.3 | 2026-05-17 | 开发完成后以 draft PR/MR 作为审查面，blocking 发现转 linked issue，开发者按 issue 修复后进入 G3 | @codex |
