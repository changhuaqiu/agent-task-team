# Non-Git WorkItem Runtime Evaluation

- Change ID: `non-git-workitem-runtime-2026-09-03`
- Evaluation level: C (Comparison)
- Status: measured, candidate component gate accepted
- Code/spec revision: `codex/non-git-workitem-runtime`, baseline `main@3b4bd6c`
- Evaluator/benchmark revision: Vitest 4.1.5; live desktop SQLite baseline 2026-09-03

## Why

Project workspace 的持久配置允许普通目录以 `use_worktree=0` 直接执行，但 `work.create` 无条件把每个新 WorkItem 写成
`use_worktree=1`，并用 `project.root_path` 填充 `git_repo_root`。真实普通目录项目因此在 Agent 进程启动前被 Git 基线门拒绝；
消息已经进入 Inbox，用户却只看到 Agent 不回复。

真实受影响 WorkItem `workstream-f6f89681d1d9d1d43ee2d10d` 的 Project workspace 为 `(0,NULL)`，workstream 却为
`(1,C:/Users/qiufa/agent-interview)`。两次真实 Invocation 均以 `runtime_start_failed` 终止，耗时分别为 56 ms 和 64 ms，
都没有进入 `started_at`。

## What changed

- `work.create` 从同一 Project 的 `project_workspace` 继承执行模式；禁用 worktree 时不再派生 `git_repo_root`。
- GitHub Issue ingress 使用同一配置解析器；`true + 空 Git 根` 的损坏配置统一降级为直接目录模式。
- migration 113 以 `project_id + workspace_kind=project_workspace` 为 owner，修正全部 project-linked workstream 的两个派生字段。
- Runtime 不再把明确关闭 worktree 的 Git 目录自动升级；只有配置或 Evaluation 明确要求时才解析 Git baseline。
- Project、WorkItem、Task、消息、Artifact 和证据身份均不重建；历史失败 Invocation 继续保留为审计事实。
- Evaluation 的冻结 Git worktree 行为与严格失败不变量保持不变；其基线解析实现与普通 Runtime 一并收敛到 `WorktreeManager`。

回退代码提交可恢复旧创建行为；migration 是确定性配置校正，不删除业务对象。若需要恢复单个自定义值，可在 Project workspace
修改权威配置后重新同步其 WorkItem。

## Industry evidence

Git 官方文档将 linked worktree 定义为附属于某个 repository、并带有额外管理元数据的 working tree；因此普通目录不能仅凭路径
被当作可创建 worktree 的 repository。`git rev-parse` 官方文档也明确说明，大多数模式必须在受 Git 控制的 repository/working tree
中运行，否则以 fatal error 退出。本项目据此保留 Git 模式的严格校验，同时让未启用 worktree 的 Project 走普通目录执行路径。

- Git worktree documentation: https://git-scm.com/docs/git-worktree （访问：2026-09-03）
- Git rev-parse documentation: https://git-scm.com/docs/git-rev-parse （访问：2026-09-03）

外部文档只支持“worktree 必须依附有效 Git repository”这一边界；Project workspace 作为配置 owner 是本项目的数据模型决策，
由本地迁移和命令链测试证明。

## Method

样本与指标：

1. 只读查询真实桌面 SQLite，比较 Project workspace 与受影响 workstream 的 `use_worktree/git_repo_root`，并读取最近两次 Invocation；
2. 固定内存数据库创建默认普通目录 Project，再执行 `work.create`；
3. 固定内存数据库显式配置 Git worktree Project workspace，再执行 `work.create`；
4. 构造旧版错误 workstream，删除 migration 113 记录后重跑迁移；
5. 执行全量 Vitest、TypeScript 和 Next.js production build。

成功阈值：普通目录派生错误数为 0；既有错误行修复率 1/1；Git 配置保留率 1/1；损坏配置降级率 1/1；
GitHub Issue 与 UI 创建路径一致；业务对象删除数为 0；相关与全量测试无失败。

复现命令：

```powershell
git -C C:\Users\qiufa\agent-interview rev-parse --show-toplevel
pnpm exec vitest run src/server/command-kernel/service.test.ts src/server/github-issue-hook/ingress.test.ts src/server/worktree-manager.test.ts src/server/db/index.test.ts src/server/evaluation/recovery.test.ts
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

真实基线只读查询使用 `better-sqlite3` 打开桌面 `data.db`，按 Project root 连接 `project/conversation`，再按 conversation id 查询
`invocation` 与 `agent_inbox_item`；查询不写数据库。

## Baseline vs candidate

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| 默认普通目录 WorkItem 的错误 worktree 配置 | 1/1 | 0/1 |
| 既有错误 workstream 配置修复 | 0/1 | 1/1 |
| 显式 Git workspace 配置保留 | 1/1 | 1/1 |
| 明确 direct 的 Git 目录被自动升级 worktree | 1/1 | 0/1 |
| GitHub Issue 普通目录 WorkItem 错误启用 worktree | 1/1 | 0/1 |
| `true + 空 Git 根` 损坏配置归一化 | 0/1 | 1/1 |
| 修复需要重建 Project/WorkItem | 1（原路径无法启动） | 0 |
| 迁移删除 Project/WorkItem/Task/消息/证据 | 0 | 0 |
| 真实基线 Invocation 进入 Agent started 状态 | 0/2 | 待新版桌面运行复核 |

审查修正后的定向回归为 5 files / 95 tests 全通过，TypeScript 检查通过；最终全量回归为 271 files 通过、2 skipped，1992 tests 通过、
2 skipped；Next.js 16.2.4 production build 通过。首次全量回归仅发现 evaluation recovery 中的 schema max-version 期望仍为
112，随 migration 113 更新为 113 后对应恢复测试和全量测试均通过。

## Decision

接受候选进入桌面重建与真实恢复验证。确定性证据证明配置 owner、创建链和旧数据迁移闭合，并且没有放宽 Evaluation 的 Git 门。

这是 C 级组件/路径结论，只能说明“普通目录 WorkItem 不再因伪造的 Git 配置必然启动失败”。它不证明 Agent 的任务完成率、回答质量
或平均路径长度提高；这些结论仍需固定 TestSuiteRevision、baseline/candidate ApplicationSnapshot 和逐例 paired experiment。
