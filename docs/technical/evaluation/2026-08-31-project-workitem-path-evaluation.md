# Project WorkItem Path Evaluation

- Change ID: `project-workitem-hierarchy-2026-08-31`
- Evaluation level: C (Comparison)
- Status: accepted
- Code/spec revision: `codex/project-workitem-hierarchy`, baseline `main@7c415a2`
- Evaluator/benchmark revision: Vitest 4.1.5; Next.js 16.2.4; 2026-08-31/09-01 local browser and desktop run

## Why

基线把 Project workspace Conversation 同时当作项目、所有工作的讨论区和 Task Graph 隔离键。多个 Issue、变更和改进共用一条消息流，用户难以追溯工作归属，Agent 也容易把其他工作的消息和任务带入当前执行。项目交付件虽已有角色投影，但缺少工作项作用域，仍会在项目级一次性聚合。

## What changed

- Project 成为长期汇总容器，默认打开概览，项目活动为只读聚合。
- 每个新 Work 原子获得独立 `workstream` Conversation 和根 Task；Project workspace 不再接收新 Task Graph。
- WorkItem 详情统一承载目标、Task/Subtask、独立活动与按角色分列的关联交付件。
- GitHub Issue 按仓库目录复用 Project，每个 Issue 使用独立 workstream；根 Task 生成前仍显示“等待任务规划”工作项。
- 旧 Project workspace Task 继续投影为 legacy WorkItem，不要求用户重建项目。

回退方式是回退该变更；没有破坏性数据迁移，Conversation、Task、Artifact 和 Review 真相源未被复制。

## Industry evidence

访问日期均为 2026-08-31。

- [Linear conceptual model](https://linear.app/docs/conceptual-model) 将 Project 与 Issue 分层，Project 承载高层计划，Issue 承载可执行工作。
- [Linear project overview](https://linear.app/docs/project-overview) 用概览汇总项目资源与进度；[issue comments](https://linear.app/docs/comment-on-issues) 把讨论归属到具体 Issue。
- [GitHub Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects) 作为工作聚合与视图，[Sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/browsing-sub-issues) 保留工作项内部层级。
- [Jira work type hierarchy](https://support.atlassian.com/jira-cloud-administration/docs/configure-the-issue-type-hierarchy/) 明确区分上层计划、标准工作项与 Subtask。

可迁移的共性是“上层聚合、工作项承载协作、子任务承载执行拆解”。本项目没有照搬外部产品的状态、字段或视图数量。

## Method

### Fixture

- 确定性服务端 fixture：同一 Project 连续创建两个 Work，检查 Conversation/Task 归属。
- 前端 fixture：两个 workstream、各一个根 Task，切换工作项活动和交付件。
- 真实页面 fixture：本地 3107 页面创建一个 Project 和三个 WorkItem，检查概览、项目活动、工作项活动，以及从 A 的活动页创建 B 后的作用域切换。

### Metrics

| Metric | Baseline | Candidate | Threshold |
| --- | ---: | ---: | ---: |
| 同一 Project 两个新 Work 的 Task Graph scope 数 | 1 | 2 | 2 |
| Project 默认/项目活动聊天输入器数 | 1 | 0 | 0 |
| 工作项活动聊天输入器数 | 不可归因（共享） | 1（所选 workstream） | 1 |
| 根 Task 未生成的已接收 Issue 可见性 | 0 | 1 | 1 |
| 旧 Project workspace Task 可发现性 | 1 | 1（legacy 标记） | 不下降 |

### Reproduction

```powershell
pnpm exec vitest run src/server/command-kernel/service.test.ts src/server/github-issue-hook/ingress.test.ts src/__tests__/project/project-work-items.test.ts src/__tests__/project/ProjectWorkItemsWorkspace.test.tsx
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

## Baseline vs candidate

- 服务端隔离用例证明两个 Work 获得两个不同 conversationId，各有 1 个 Task，Project workspace Task 数为 0。
- 投影用例覆盖新 workstream 根/子 Task、legacy Task、跨 Project 隔离和待规划 Issue 可见性。
- 组件用例证明切换 WorkItem 后活动 conversationId、A2A 作用域与 Artifact workId 同步切换；现代 workstream 跟随权威 Conversation，复用 Project Conversation 的 legacy WorkItem 仍可独立选择。角色列只显示有贡献的角色，列内再按实现/设计与文档等业务类别组织。
- 本地真实页面中，Project 显示 3 个独立工作项；项目活动有 0 个 textbox，所选工作项活动有 1 个 textbox；从工作项 A 的活动页真实创建 B 后，列表、标题、详情和唯一输入器全部切到 B。Project 入口回到概览；宽屏完成真实浏览器验证，窄屏折叠由响应式结构断言覆盖。
- 全量回归：271 个文件通过、2 个跳过；1980 项通过、2 项跳过。TypeScript 和 production build 通过；build 仅保留已知 NFT 动态文件追踪警告。三轮独立复审最终为 0 Critical / 0 Important，Ready to merge。
- 在 `main` 清空旧 Service staging 后重新完成 Rust release 构建；Renderer/Service build identity 唯一为 `desktop-build-03f33ae76d76cbfda2be76e0c9812268`，EXE SHA-256 为 `1EAD600CAE9113DAF5C70DB0653C3FD51C551729BE0FD43A7FB256E04E963894`。

## Decision

接受该候选。它消除了可确定复现的 Project/WorkItem 作用域冲突，同时保持旧项目数据可见。

评测级别是 C，不声称 Agent 在代表性真实任务上的完成率已提升。当候选桌面版产生足够真实 WorkItem Trace，或将 WorkItem scope 直接作为 Prompt/Skill/协作策略变量时，必须使用固定 TestSuiteRevision、baseline/candidate ApplicationSnapshot 和逐例 paired diff 进入 E 级复测。
