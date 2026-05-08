# Team Runtime Contract Spec

**Status:** Active
**Date:** 2026-05-07
**Related docs:**
- `docs/wiki/01-architecture.md`
- `docs/wiki/03-store-model.md`
- `docs/wiki/04-backend-daemon.md`
- `docs/product/business/2026-05-01-engineering-role-card-business-plan.md`
- `docs/product/business/2026-05-05-role-card-ecosystem-analysis.md`
- `specs/team-role-card-compatibility/spec.md`
- `specs/role-card-format/spec.md`
- `specs/a2a-v2/README.md`

## Problem

Agent Task Hub 的产品方向已经从“多 CLI 可执行”演进为“用户领养一支可协作、可治理、可成长的 Agent 团队”。当前代码已经具备项目工作台、RoleCard、Skill、TeamPack、A2A、SQLite、Daemon 和多 backend 抽象，但这些能力仍由多个调用点各自拼装。

目前多个模块都在回答同一个问题：当前项目里的某个 agent 或 team role 到底是谁、绑定哪些账号、有哪些 skill、使用哪个 role card、能不能和另一个角色通信、应该走哪个 runtime。这些答案分散在 Zustand store、`AGENT_ROSTER`、TeamPack role、PromptComposer、Daemon dispatch、Skill hydration、AgentBindingPanel 和 A2A 逻辑中。

这种分散会造成几个系统性问题：

- TeamPack 角色在 UI、Prompt、Dispatch、Skill、A2A 中可能语义不一致。
- 新增团队能力时，需要同时修改 store、PromptComposer、Daemon、API、UI，漂移风险高。
- `TeamModeEngine` 和 TeamPack workflow 已经存在，但还没有成为主执行链路的事实源。
- `/api/state` 和部分前端逻辑仍假设固定六个 preset agent，无法自然承接动态团队。
- A2A 目标识别与 TeamPack communication matrix 之间缺少统一策略层。

## Goal

建立一个 Team Runtime Contract，作为项目级团队运行时的唯一领域契约。它负责把 Conversation、TeamPack、RoleCard、Account、Skill、Agent roster、workflow 和 communication matrix 解析成可被 UI、Prompt、Dispatch、A2A 和 Daemon 使用的统一运行时结构。

完成后，系统应该从“多个模块各自理解团队”变为“所有模块通过 Team Runtime 读取当前项目团队事实”。

## Non-Goals

- 不在本阶段重写整个 Zustand store。
- 不在本阶段重写 Daemon backend 抽象。
- 不在本阶段实现完整独立配置中心页面。
- 不在本阶段实现 Provider Profiles、Channels、Routing Policy 的完整数据模型。
- 不在本阶段建设 TeamPack marketplace 或 registry。
- 不在本阶段改变 TeamPack 项目绑定的生命周期规则。

## Core Contract

### TeamRuntime

`TeamRuntime` 表示某个 conversation 下当前有效的团队运行时。

```typescript
interface TeamRuntime {
  conversationId: string;
  teamPack?: TeamPack;
  roster: RuntimeAgent[];
  communicationPolicy: CommunicationPolicy;
  workflowPolicy: WorkflowPolicy;
}
```

规则：

- 如果 conversation 绑定了 `teamPackId`，runtime roster 必须以 TeamPack roles 为第一事实源。
- 如果 conversation 没有绑定 TeamPack，runtime roster 使用 preset `AGENT_ROSTER`。
- Runtime 不直接持久化为数据库主表；它由现有持久化对象解析得到。
- Runtime 可以被前端 store 缓存，但 store 不是 runtime 事实源。

### RuntimeAgent

`RuntimeAgent` 表示当前项目中可展示、可绑定、可派发、可注入 prompt 的 agent-like identity。

```typescript
type RuntimeAgentSource = 'preset-agent' | 'team-pack-role';

interface RuntimeAgent {
  id: string;
  displayName: string;
  source: RuntimeAgentSource;
  roleCardId?: string;
  roleCard?: RoleCard;
  accountIds: string[];
  skills: SkillSummary[];
  cliEngine?: CliEngine;
  emoji?: string;
  theme?: AgentTheme;
  canModifyCode?: boolean;
  canReview?: boolean;
}
```

Resolution rules:

1. Preset agents use `AGENT_ROSTER` as identity seed.
2. TeamPack roles use `TeamPack.roles[]` as identity seed.
3. RoleCard override wins over default `roleCardId`.
4. If a RoleCard exists and has account bindings, those bindings win.
5. Otherwise TeamPack role `accountIds` win.
6. Otherwise agent-level account overrides win.
7. Otherwise preset agent `accountIds` are used.
8. Skills are resolved from agent skill bindings plus TeamPack role `skillIds`, with duplicates removed.
9. Missing RoleCard is allowed; runtime must still produce a dispatchable identity when account resolution succeeds.

