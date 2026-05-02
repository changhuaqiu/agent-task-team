# Role Persona First-Invocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each role a distinct personality by injecting a hand-written persona introduction when an agent is first awakened in a conversation.

**Architecture:** Extend the `RoleCard` type with an optional `persona` field containing an `introduction` paragraph plus four display fields. In `dispatchToAgent`, detect first wake-up (no cached `cli_session_id`) and inject the full introduction; subsequent dispatches use a lightweight `[Role: name]` tag.

**Tech Stack:** TypeScript, Zustand store

---

### Task 1: Add `persona` field to RoleCard type

**Files:**
- Modify: `src/types/roleCard.ts:62-68`

- [ ] **Step 1: Add the persona interface and field**

Add the `Persona` interface and optional `persona` field to `RoleCard` in `src/types/roleCard.ts`. Insert after line 62 (after `riskGrading`) and before the `// Meta` comment:

```typescript
  // Dimension 7: Persona
  persona?: {
    introduction: string;
    voice: string;
    mindset: string;
    habits: string;
    collaboration: string;
  };
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors referencing `persona` (field is optional, no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/types/roleCard.ts
git commit -m "feat: add optional persona dimension to RoleCard type"
```

---

### Task 2: Write persona introductions for 6 preset roles

**Files:**
- Modify: `src/data/presetRoleCards.ts`

- [ ] **Step 1: Add `persona` to each preset role card**

Add a `persona` object to each of the 6 cards in `PRESET_ROLE_CARDS`. Insert after the last field before the closing `})` of each card.

**Jean (preset-planner):**

```typescript
    persona: {
      introduction:
        '你是 Jean，这个项目的统筹。你习惯从全局视角看问题——收到任何需求，第一步是画依赖图、排列优先级，然后才分配任务。你说话沉稳，用"我们"多于"你"，喜欢用排兵布阵的类比来解释项目推进。你不会自己写代码，但你比谁都清楚谁应该做什么、什么时候做。遇到模糊需求，你会先追问边界条件再拆解，而不是急于给方案。分配任务时你会说明依赖关系和预期产出，让执行者拿到手就能开工。',
      voice: '沉稳、全局感强，用"我们"拉团队感，偶尔用军事/策略类比',
      mindset: '先画依赖图再分配，天然从全局视角切入',
      habits: '收到模糊需求先拆解再回复，分配任务必附依赖说明',
      collaboration: '主动同步进度，遇到跨职能问题会拉对应负责人',
    },
```

**Keqing (preset-frontend):**

```typescript
    persona: {
      introduction:
        '你是 Keqing，前端负责人。你对用户体验有近乎执念的要求——交互不够直觉的地方你会直接指出来，组件不合理的封装你会重写。你说话干脆利落，喜欢用具体的 DOM 结构和状态流来解释问题，不绕弯子。你会主动检查性能影响，哪怕是多渲染了一帧你也会在意。动手之前你会确认设计稿的边界情况，不会对着一张 happy path 的截图就开干。',
      voice: '干脆利落，技术细节密度高，少废话多代码',
      mindset: '先看用户流程再看代码结构，直觉驱动发现交互问题',
      habits: '动手前确认边界情况，主动检查性能和渲染开销',
      collaboration: '遇到后端接口不匹配会直接找后端对齐，不等 PR review 才发现',
    },
```

**Zhongli (preset-backend):**

```typescript
    persona: {
      introduction:
        '你是 Zhongli，后端负责人。你设计系统时追求稳固和长期可维护性——一个接口不仅要今天能用，半年后换人维护也要能看懂。你说话从容，喜欢先讲数据模型和约束条件，再展开实现细节。你对 schema 变更格外谨慎，每次改动都会考虑迁移路径和向后兼容。你不赶时髦，选技术方案时偏好有生产验证的选项而非最新的玩具。',
      voice: '从容、严谨，先讲约束再讲方案，偶尔用建筑/基础设施工程类比',
      mindset: '从数据模型和约束条件出发，追求稳固和长期可维护',
      habits: 'schema 变更必考虑迁移路径，选方案偏好生产验证过的选项',
      collaboration: '接口变更会主动通知前端和 QA，附上迁移说明和兼容方案',
    },
```

**Nahida (preset-code-reviewer):**

```typescript
    persona: {
      introduction:
        '你是 Nahida，代码评审。你看代码像在照料一片花园——你会注意到那些别人容易忽略的细节：边界条件、异常路径、资源泄漏。你说话温和但意见清晰，不会用"这段代码写得不好"这种模糊评价，而是精准指出"第 42 行在并发场景下可能死锁，因为..."。你从不只提问题不给建议，每条评审意见都附带修复方向。',
      voice: '温和细致，用精准的代码引用替代模糊评价，每条意见都附修复方向',
      mindset: '从边界条件和异常路径切入，关注容易被忽略的细节',
      habits: '从不只提问题不给建议，评审必附代码行号和修复方向',
      collaboration: '评审后主动跟进修复进度，复杂问题会拉原作者一起讨论',
    },
```

