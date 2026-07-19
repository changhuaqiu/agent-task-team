# Git 协作闭环真实演练计划

> 状态：执行中
> 日期：2026-07-19
> 关联 Issue：[#54](https://github.com/changhuaqiu/agent-task-team/issues/54)、[#55](https://github.com/changhuaqiu/agent-task-team/issues/55)、[#56](https://github.com/changhuaqiu/agent-task-team/issues/56)
> 演练分支：`codex/git-collaboration-e2e-20260719`

## 1. 目标

在真实 GitHub 仓库上验证当前四 Agent Git 协作闭环：

```text
任务拆解
  → 架构评审
  → 开发与自测
  → commit / push / draft PR
  → 基于 PR 精确 head SHA 的质量评审
  → REJECT + linked Issue
  → 同一 PR 新 commit 修复
  → 重审 PASS
  → 授权合并
  → main 复验与 merge receipt
```

关键转换必须同时留下 GitHub URL、commit SHA、Task Graph action、结构化回执或可重复执行的测试证据，不能只依赖自然语言自述。

## 2. 审计结论与问题拆解

当前实现已经具备 PR、Review、Merge 三类 provider 回执和 Task Graph 门禁，但 `recordPullRequest()` 的后续回执连续性校验只覆盖 `in_review`，没有覆盖 `rejected`。这允许被打回的任务换 PR 或原样重报同一 head SHA。

本轮拆为以下任务：

| 任务 | Owner 视角 | 交付 |
| --- | --- | --- |
| E2E-GIT-01 | Mario | 冻结范围、验收标准、证据链 |
| E2E-GIT-02 | DK | 评审回执连续性门禁的位置、失败语义和兼容边界 |
| E2E-GIT-03 | Luigi | 实现同一 PR / 新 head 门禁与回归测试 |
| E2E-GIT-04 | Peach | 基于真实 PR diff、自测和 CI 证据执行 REJECT / PASS 两轮评审 |
| E2E-GIT-05 | Mario | 授权合并后在 main 复验并核对 merge receipt |
| E2E-GIT-06 | Luigi | 修复 package manifest 与 pnpm lockfile 不一致，并复验 frozen install |
| E2E-GIT-07 | Luigi | 将 ACP 测试直接使用的 `tsx` 声明为 devDependency，并复验 subprocess 测试 |

## 3. 架构评审记录（G1）

### 3.1 评审范围

- 权威入口：`EngineeringCollaborationService.recordPullRequest()`
- 事实来源：`GitProviderVerifier` 返回的 canonical PR URL 和 head SHA
- 状态范围：已经存在 PR 回执、且任务处于 `in_review` 或 `rejected`
- 失败原子性：校验必须发生在数据库事务和消息/卡片写入前

### 3.2 方案比较

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 仅更新 Luigi prompt / Skill 文案 | 否决 | 只能约束模型意图，不能形成可验证门禁 |
| 在 API 或 ACP 工具入口分别校验 | 否决 | 多入口会重复规则，后续入口容易绕过 |
| 在 `EngineeringCollaborationService` 统一校验 | 采用 | API、ACP Skill 和测试 seam 共享同一事实边界 |
| 新建 receipt 专用表和数据库唯一约束 | 暂不采用 | 当前 action log 已是权威历史；为两个连续性不变量引入新表过重 |

### 3.3 冻结约束

1. 后续回执必须沿用上一条已验证 receipt 的 canonical PR URL。
2. 后续回执的 head SHA 必须不同于上一条 receipt。
3. 换 PR 返回 `pull_request_changed`；同 SHA 返回 `pull_request_head_unchanged`。
4. 失败时 task status、action、artifact、card、proof 都不得变化。
5. 正常的同 PR 新 head 修复流程保持兼容，并继续使旧 Review 变为 stale。

### 3.4 可测性评审

- 使用注入式 `GitProviderVerifier` 构造另一个 PR、相同 head 和新 head；
- 断言稳定 reason code；
- 同时断言失败前后的 task status 与 action/artifact/message/proof 数量；
- 保留真实 GitHub PR 的 provider 回执演练，避免只验证 mock。

本记录由当前执行者按项目 G1 的架构、边界、安全和可测性检查项完成；它不伪造为另一个 GitHub 身份的独立批准。后续独立质量判断以真实 PR 评论和可重复测试证据为准。

## 4. 验收

- [x] Issue #54 在开发前创建；PR 创建后补关联
- [x] Issue #55 的 lockfile 一致性缺陷已修复，干净 worktree 的 frozen install 通过
- [x] Issue #56 的测试依赖缺口已修复，ACP subprocess/hardening 测试 19/19 通过
- [x] Issue #58：Web UI 发现计划清单 mention 可绕过 Task Graph 依赖并触发重复派发；先冻结门禁设计，再补回归和页面复验
- [x] Issue #59：显式 A2A 引用真实存在但 owner 不属于目标 Agent 的 task 时没有失败关闭
- [x] Issue #60：Git worktree turn 完成后 session/GC 元数据目录缺失，ENOENT 将正常完成误报为 spawn_failed
- [x] 规格与长期技术设计先于实现更新
- [x] 两条失败路径先由回归测试证明
- [x] 定向测试 28/28、全量测试 1126/1126、类型检查和生产构建通过
- [ ] 真实 PR 上完成一次 REJECT → 修复 → PASS
- [ ] 新 commit 使旧评审失效，并由当前 head 的新评审放行
- [ ] 合并后在 `main` 复验并记录 provider merge receipt
- [ ] GitHub、Task Graph、PR/review/merge SHA 可交叉核对

## 5. 开发自测证据

| 门禁 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS；Issue #55 修复后干净安装成功 |
| 门禁回归（修复前） | 2 条新增用例按预期失败，证明换 PR 和同 SHA 重报均可绕过 |
| 协作相关定向测试 | 5 files / 28 tests PASS |
| ACP subprocess/hardening | 2 files / 19 tests PASS；Issue #56 收敛 |
| TypeScript | `pnpm exec tsc --noEmit` PASS |
| Scoped ESLint | 目标 service 与 test PASS |
| Production build | `pnpm build` PASS |
| 全量 Vitest | 126 files / 1126 tests PASS |

## 6. Web UI 门禁绕过回归（Issue #58）

浏览器首次演练中，Mario 已写入严格依赖图并只启动 `TASK-002`，但回复内 PHASE/TASK 清单末尾的 owner mention 被 A2A 扫描器误判为即时交接；`@peach` 从同一回复中借用了 `REJECT` 动词，提前成为当前持球者，同时 `task_assign` 与显式 `@dk` 产生重复派发。

修复把“文本意图识别”和“Task Graph 运行门禁”分成两层：

1. trailing mention 不再回退借用整段响应，PHASE/TASK roster clause 不产生 pass intent；
2. 显式交接引用目标 task 时，Orchestrator 校验 owner、依赖和 active 状态；依赖未完成时拒绝，已运行时幂等 no-op。

| 门禁 | 结果 |
| --- | --- |
| 失败复现 | 新增 roster 用例修复前稳定选中 `@peach` / `reject`，证明可绕过依赖 |
| Scanner / Pass Intent / A2A Integration | 3 files / 75 tests PASS |
| TypeScript | `pnpm exec tsc --noEmit` PASS |
| Scoped ESLint | 新增 scanner、intent、snapshot 源码与定向测试 PASS；既有 integration/orchestrator 文件仍有历史 `no-explicit-any` 基线 |
| Production build | PASS；保留既有 worktree-manager NFT tracing warning |
| Web UI 回归 | PASS；第二轮全新 conversation 仅 DK 启动，下游未提前持球 |

## 7. Web UI 运行时完成边界回归（Issue #59 / #60）

第二轮浏览器演练证明依赖门禁已阻止下游提前启动，但又暴露两个完成边界缺陷：

1. 架构评审发现显式 A2A 若引用非目标 Agent 所属 task，当前解析会先按目标 owner 过滤并降级成普通 A2A，违反 fail-closed 约束；
2. DK 正常完成后，`writeGCMeta` 向尚未创建的 `workspaces/<conversation>/<agent>/task-<id>` 写入 `.gc_meta.json`，触发 ENOENT；Mario 的 `.session.json` / `.gc_meta.json` 同样复现，页面最终显示 `spawn_failed`。

修复验收：

- owner mismatch 不创建 pass、worklist 或 dispatch，并留下稳定 `task_owner_mismatch` 审计证据；
- session/GC 元数据写入在非 worktree 与共享 Git worktree 模式都自行确保 scoped task root；
- Web UI 中 Agent 正常结束后不再出现由元数据 ENOENT 导致的 `spawn_failed`。

## 8. Web UI 客户端确认边界回归（Issue #61）

第三轮使用全新 Web UI 项目和唯一任务 `TASK-015`，专门验证同一任务、同一 PR 在门禁拒绝后的状态一致性：

- Luigi 通过平台工具登记 PR #57，平台校验 head `8bb36273fa760bd70faccf08c9cde85c7def0710` 后将任务推进到 review；
- Peach 复用真实 GitHub 评论并通过平台工具登记 REJECT，平台校验评论作者、PR、head 与决策后，将同一任务退回 rejected 并自动唤醒 Luigi；
- 真实阻塞问题为 [Issue #61](https://github.com/changhuaqiu/agent-task-team/issues/61)，对应拒绝评论为 [PR #57 comment](https://github.com/changhuaqiu/agent-task-team/pull/57#issuecomment-5014203721)；
- 根因是 Web 客户端在服务端确认任务状态前就发布 `task.status_changed`、成功聊天卡和后续调度，导致 403 或网络失败仍残留“已完成”叙事；
- 修复将任务状态更新改为异步确认边界：只乐观更新任务实体，成功副作用等待 `response.ok`；非 2xx 与网络异常统一回滚并展示 blocker，不再发布成功回执或触发下游；
- 定向回归覆盖 pending-success、403 和网络异常三个分支，共 3 项通过；TypeScript 类型检查与 `git diff --check` 通过。

当前等待把修复提交到同一 PR 的新 head；旧 head 不得重新提交，也不得绕过 Peach 的新一轮复审。