### RuntimeAgentProfile

`RuntimeAgentProfile` is the single profile used by dispatch and prompt composition.

```typescript
interface RuntimeAgentProfile {
  agent: RuntimeAgent;
  execution: {
    engine: CliEngine;
    accountId?: string;
    runtimeId?: string;
  };
  prompt: {
    roleCard?: RoleCard;
    skills: SkillSummary[];
    teamPack?: TeamPack;
    roster: RuntimeAgent[];
  };
}
```

Rules:

- Dispatch must resolve `RuntimeAgentProfile` before emitting `terminal:start`.
- PromptComposer must receive runtime roster and runtime profile instead of importing static `AGENT_ROSTER`.
- If no enabled account or CLI fallback can be resolved, dispatch must fail with a user-facing no-account state rather than silently falling back to the wrong agent.

## Policies

### CommunicationPolicy

Communication policy answers whether one runtime agent can dispatch or mention another runtime agent.

```typescript
interface CommunicationPolicy {
  canSend(fromAgentId: string, toAgentId: string): boolean;
  explainBlock(fromAgentId: string, toAgentId: string): string | undefined;
}
```

Rules:

- If TeamPack has a `communicationMatrix`, A2A dispatch must enforce it.
- If no TeamPack is bound, preset agents may communicate using the existing default behavior.
- Blocked A2A messages must be recorded as audit/debug events and must not be delivered to the target agent.
- User-visible UX should describe this as “团队协作规则阻止了这次转交”, not expose internal terms such as routing or matrix.

### WorkflowPolicy

Workflow policy wraps TeamModeEngine and provides task assignment decisions.

```typescript
interface WorkflowPolicy {
  assignInitialTask(task: Task): TaskAssignment | null;
  getNextAgent(currentAgentId: string, taskResult: unknown): string | null;
}
```

Rules:

- If TeamPack is bound, task assignment should use TeamPack `teamMode` and workflow.
- If no TeamPack is bound, existing manual or advisor-based assignment remains valid.
- Pipeline, parallel, hub_spoke and custom modes must be supported through a single policy interface.
- This spec does not require full automatic workflow execution in the first implementation step; it requires the policy to be wired into at least one real dispatch or A2A decision path.

## Architecture

Add a new domain layer:

```text
Product Workspace UI
  ↓
TaskHub Store / UI Runtime Cache
  ↓
Team Runtime Contract
  ↓
Repositories / SQLite / Account / RoleCard / Skill / TeamPack
  ↓
Daemon / Agent Backend / CLI
```

The new layer should live under:

```text
src/lib/team-runtime/
  types.ts
  resolveTeamRuntime.ts
  resolveRuntimeAgentProfile.ts
  resolveCommunicationPolicy.ts
  resolveWorkflowPolicy.ts
  index.ts
```

Responsibilities:

- `types.ts`: shared runtime contract types.
- `resolveTeamRuntime.ts`: builds `TeamRuntime` for a conversation.
- `resolveRuntimeAgentProfile.ts`: resolves a single agent profile for dispatch and prompt.
- `resolveCommunicationPolicy.ts`: enforces TeamPack communication rules.
- `resolveWorkflowPolicy.ts`: wraps TeamModeEngine behind a stable policy API.
- `index.ts`: public exports.

## Data Flow

### Dispatch Flow

```text
User message or task trigger
  ↓
dispatchToAgent(agentId, conversationId)
  ↓
resolveRuntimeAgentProfile(conversationId, agentId)
  ↓
compose prompts with RuntimeAgentProfile
  ↓
socket.emit('terminal:start', {
  agentId,
  conversationId,
  accountId,
  engine,
  runtimeId,
  prompt,
  systemPrompt
})
  ↓
Daemon executes parsed profile
  ↓
Events update message, invocation, task, and UI state
```

### A2A Flow

```text
Agent output contains @target
  ↓
A2A scanner identifies target runtime agent
  ↓
TeamRuntime.communicationPolicy.canSend(from, target)
  ↓
Allowed: enqueue worklist / dispatch
Blocked: record audit event and do not deliver
```

### Prompt Flow

```text
resolveRuntimeAgentProfile()
  ↓
PromptComposer receives roleCard, skills, teamPack, runtime roster
  ↓
TeamLayer and TeamPackLayer describe the same active team
```

## Required Integration Changes

### Store

