# Role Persona First-Invocation Design

## Problem

When a user first @mentions a role (e.g., `@jean`) in a project, the prompt prefix is bare-bones — just a role label, responsibilities list, and output format. Every role sounds the same: cold and templated. The goal is to give each role a distinct voice and personality from the very first message.

## Decision

Inject a hand-written persona introduction when an agent is **first awakened** in a conversation (no cached `cli_session_id`). Subsequent messages use a lightweight `[Role: name]` tag, relying on the CLI's `--resume` mechanism for style continuity.

## Persona Dimensions

Each role has four personality dimensions (for UI display) and one `introduction` paragraph (for prompt injection):

| Dimension | Purpose |
|-----------|---------|
| `voice` | Speaking style, tone, verbal habits |
| `mindset` | How the role approaches problems |
| `habits` | Automatic behavioral tendencies |
| `collaboration` | How the role works with others |
| `introduction` | Hand-crafted paragraph covering all four, injected into prompt |

## Data Model

Extend `RoleCard` in `src/types/roleCard.ts`:

```typescript
persona?: {
  introduction: string;  // Full persona paragraph, injected on first wake-up
  voice: string;         // For UI display
  mindset: string;       // For UI display
  habits: string;        // For UI display
  collaboration: string; // For UI display
}
```

The field is optional — roles without a persona fall back to the current behavior.

## Injection Logic

In `src/store/taskHubStore.ts`, `dispatchToAgent`:

```
if (!hasCachedCliSessionId(agentId, projectId) && rc.persona?.introduction) {
  // First wake-up: inject full persona
  effectivePrompt = `${rc.persona.introduction}\n\n---\n${effectivePrompt}`;
} else {
  // Subsequent: lightweight tag
  effectivePrompt = `[Role: ${rc.displayName}]\n${effectivePrompt}`;
}
```

Detection: check whether `agentSessions[projectId][agentId]` has a cached `cli_session_id`. Absent = first wake-up.

## Preset Introductions

Six roles, each ~80-120 Chinese characters. Example for Jean (planner):

> 你是 Jean，这个项目的统筹。你习惯从全局视角看问题——收到任何需求，第一步是画依赖图、排列优先级，然后才分配任务。你说话沉稳，用"我们"多于"你"，喜欢用排兵布阵的类比来解释项目推进。你不会自己写代码，但你比谁都清楚谁应该做什么、什么时候做。遇到模糊需求，你会先追问边界条件再拆解，而不是急于给方案。分配任务时你会说明依赖关系和预期产出，让执行者拿到手就能开工。

## Files Changed

| File | Change |
|------|--------|
| `src/types/roleCard.ts` | Add optional `persona` field |
| `src/data/presetRoleCards.ts` | Add `persona.introduction` + display fields for 6 preset roles |
| `src/store/taskHubStore.ts` | Add first-wake-up / subsequent branch in `dispatchToAgent` |

No daemon, schema, or session-repo changes — purely client-side prompt construction.

## Style Target

"鲜明人格型" — each role reads like a seasoned colleague with a clear perspective. Users should occasionally feel "this is Jean speaking," not full role-play.
