# 四 Agent PR 交付与评审闭环

> 状态：active
> 日期：2026-07-18
> 依赖：`team-simplification`、`system-control-plane`、`a2a-possession-contract`、`agent-observability`

## 1. 目标

把默认四角色团队从“能连续对话和改任务状态”推进为可验证的工程交付组织：Mario 统筹、DK 处理架构风险、Luigi 实现并提交 PR、Peach 基于该 PR 做真实评审和测试。所有关键转换必须由 Git 托管平台回执、任务证据和聊天卡片证明，不能只依赖 Agent 自述。

## 2. 第一条端到端场景

```text
用户 → Mario 拆任务
     → DK 按风险规则给出架构约束或记录“不需要专项架构评审”
     → Luigi 在隔离分支实现、测试、提交、推送并创建 PR
     → 平台验证 PR 后发布“开发交付卡”，任务进入 in_review
     → Peach 打开同一 PR 的精确 head SHA，审查 diff/CI 并执行测试
     → Peach 在 GitHub 留下真实 review/comment
     → 平台验证 review 后发布“代码评审卡”
     → REJECT：任务退回 Luigi；APPROVE：等待有权限的人合并
     → 合并后在 main 上复验，Mario 关闭任务并发布闭环摘要
```

## 3. 四角色约束

### Mario（统筹）

- 定义目标、验收标准、任务依赖和风险等级；
- 不替 Luigi 实现，不替 Peach 审批；
- 确认 DK 是否需要介入，并为“不介入”留下风险判断证据；
- 只在合并和 main 复验均有证据后关闭任务；
- 默认没有自动合并权限；未配置 merge authority 时请求用户合并。

### DK（架构工程）

- 仅在 schema、公共接口、安全、权限、数据迁移、跨模块边界或性能风险触发时成为必经 gate；
- 输出约束、替代方案和需验证的风险，不接管常规实现；
- 发现架构阻塞时退回 Mario 做范围/取舍决策；
- 低风险任务也必须由 Mario 记录 `architecture_check=not_required`，不能静默跳过。

### Luigi（全栈开发）

- 一个 task 使用一个隔离分支和一个主 PR；修复继续推到同一 PR；
- 进入评审前必须完成 commit、push、PR 创建以及适用的 install/typecheck/build/test；
- PR body 必须关联 task ID、摘要、测试、风险和 UI 截图（适用时）；
- 不能通过聊天粘贴 URL 冒充交付；必须提交结构化 PR 回执，由平台验证后生成卡片；
- 提交 PR 后结束本轮，由 Task Graph 唤醒 Peach，不重复手工 `@peach`。

### Peach（质量保障）

- 必须以开发交付卡中的 PR number、repository 和 head SHA 为评审输入；
- 先审查 correctness/security/regression/test gaps，再执行适用测试；
- 必须在 GitHub 留下真实 review 或 comment；纯聊天结论不构成评审证据；
- 每个 blocker 优先使用可定位的 inline comment；无法定位到行时使用总评评论；
- APPROVE/REJECT 必须绑定所评审的 head SHA；PR 新增 commit 后旧批准自动失效；
- REJECT 直接退回 Luigi；同一任务连续两次拒绝或出现架构风险时升级 Mario/DK。

## 4. 权威对象

### 4.1 PullRequestReceipt

- provider、repository、PR number、canonical URL；
- base/head branch、head SHA、author、state、draft；
- checks 状态与获取时间；
- task ID、提交者 Agent ID、验证时间。

### 4.2 ReviewReceipt

- provider review/comment ID 与 canonical URL；
- reviewer Agent ID、provider actor；
- decision：`approved | changes_requested | commented`；
- reviewed head SHA；
- blocker 数、测试摘要、提交时间、验证时间。

### 4.3 CollaborationCard

聊天只展示服务端根据回执生成的结构化卡片：

- 开发交付卡：PR、分支、commit、checks、测试、风险、打开 PR；
- 代码评审卡：结论、评审者、对应 commit、真实评论链接、blocker、测试结果；
- 合并闭环卡：merge commit、main 复验、关闭人、剩余风险。

Agent 正文中的 Markdown 链接仍可显示，但不具有状态转换权威。

## 5. 状态与门禁

| Task 状态 | 必需证据 | 下一步 |
| --- | --- | --- |
| `in_progress` | owner、分支/工作树 | Luigi 实现 |
| `in_review` | 已验证 PR receipt + implementation evidence | 唤醒 Peach |
| `rejected` | 已验证 review receipt，decision=`changes_requested` | 唤醒 Luigi，继续同一 PR |
| `in_review`（已批准） | 当前 head SHA 的 approved review receipt | 等待 merge authority |
| `done` | PR merged + merge SHA + main delivery evidence | Mario 闭环 |

强制规则：

- 没有已验证 PR 不能进入 `in_review`；
- 没有真实 provider review/comment 不能记录评审决定；
- review head SHA 与当前 PR head SHA 不同视为 `review_stale`；
- PR 关闭但未合并视为交付失败，不能 `done`；
- reviewer 和 implementer Agent ID 必须不同；
- merge 后必须在目标分支复验，不能复用 PR 分支测试冒充 main 证据。

## 6. 失败回路

- GitHub 未认证：`git_provider_auth_missing`，卡片不创建，任务保持原状态；
- PR 不存在或仓库不匹配：`pull_request_not_found` / `repository_mismatch`；
- PR head 已变化：`pull_request_head_changed`，旧评审失效并重新唤醒 Peach；
- review 未落到 provider：`review_receipt_missing`；
- checks 失败：`pull_request_checks_failed`，退回 Luigi；
- 连续两次 REJECT：`review_rejection_budget_exhausted`，升级 Mario；
- 合并权限缺失：`merge_authority_required`，明确等待用户，不伪造完成。

## 7. 第一阶段不做

- 不自动替用户授予 merge 权限；
- 不支持从聊天正文猜测 PR 或评审完成；
- 不在第一阶段统一 GitLab/Bitbucket，但数据契约保留 provider 字段；
- 不要求每个低风险 task 都实际唤醒 DK；要求留下显式风险判断；
- 不让多个 reviewer 同时拥有最终 gate authority。

## 8. 退出条件

- 四角色职责、权限和失败回路进入 TeamPack/RoleCard 上下文；
- PR receipt 与 review receipt 有服务端验证和持久化事实源；
- `in_review`/review decision/`done` 都由相应回执门禁；
- Web 聊天中能渲染开发交付卡、代码评审卡和合并闭环卡；
- 真实 GitHub PR 上能看到 Peach 产生的评论或 review；
- REJECT→Luigi 修复→同一 PR 重审以及新 commit 使旧批准失效均有自动化覆盖；
- 使用四个真实 Agent runtime 完成一次浏览器端到端协作并可从 Task Graph、GitHub、聊天卡片和 observability 交叉验证。