- Store may cache runtime results, but must not own runtime resolution rules.
- Existing `getEffectiveRoster()` and `getAgentRuntimeProfile()` style helpers should delegate to `team-runtime`.
- `dispatchToAgent()` must resolve `RuntimeAgentProfile` before dispatch.

### PromptComposer

- Remove direct dependency on static `AGENT_ROSTER` for team roster generation.
- Accept runtime roster through compose options.
- Keep RoleLayer, ProjectLayer, SkillLayer, ToolLayer, TeamLayer, TeamPackLayer, ProtocolLayer, HistoryLayer, TaskContextLayer, A2ALayer, UserMessageLayer and BehaviorLayer responsibilities unchanged.

### API State

- `/api/state` must stop assuming only preset agent IDs for skill hydration.
- It should return enough data for the client to resolve runtime rosters, or return precomputed runtime summaries per conversation.
- The first implementation may return all `agentSkillIds` from persistence rather than hardcoding six IDs.

### A2A

- A2A target resolution must use runtime roster.
- Communication checks must use `CommunicationPolicy`.
- Production daemon must inject a server-side runtime provider into `AgentMessenger`; the provider resolves `conversation.team_pack_id` with `teamPackRepo.getById()` and `resolveTeamRuntime()` instead of importing UI stores.
- A2A only requires roster ids/display names and policy, so the server provider may resolve runtime with empty RoleCard, Skill and override maps. TeamPack conversations use TeamPack role ids as active agents; preset conversations use DB agent ids.
- Runtime mention patterns include `@${agent.id}` and `@${agent.displayName}` when the display name is non-empty and differs from the id.
- Policy checks must run before breadth and dedup checks for agent-originated dispatches so TeamPack rule blocks are not masked by chain limits.
- Blocked communication must be auditable.

### TeamModeEngine

- `TeamModeEngine` should remain strategy-focused.
- Consumers should call it through `WorkflowPolicy`, not directly from UI components.

### Task Assignment

- Server-side task creation resolves initial assignees through `src/server/team-runtime/task-assignment.ts`.
- `task.create` uses `WorkflowPolicy.assignInitialTask()` when no explicit `agent_id` is supplied and the conversation is bound to a TeamPack.
- `tool.invoke` `task_create` uses the same helper and writes the selected agent to both SQLite and `TASKS.md`.
- Explicit `agent_id` values from user or tool input are preserved and are not overridden by TeamPack workflow policy.
- If no explicit, workflow, runtime roster, or caller fallback assignee can be resolved, the API must fail clearly before persistence instead of storing an empty `agent_id`.
- Server assignment resolution reads repositories and `src/lib/team-runtime`; it must not import frontend stores.

### Daemon

- Daemon receives already-resolved execution context.
- Daemon should not interpret TeamPack workflow or communication rules.
- Daemon remains responsible for process execution, session tracking, invocation tracking, credential injection, timeout, backend selection and event forwarding.

## User Experience Requirements

- UI labels should use user-facing terms: `团队`, `角色`, `账号`, `技能`, `协作规则`.
- Primary UX must not expose implementation terms such as `runtime`, `channel`, `routing`, `bridge`, `providerHints`, `session`.
- For account/configuration flows, do not duplicate choices in both page body and modal.
- TeamPack roles should behave like normal roles in the binding panel.
- If a collaboration is blocked by communication policy, explain it as a team rule outcome.

## Testing Requirements

Add focused tests for:

- Resolving preset agent runtime.
- Resolving TeamPack role runtime.
- RoleCard override precedence.
- Account resolution precedence.
- Skill resolution for preset and TeamPack roles.
- PromptComposer receives runtime roster and no longer depends on static roster.
- `/api/state` no longer hardcodes only preset agent skill IDs.
- A2A communication policy allows and blocks based on TeamPack matrix.
- Workflow policy delegates to TeamModeEngine for at least one team mode.
- Dispatch uses `RuntimeAgentProfile` for TeamPack roles.

## Acceptance Criteria

- A project bound to `engineering-trio` resolves `planner`, `coder`, and `reviewer` as runtime agents.
- The same runtime agents are used by AgentBar, AgentBindingPanel, PromptComposer, dispatch, skill hydration and A2A.
- Dispatch to a TeamPack role sends the selected account and engine to daemon.
- PromptComposer does not import `AGENT_ROSTER` to build team roster.
- `/api/state` does not hardcode the six preset IDs as the only skill hydration targets.
- A2A dispatch respects TeamPack communication rules.
- TeamModeEngine is connected through WorkflowPolicy to a real decision path.
- Documentation explains Team Runtime Contract as the project-level collaboration kernel.