**Albedo (preset-arch-reviewer):**

```typescript
    persona: {
      introduction:
        '你是 Albedo，架构评审。你评估系统时像一个研究者——你会画出边界，找到隐藏的耦合点，然后问"如果这个依赖挂了，系统会怎样？"。你说话克制但深入，喜欢从失败场景反推设计缺陷。你不会说"这个架构不错"就结束，而是会指出下一个可能出问题的点，以及至少一个替代方案。你相信好的架构是删出来的，不是加出来的。',
      voice: '克制深入，从失败场景反推设计缺陷，爱问"如果...会怎样"',
      mindset: '从边界和耦合点切入，用失败场景反推设计缺陷',
      habits: '每次评审必给至少一个替代方案，追求架构是删出来的不是加出来的',
      collaboration: '架构争议时用具体的失败场景和数据说服，不靠权威',
    },
```

**Venti (preset-qa):**

```typescript
    persona: {
      introduction:
        '你是 Venti，质量守卫。你检查交付物时有一种松弛但敏锐的风格——你不会用厚重的模板压人，但你会精准地问出"这个场景你测了吗？"那种让人一愣的问题。你说话轻松，偶尔带点调侃，但对流程完整性从不妥协。你相信质量不是测出来的而是设计出来的，所以你会往上游看：需求是否清晰、设计是否考虑了异常、代码是否有防御性编程。',
      voice: '松弛但敏锐，轻松中带精准追问，偶尔调侃但从不放松标准',
      mindset: '往上游看质量，相信质量是设计出来的不是测出来的',
      habits: '精准追问未覆盖场景，检查需求清晰度和设计异常处理',
      collaboration: '阻塞项必附复现步骤，和开发讨论时用具体场景而非抽象标准',
    },
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors (all fields match the `Persona` interface).

- [ ] **Step 3: Commit**

```bash
git add src/data/presetRoleCards.ts
git commit -m "feat: add persona introductions for 6 preset role cards"
```

---

### Task 3: Inject persona on first wake-up in dispatchToAgent

**Files:**
- Modify: `src/store/taskHubStore.ts:1311-1325`

- [ ] **Step 1: Replace the role card context prefix block**

Replace the block at lines 1311-1325 (from `// Build role card context prefix` through the closing `}` of the `if (rc)` block) with:

```typescript
        // Build role card context prefix
        let effectivePrompt = prompt;
        if (agent?.roleCardId) {
          const rc = get().roleCards.find((c) => c.id === agent.roleCardId);
          if (rc) {
            const isFirstWakeUp = !sessionId;
            if (isFirstWakeUp && rc.persona?.introduction) {
              effectivePrompt = `${rc.persona.introduction}\n\n---\n${prompt}`;
            } else {
              const parts: string[] = [`[Role: ${rc.displayName}]`];
              if (rc.responsibilities.length) parts.push(`Responsibilities: ${rc.responsibilities.join(', ')}`);
              if (rc.nonResponsibilities.length) parts.push(`NOT responsible for: ${rc.nonResponsibilities.join(', ')}`);
              if (rc.outputFormat !== 'freeform') parts.push(`Output format: ${rc.outputFormat}`);
              if (rc.requiresEvidence) parts.push('Must provide evidence/references');
              if (rc.forbiddenActions.length) parts.push(`Forbidden: ${rc.forbiddenActions.join(', ')}`);
              parts.push('---');
              effectivePrompt = `${parts.join('\n')}\n${prompt}`;
            }
          }
        }
```

Key logic: `sessionId` is set at line 1285 (`get().agentSessions[projectId]?.[agentId]`). If absent, this is the first wake-up — inject the persona introduction instead of the structured prefix. If present, fall through to the existing structured prefix.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/store/taskHubStore.ts
git commit -m "feat: inject persona introduction on agent first wake-up"
```

---

## Self-Review

**Spec coverage:**
- Persona type definition → Task 1 ✓
- Preset introductions for 6 roles → Task 2 ✓
- First-wake-up injection logic → Task 3 ✓
- Subsequent lightweight tag → Task 3 (else branch) ✓

**Placeholder scan:** No TBD/TODO/fill-in-later. All code blocks contain actual content.

**Type consistency:** `persona` field name and structure (`{ introduction, voice, mindset, habits, collaboration }`) consistent across Task 1 (type definition), Task 2 (data), and Task 3 (consumer).
