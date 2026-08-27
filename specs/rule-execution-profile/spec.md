# Agent 规则执行配置规格

> 状态：active
> 日期：2026-08-21
> 依赖：`context-manager`、`skill-package-progressive-loading`、`system-control-plane`

## 1. 目标

把“当前该做什么、必须具备什么能力、加载哪些 Skill、允许如何退出”从 Agent 自由发挥提升为服务端生成的不可变执行配置。Agent Definition 的结构化 responsibility 与 instructions 表达职责和工作方式，平台负责阶段判定、能力授予、Skill 激活和硬门禁。

## 2. 问题

现网 `TASK-015` 要求真实浏览器证据，但该 Invocation 只加载了状态、Git 与记忆 Skill；浏览器 Skill 未进入上下文，WorkContract 也没有声明浏览器验证能力。Agent 完成实现和命令验证后才发现 Chromium 启动被权限策略拒绝，最终只能报告阻塞。

这不是单条提示词缺失，而是派工契约自相矛盾：验收条件要求能力 A，执行配置却没有激活或授权能力 A。同时“Agent 绑定即全部激活”会把无关 Skill 正文塞进 Prompt，降低规则信噪比。

## 3. 设计原则

- 参考 Clowder 的 L0 + SOP stage + hard predicate 分层，但只学习机制，不复制文案或产品标识。
- 自由文本 instructions 不承担机械权限；可校验职责与规则必须进入 Agent Definition 的结构化字段或 admission predicate。
- `DispatchAdmission` 是触发能否进入规划、执行、评审或验证的唯一准入 seam；`ExecutionProfileResolver.resolve()` 只在准入结果内决定阶段所需的 Skill、能力与退出策略，不能把 planning grant 重新升级为 implement。
- eligible 与 activated 分离；未激活 Skill 不进入 Prompt，也不暴露其工具。
- 明确点名、Task/场景强信号优先；语义向量路由仍不在本期。
- Web E2E 需要真实浏览器时，平台授予受限的本地浏览器验证命令；不得因普通验证请求升级给用户。
- outcome recovery 保持最小能力，只允许结果收口。

## 4. 核心契约

```ts
interface ExecutionProfile {
  stage: 'plan' | 'implement' | 'review' | 'verify' | 'recover' | 'close';
  eligibleSkillIds: string[];
  activatedSkills: Array<{ skillId: string; reason: SkillActivationReason }>;
  requiredSkillIds: string[];
  capabilities: Array<'task_receipt' | 'browser_verification' | 'git_collaboration'>;
  exitPolicy: 'structured_outcome' | 'gate_decision' | 'outcome_recovery';
}
```

解析输入只使用服务端事实：`DispatchAdmissionGrant`、`AgentActivationCommand`、当前 Task、DeliveryRun policy 与 Agent 已绑定 Skill。浏览器传来的 Skill 列表、能力或阶段不具权威性；通用 A2A 指令也不能自行选择 implement 阶段。

## 5. 激活规则

- task-bound work：由 WorkContract 自身声明 `task_receipt` capability；不激活遗留的 `task-status-receipt`，也不暴露 `task_update_status`。
- planning：通过 `propose_task_graph` Outcome 提交任务图；不激活会引导直接写 Task 的遗留 `task-management`。
- review gate / code review：激活 `code-review`；存在 Git 合并策略时激活 `git-collaboration`。
- Delivery policy 要求 Web E2E，或 Task/指令明确包含浏览器、Playwright、Web E2E 强信号：激活并要求 `browser-verification`，声明 `browser_verification` capability。普通 verification/test gate 可以使用自动测试或人工审查，不被误升格为浏览器验证。
- prompt 中 `$skill-name`：精确激活并要求同名已绑定 Skill；未知或未绑定时 fail closed。
- 未纳入平台已知路由的自定义 Skill 暂保持绑定即激活，避免本期破坏既有用户配置。
- outcome recovery：不激活普通 Skill。

## 6. 权限

WorkContract 持久化 `executionProfile`。只有包含 `browser_verification` capability 且 authority 仍有效的 WorkContract，ACP 权限策略才允许受限的本地 Playwright 命令：项目脚本 `test/e2e` 或直接 `npx/pnpm exec playwright test`。任意 shell 拼接、后台进程、外部发布与通用 `node -e` 继续拒绝。

无论 Skill config 声明什么工具，WorkContract issuance 与 MCP grant 都统一裁掉 `task_create`、`task_update_status`、`task_assign`、`collaboration_record_pr/review/merge`。浏览器产物服务由 `browser-verification` Skill 独立提供；任务状态、Task Graph receipt 与 Gate 只由 accepted Outcome 后的 owner 更新。

## 7. 观测

ContextReport 必须同时展示 eligible、activated、loaded 与 activation reason。未激活 Skill 以 `not_activated_for_execution_profile` 记录，token 为 0。WorkContract instruction 展示阶段、能力与唯一出口，不重复角色人格或工具调用过程。

## 8. 退出条件

- `ExecutionProfileResolver` 通过外部 interface 覆盖阶段、强信号、显式 Skill、兼容 Skill 与 recovery 测试。
- SkillRuntime 能区分 eligible 与 activated，并对 required 未激活 fail closed。
- 浏览器验证 Skill 作为 preset 安装并绑定到内建执行/质量角色。
- Web E2E WorkContract 自动获得受限浏览器验证能力；普通任务不能获得。
- 现网同形态任务不再加载无关 Git Skill，并不会因本地浏览器验证权限请求升级给用户。
- 设计文档、测试、类型检查与构建保持一致。
