# Mario Theme Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all Genshin Impact theming (agent names, IDs, CSS variables, pixel art, persona voice) with Super Mario Bros characters.

**Architecture:** Full rename of 6 agent IDs from `jean/keqing/zhongli/nahida/albedo/venti` to `mario/luigi/toad/peach/dk/yoshi`. All layers (types → CSS → data → components → server → tests) update in lockstep. No backward compatibility layer.

**Tech Stack:** TypeScript, Tailwind CSS (HSL variables), React components, Socket.io routing, Vitest

---

## File Structure

| Operation | File | Responsibility |
|-----------|------|----------------|
| Modify | `src/store/taskHubStore.ts` | AgentTheme type, AGENT_ROSTER, defaults, prompt templates |
| Modify | `src/app/globals.css` | 30 CSS variables (agent colors) |
| Modify | `src/data/presetRoleCards.ts` | 6 persona introductions |
| Modify | `src/components/task-hub/PixelAvatar.tsx` | 6 pixel grids + palettes |
| Modify | `src/components/task-hub/TaskCard.tsx` | themeAccent map (6 entries) |
| Modify | `src/components/task-hub/AgentTaskGroup.tsx` | themeStyles map (36 CSS classes) |
| Modify | `src/components/role-card/RoleCardBadge.tsx` | CATEGORY_CONFIG (6 entries) |
| Modify | `src/components/task-hub/GlobalChatRoom.tsx` | AGENT_META (6 entries) + hint text |
| Modify | `src/components/project/ProjectCreateDialog.tsx` | hardcoded "Jean" text |
| Modify | `src/components/project/ProjectChatPanel.tsx` | hardcoded "Jean" text (2 places) |
| Modify | `src/components/chat/ChatHubView.tsx` | hardcoded "@jean" text |
| Modify | `src/components/war-room/TimelineCards.tsx` | hardcoded agentId values (4 places) |
| Modify | `src/server/routing/mention-parser.ts` | AGENT_IDS array |
| Modify | `src/server/routing/routing.test.ts` | test fixtures |
| Modify | `src/__tests__/store/chat-message-extensions.test.ts` | test fixtures |
| Modify | `src/__tests__/store/account-binding.test.ts` | test fixtures |
| Modify | `src/lib/breakdownParser.test.ts` | test fixtures |

---

### Task 1: Core Types + CSS Variables

**Files:**
- Modify: `src/store/taskHubStore.ts:112`
- Modify: `src/app/globals.css:28-87, 150-161`

- [ ] **Step 1: Update AgentTheme type in store**

In `src/store/taskHubStore.ts` line 112, change:

```ts
// FROM:
export type AgentTheme = 'jean' | 'keqing' | 'zhongli' | 'nahida' | 'albedo' | 'venti';
// TO:
export type AgentTheme = 'mario' | 'luigi' | 'toad' | 'peach' | 'dk' | 'yoshi';
```

- [ ] **Step 2: Update CSS agent variables in globals.css (light mode)**

Replace lines 28-62 in `src/app/globals.css` (the `:root` block agent section):

```css
  /* --- Agent Identity Colors (Mario Universe) --- */
  /* Mario — Red ⭐ */
  --agent-mario:          0 72% 51%;
  --agent-mario-soft:     0 60% 95%;
  --agent-mario-border:   0 65% 78%;

  /* Luigi — Green ⚡ */
  --agent-luigi:        130 60% 40%;
  --agent-luigi-soft:   130 40% 93%;
  --agent-luigi-border: 130 50% 75%;

  /* Toad — White-Red 🛡️ */
  --agent-toad:       25 20% 85%;
  --agent-toad-soft:  0 60% 95%;
  --agent-toad-border:0 65% 80%;

  /* Peach — Pink-Gold 🌸 */
  --agent-peach:        330 70% 60%;
  --agent-peach-soft:   330 50% 94%;
  --agent-peach-border: 330 55% 80%;

  /* Donkey Kong — Brown-Red ⚙️ */
  --agent-dk:        25 70% 35%;
  --agent-dk-soft:   25 50% 93%;
  --agent-dk-border: 25 60% 75%;

  /* Yoshi — Green-Orange 🎵 */
  --agent-yoshi:         100 60% 50%;
  --agent-yoshi-soft:    100 40% 93%;
  --agent-yoshi-border:  100 50% 75%;

  /* Owner — Player (Blue) */
  --agent-owner:         200 60% 60%;
  --agent-owner-soft:    200 50% 94%;
  --agent-owner-border:  200 45% 80%;
```

- [ ] **Step 3: Update CSS agent variables in globals.css (dark mode)**

Replace lines 150-161 in `src/app/globals.css` (the `.dark` block agent overrides):

```css
    --agent-mario-soft:     0 40% 15%;
    --agent-mario-border:   0 40% 25%;
    --agent-luigi-soft:   130 30% 15%;
    --agent-luigi-border: 130 30% 25%;
    --agent-toad-soft:  25 20% 18%;
    --agent-toad-border:0 40% 25%;
    --agent-peach-soft:   330 30% 18%;
    --agent-peach-border: 330 30% 28%;
    --agent-dk-soft:   25 40% 15%;
    --agent-dk-border: 25 40% 25%;
    --agent-yoshi-soft:    100 30% 15%;
    --agent-yoshi-border:  100 30% 25%;
    --agent-owner-soft:    200 30% 15%;
    --agent-owner-border:  200 30% 25%;
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Errors in PixelAvatar.tsx and component theme maps (because old theme names no longer match the type). This is expected — we fix them in subsequent tasks.

- [ ] **Step 5: Commit**

```bash
git add src/store/taskHubStore.ts src/app/globals.css
git commit -m "feat: update AgentTheme type and CSS variables from Genshin to Mario"
```

---

### Task 2: AGENT_ROSTER + Store Defaults

**Files:**
- Modify: `src/store/taskHubStore.ts:489-556, 854, 1221, 1262, 1830`

- [ ] **Step 1: Replace AGENT_ROSTER (lines 489-556)**

```ts
export const AGENT_ROSTER: Agent[] = [
  {
    id: 'mario',
    name: 'Mario',
    role: 'planner',
    roleLabel: '项目统筹',
    roleCardId: 'preset-planner',
    theme: 'mario',
    emoji: '⭐',
    isOnline: true,
    accountIds: [],
  },
  {
    id: 'luigi',
    name: 'Luigi',
    role: 'worker',
    roleLabel: '前端实现',
    roleCardId: 'preset-frontend',
    theme: 'luigi',
    emoji: '⚡',
    isOnline: true,
    accountIds: [],
  },
  {
    id: 'toad',
    name: 'Toad',
    role: 'worker',
    roleLabel: '后端开发',
    roleCardId: 'preset-backend',
    theme: 'toad',
    emoji: '🛡️',
    isOnline: false,
    accountIds: [],
  },
  {
    id: 'peach',
    name: 'Peach',
    role: 'reviewer',
    roleLabel: '代码评审',
    roleCardId: 'preset-code-reviewer',
    theme: 'peach',
    emoji: '🌸',
    isOnline: true,
    accountIds: [],
  },
  {
    id: 'dk',
    name: 'Donkey Kong',
    role: 'worker',
    roleLabel: '架构工程',
    roleCardId: 'preset-arch-reviewer',
    theme: 'dk',
    emoji: '⚙️',
    isOnline: false,
    accountIds: [],
  },
  {
    id: 'yoshi',
    name: 'Yoshi',
    role: 'reviewer',
    roleLabel: 'QA 测试',
    roleCardId: 'preset-qa',
    theme: 'yoshi',
    emoji: '🎵',
    isOnline: false,
    accountIds: [],
  },
];
```

- [ ] **Step 2: Update default activeAgentIds (line 854)**

```ts
// FROM:
activeAgentIds: ['jean', 'keqing'],
// TO:
activeAgentIds: ['mario', 'luigi'],
```

- [ ] **Step 3: Update triggerBreakdown prompt (line 1221)**

```ts
// FROM:
const prompt = `你是项目统筹 Jean。请将以下项目目标拆解为 2-4 个阶段。
// TO:
const prompt = `你是项目统筹 Mario。请将以下项目目标拆解为 2-4 个阶段。
```

- [ ] **Step 4: Update fallback agentId (line 1262)**

```ts
// FROM:
agentId: taskProp.agentId || 'jean',
// TO:
agentId: taskProp.agentId || 'mario',
```

- [ ] **Step 5: Update comment (line 1830)**

```ts
// FROM:
// Auto-trigger Jean breakdown for new projects
// TO:
// Auto-trigger Mario breakdown for new projects
```

- [ ] **Step 6: Commit**

```bash
git add src/store/taskHubStore.ts
git commit -m "feat: update AGENT_ROSTER and store defaults from Genshin to Mario"
```

---

### Task 3: Server Routing — Mention Parser

**Files:**
- Modify: `src/server/routing/mention-parser.ts:18`

- [ ] **Step 1: Update AGENT_IDS array (line 18)**

```ts
// FROM:
const AGENT_IDS = ['jean', 'keqing', 'zhongli', 'nahida', 'albedo', 'venti'] as const;
// TO:
const AGENT_IDS = ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi'] as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/server/routing/mention-parser.ts
git commit -m "feat: update mention parser agent IDs to Mario names"
```

---

### Task 4: Pixel Art — PixelAvatar

**Files:**
- Modify: `src/components/task-hub/PixelAvatar.tsx` (entire file)

- [ ] **Step 1: Replace PIXEL_GRIDS and PALETTES**

Replace the entire `PIXEL_GRIDS` object (lines 14-81) and `PALETTES` object (lines 84-121) with:

```ts
const PIXEL_GRIDS: Record<AgentTheme, number[][]> = {
  // Mario — Red cap with M badge
  mario: [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 4, 4, 1, 1, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 0, 2, 2, 2, 2, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 0, 3, 4, 4, 3, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 0, 3, 0, 0, 3, 0, 0],
  ],
  // Luigi — Green cap with L badge, taller
  luigi: [
    [0, 0, 0, 1, 1, 0, 0, 0],
    [0, 0, 1, 4, 4, 1, 0, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 0, 2, 2, 2, 2, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 0, 3, 4, 4, 3, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 0, 3, 0, 0, 3, 0, 0],
  ],
  // Toad — Mushroom dome, round face, blue vest
  toad: [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 4, 4, 1, 1, 0],
    [1, 1, 1, 1, 1, 1, 1, 1],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 0, 2, 2, 2, 2, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 0, 3, 3, 3, 3, 0, 0],
    [0, 0, 3, 0, 0, 3, 0, 0],
  ],
  // Peach — Gold crown, pink hair, pink dress
  peach: [
    [0, 0, 4, 4, 4, 4, 0, 0],
    [0, 0, 4, 4, 4, 4, 0, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 1, 4, 4, 1, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 1, 0, 0, 1, 0, 0],
  ],
  // Donkey Kong — Brown body, wide face, red tie
  dk: [
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 0, 2, 4, 4, 2, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 1, 4, 4, 1, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 3, 0, 0, 3, 0, 0],
  ],
  // Yoshi — Green body, white belly, orange shell ridge
  yoshi: [
    [0, 0, 0, 4, 4, 0, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 1, 1, 2, 2, 1, 1, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 0, 1, 3, 3, 1, 0, 0],
    [0, 0, 1, 3, 3, 1, 0, 0],
    [0, 0, 1, 1, 1, 1, 0, 0],
    [0, 0, 3, 0, 0, 3, 0, 0],
  ],
};

const PALETTES: Record<AgentTheme, Record<number, string>> = {
  mario: {
    1: 'hsl(0 72% 51%)',      // Red cap & overalls
    2: 'hsl(28 60% 72%)',     // skin
    3: 'hsl(220 70% 45%)',    // Blue overalls
    4: 'hsl(45 80% 55%)',     // M badge / buttons
  },
  luigi: {
    1: 'hsl(130 60% 40%)',    // Green cap
    2: 'hsl(28 60% 72%)',     // skin
    3: 'hsl(220 70% 45%)',    // Blue overalls
    4: 'hsl(45 80% 55%)',     // L badge / buttons
  },
  toad: {
    1: 'hsl(25 20% 92%)',     // White mushroom cap
    2: 'hsl(28 60% 72%)',     // skin
    3: 'hsl(220 60% 50%)',    // Blue vest
    4: 'hsl(0 65% 55%)',      // Red spots on cap
  },
  peach: {
    1: 'hsl(330 70% 75%)',    // Pink dress
    2: 'hsl(28 60% 72%)',     // skin
    3: 'hsl(330 50% 60%)',    // Darker pink details
    4: 'hsl(45 90% 55%)',     // Gold crown
  },
  dk: {
    1: 'hsl(25 70% 35%)',     // Brown body
    2: 'hsl(28 60% 72%)',     // skin (face)
    3: 'hsl(25 40% 25%)',     // Dark brown details
    4: 'hsl(0 65% 50%)',      // Red tie
  },
  yoshi: {
    1: 'hsl(100 60% 50%)',    // Green body
    2: 'hsl(28 60% 72%)',     // skin (face/belly)
    3: 'hsl(100 40% 80%)',    // Light green belly
    4: 'hsl(25 90% 55%)',     // Orange shell ridge
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/task-hub/PixelAvatar.tsx
git commit -m "feat: replace Genshin pixel art with Mario character sprites"
```

---

### Task 5: Preset Role Cards — Persona Introductions

**Files:**
- Modify: `src/data/presetRoleCards.ts:51, 77, 103, 130, 158, 185`

- [ ] **Step 1: Replace planner persona (line 51)**

```ts
introduction: '你是 Mario，这个项目的统筹。你虽然习惯亲自上阵，但更擅长指挥团队。你总能在复杂局面中找到最直接的路线，像在迷宫里找星星一样拆解问题。你用简短有力的指令协调团队，确保每个人都知道下一步该去哪根管道。你不会自己写代码，但你比谁都清楚谁应该做什么、什么时候做。遇到模糊需求，你会先追问边界条件再拆解，绝不贸然行动。',
voice: '直接、有力，用"走！"代替"请"，偶尔用管道和星星做比喻',
mindset: '先找到最短路线再行动，天然从全局视角切入',
habits: '收到模糊需求先追问边界再拆解，分配任务必附路径说明',
collaboration: '主动同步进度，遇到跨职能问题会直接拉对应负责人',
```

- [ ] **Step 2: Replace frontend persona (line 77)**

```ts
introduction: '你是 Luigi，前端负责人。你比任何人都注重细节和用户体验——毕竟你总是在 Mario 的光环下工作，所以你必须做得更精致。你对像素级的完美有执念，从交互到动画都不放过。遇到 bug 就像遇到幽灵，你绝不放过任何一个。动手之前你会确认设计稿的每个边界情况，不会对着 happy path 就开干。',
voice: '细致、认真，技术细节密度高，偶尔吐槽"这个交互有幽灵"',
mindset: '先看用户流程再看代码结构，直觉驱动发现交互问题',
habits: '动手前确认边界情况，主动检查性能和渲染开销',
collaboration: '遇到后端接口不匹配会直接找后端对齐，不等 PR review 才发现',
```

- [ ] **Step 3: Replace backend persona (line 103)**

```ts
introduction: '你是 Toad，后端开发负责人。你稳定可靠，是整个蘑菇王国基础设施的守护者。你设计的系统像城堡一样坚固——数据安全、接口清晰、服务高可用。你用务实的态度对待每一个技术选型，偏好经过生产验证的方案。你对 schema 变更格外谨慎，每次改动都会考虑迁移路径和向后兼容。',
voice: '稳重、务实，先讲约束再讲方案，偶尔用城堡和管道做比喻',
mindset: '从数据模型和约束条件出发，追求稳固和长期可维护',
habits: 'schema 变更必考虑迁移路径，选方案偏好生产验证过的选项',
collaboration: '接口变更会主动通知前端和 QA，附上迁移说明和兼容方案',
```

- [ ] **Step 4: Replace code reviewer persona (line 130)**

```ts
introduction: '你是 Peach，代码评审。你以温柔但严格的标准审查每一行代码——像治理王国一样追求秩序和优雅。你看重代码的可读性、可维护性，以及是否遵循了团队约定。你从不只提问题不给建议，每条评审意见都精准指出问题所在并附上修复方向。',
voice: '温柔但坚定，用精准的代码引用替代模糊评价，每条意见都附修复方向',
mindset: '从边界条件和异常路径切入，关注容易被忽略的细节',
habits: '从不只提问题不给建议，评审必附代码行号和修复方向',
collaboration: '评审后主动跟进修复进度，复杂问题会拉原作者一起讨论',
```

- [ ] **Step 5: Replace arch reviewer persona (line 158)**

```ts
introduction: '你是 Donkey Kong，架构评审。你用原始但敏锐的直觉评估系统设计——像审视自己领地一样检查架构的每个角落。你关注性能瓶颈、安全风险和可扩展性，不接受花架子。你不会说"这个架构不错"就结束，而是会指出下一个可能出问题的点，以及至少一个替代方案。你相信好的架构是删出来的，不是加出来的。',
voice: '粗犷但深入，从失败场景反推设计缺陷，爱问"如果...会怎样"',
mindset: '从边界和耦合点切入，用失败场景反推设计缺陷',
habits: '每次评审必给至少一个替代方案，追求架构是删出来的不是加出来的',
collaboration: '架构争议时用具体的失败场景和数据说服，不靠权威',
```

- [ ] **Step 6: Replace QA persona (line 185)**

```ts
introduction: '你是 Yoshi，质量守卫。你用灵活的测试策略捕捉每一个 bug——功能测试、边界测试、回归测试一个不落。你忠诚地守护着交付质量，确保没有 bug 能从你的眼皮底下溜走。你相信质量不是测出来的而是设计出来的，所以你会往上游看：需求是否清晰、设计是否考虑了异常、代码是否有防御性编程。',
voice: '灵活、忠诚，精准追问未覆盖场景，用具体例子而非抽象标准',
mindset: '往上游看质量，相信质量是设计出来的不是测出来的',
habits: '精准追问未覆盖场景，检查需求清晰度和设计异常处理',
collaboration: '阻塞项必附复现步骤，和开发讨论时用具体场景而非抽象标准',
```

- [ ] **Step 7: Commit**

```bash
git add src/data/presetRoleCards.ts
git commit -m "feat: rewrite role card personas from Genshin to Mario universe"
```

---

### Task 6: Component Theme Maps (3 files)

**Files:**
- Modify: `src/components/task-hub/TaskCard.tsx:27-34`
- Modify: `src/components/task-hub/AgentTaskGroup.tsx:16-65`
- Modify: `src/components/role-card/RoleCardBadge.tsx:6-12`

- [ ] **Step 1: Update TaskCard themeAccent**

Replace lines 27-34 in `src/components/task-hub/TaskCard.tsx`:

```ts
const themeAccent: Record<AgentTheme, string> = {
  mario:  'border-l-[hsl(var(--agent-mario))]',
  luigi:  'border-l-[hsl(var(--agent-luigi))]',
  toad:   'border-l-[hsl(var(--agent-toad))]',
  peach:  'border-l-[hsl(var(--agent-peach))]',
  dk:     'border-l-[hsl(var(--agent-dk))]',
  yoshi:  'border-l-[hsl(var(--agent-yoshi))]',
};
```

- [ ] **Step 2: Update AgentTaskGroup themeStyles**

Replace lines 16-65 in `src/components/task-hub/AgentTaskGroup.tsx`:

```ts
const themeStyles = {
  mario: {
    headerBg: 'bg-[hsl(var(--agent-mario-soft))]',
    headerBorder: 'border-[hsl(var(--agent-mario-border))]',
    avatarBg: 'bg-[hsl(var(--agent-mario))]',
    countBg: 'bg-[hsl(var(--agent-mario-soft))]',
    countText: 'text-[hsl(var(--agent-mario))]',
    countBorder: 'border-[hsl(var(--agent-mario-border))]',
  },
  luigi: {
    headerBg: 'bg-[hsl(var(--agent-luigi-soft))]',
    headerBorder: 'border-[hsl(var(--agent-luigi-border))]',
    avatarBg: 'bg-[hsl(var(--agent-luigi))]',
    countBg: 'bg-[hsl(var(--agent-luigi-soft))]',
    countText: 'text-[hsl(var(--agent-luigi))]',
    countBorder: 'border-[hsl(var(--agent-luigi-border))]',
  },
  toad: {
    headerBg: 'bg-[hsl(var(--agent-toad-soft))]',
    headerBorder: 'border-[hsl(var(--agent-toad-border))]',
    avatarBg: 'bg-[hsl(var(--agent-toad))]',
    countBg: 'bg-[hsl(var(--agent-toad-soft))]',
    countText: 'text-[hsl(var(--agent-toad))]',
    countBorder: 'border-[hsl(var(--agent-toad-border))]',
  },
  peach: {
    headerBg: 'bg-[hsl(var(--agent-peach-soft))]',
    headerBorder: 'border-[hsl(var(--agent-peach-border))]',
    avatarBg: 'bg-[hsl(var(--agent-peach))]',
    countBg: 'bg-[hsl(var(--agent-peach-soft))]',
    countText: 'text-[hsl(var(--agent-peach))]',
    countBorder: 'border-[hsl(var(--agent-peach-border))]',
  },
  dk: {
    headerBg: 'bg-[hsl(var(--agent-dk-soft))]',
    headerBorder: 'border-[hsl(var(--agent-dk-border))]',
    avatarBg: 'bg-[hsl(var(--agent-dk))]',
    countBg: 'bg-[hsl(var(--agent-dk-soft))]',
    countText: 'text-[hsl(var(--agent-dk))]',
    countBorder: 'border-[hsl(var(--agent-dk-border))]',
  },
  yoshi: {
    headerBg: 'bg-[hsl(var(--agent-yoshi-soft))]',
    headerBorder: 'border-[hsl(var(--agent-yoshi-border))]',
    avatarBg: 'bg-[hsl(var(--agent-yoshi))]',
    countBg: 'bg-[hsl(var(--agent-yoshi-soft))]',
    countText: 'text-[hsl(var(--agent-yoshi))]',
    countBorder: 'border-[hsl(var(--agent-yoshi-border))]',
  },
} as const;
```

- [ ] **Step 3: Update RoleCardBadge CATEGORY_CONFIG**

Replace lines 6-12 in `src/components/role-card/RoleCardBadge.tsx`:

```ts
const CATEGORY_CONFIG: Record<RoleCardCategory, { emoji: string; themeVar: string; label: string }> = {
  planner:       { emoji: '⭐', themeVar: '--agent-mario',  label: '规划' },
  frontend:      { emoji: '⚡', themeVar: '--agent-luigi',  label: '前端' },
  backend:       { emoji: '🛡️', themeVar: '--agent-toad',   label: '后端' },
  code_reviewer: { emoji: '🌸', themeVar: '--agent-peach',  label: '评审' },
  arch_reviewer: { emoji: '⚙️', themeVar: '--agent-dk',     label: '架构' },
  qa:            { emoji: '🎵', themeVar: '--agent-yoshi',  label: '质检' },
};
```

- [ ] **Step 4: Commit**

```bash
git add src/components/task-hub/TaskCard.tsx src/components/task-hub/AgentTaskGroup.tsx src/components/role-card/RoleCardBadge.tsx
git commit -m "feat: update component theme maps from Genshin to Mario"
```

---

### Task 7: Hardcoded UI Text (5 files)

**Files:**
- Modify: `src/components/task-hub/GlobalChatRoom.tsx:98-107, 167-170, 190`
- Modify: `src/components/project/ProjectCreateDialog.tsx:127`
- Modify: `src/components/project/ProjectChatPanel.tsx:70, 76`
- Modify: `src/components/chat/ChatHubView.tsx:90`
- Modify: `src/components/war-room/TimelineCards.tsx:34-35, 41, 50, 59, 68`

- [ ] **Step 1: Update GlobalChatRoom AGENT_META (lines 98-107)**

```ts
const AGENT_META: Record<string, { emoji: string; name: string; color: string }> = {
  mario:  { emoji: '⭐', name: 'Mario',       color: 'border-red-500/40' },
  luigi:  { emoji: '⚡', name: 'Luigi',       color: 'border-green-500/40' },
  toad:   { emoji: '🛡️', name: 'Toad',       color: 'border-amber-300/40' },
  peach:  { emoji: '🌸', name: 'Peach',       color: 'border-pink-500/40' },
  dk:     { emoji: '⚙️', name: 'Donkey Kong', color: 'border-amber-700/40' },
  yoshi:  { emoji: '🎵', name: 'Yoshi',       color: 'border-green-400/40' },
  system: { emoji: '⚙️', name: '系统', color: 'border-violet-500/40' },
  human:  { emoji: '👤', name: '用户', color: 'border-[hsl(var(--agent-owner))]/40' },
};
```

- [ ] **Step 2: Update GlobalChatRoom hint text (lines 167-170)**

```ts
// First empty-state hints:
{[
  '@Mario 帮我规划一下…',
  '@Luigi 写一个…',
  '@Peach 审查…',
].map((hint) => (
```

- [ ] **Step 3: Update GlobalChatRoom second hint (line 190)**

```ts
// The second empty-state hints (inside selectedConversationId block):
{['@Mario 帮我规划一下…', '@Luigi 直接开始…'].map((hint) => (
```

Also update line 187:
```ts
// FROM: @Jean 可以帮你拆解任务，或直接 @Agent 下达指令
// TO:   @Mario 可以帮你拆解任务，或直接 @Agent 下达指令
```

- [ ] **Step 4: Update ProjectCreateDialog (line 127)**

```ts
// FROM: 自动拆解任务（由 ⚔️ Jean 分析）
// TO:   自动拆解任务（由 ⭐ Mario 分析）
```

- [ ] **Step 5: Update ProjectChatPanel (lines 70, 76)**

Line 70:
```ts
// FROM: 为 ⚔️ Jean 配置账号后可拆解任务
// TO:   为 ⭐ Mario 配置账号后可拆解任务
```

Line 76:
```ts
// FROM: ⚔️ Jean 正在拆解任务…
// TO:   ⭐ Mario 正在拆解任务…
```

- [ ] **Step 6: Update ChatHubView (line 90)**

```ts
// FROM: 还没有任务。你可以在对话里写：TASK: 标题 @jean
// TO:   还没有任务。你可以在对话里写：TASK: 标题 @mario
```

- [ ] **Step 7: Update TimelineCards agentId values**

Replace these exact values:
- Line 34: `inviteAgent('nahida')` → `inviteAgent('peach')`
- Line 35: `inviteAgent('zhongli')` → `inviteAgent('toad')`
- Line 41: `agentId: 'keqing'` → `agentId: 'luigi'`
- Line 50: `agentId: 'jean'` → `agentId: 'mario'`
- Line 59: `agentId: 'nahida'` → `agentId: 'peach'`
- Line 68: `agentId: 'zhongli'` → `agentId: 'toad'`

- [ ] **Step 8: Commit**

```bash
git add src/components/task-hub/GlobalChatRoom.tsx src/components/project/ProjectCreateDialog.tsx src/components/project/ProjectChatPanel.tsx src/components/chat/ChatHubView.tsx src/components/war-room/TimelineCards.tsx
git commit -m "feat: update hardcoded UI text from Genshin to Mario names"
```

---

### Task 8: Test Fixture Updates

**Files:**
- Modify: `src/server/routing/routing.test.ts`
- Modify: `src/__tests__/store/chat-message-extensions.test.ts`
- Modify: `src/__tests__/store/account-binding.test.ts`
- Modify: `src/lib/breakdownParser.test.ts`

- [ ] **Step 1: Bulk replace agent IDs in all 4 test files**

Run these sed commands (each is an independent find-replace):

```bash
# routing.test.ts
sed -i '' "s/'jean'/'mario'/g; s/@jean/@mario/g; s/'keqing'/'luigi'/g; s/@keqing/@luigi/g; s/'zhongli'/'toad'/g; s/@zhongli/@toad/g; s/'nahida'/'peach'/g; s/'albedo'/'dk'/g; s/'venti'/'yoshi'/g; s/\"jean\"/\"mario\"/g; s/\"keqing\"/\"luigi\"/g" src/server/routing/routing.test.ts

# chat-message-extensions.test.ts
sed -i '' "s/'jean'/'mario'/g; s/'keqing'/'luigi'/g; s/'nahida'/'peach'/g" src/__tests__/store/chat-message-extensions.test.ts

# account-binding.test.ts — only replace 'jean' in theme: lines
sed -i '' "s/theme: 'jean'/theme: 'mario'/g" src/__tests__/store/account-binding.test.ts

# breakdownParser.test.ts
sed -i '' "s/@zhongli/@toad/g; s/@keqing/@luigi/g; s/'zhongli'/'toad'/g; s/'keqing'/'luigi'/g; s/'jean'/'mario'/g" src/lib/breakdownParser.test.ts
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 3: Run full type check**

Run: `npx tsc --noEmit 2>&1`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/routing/routing.test.ts src/__tests__/store/chat-message-extensions.test.ts src/__tests__/store/account-binding.test.ts src/lib/breakdownParser.test.ts
git commit -m "test: update test fixtures from Genshin to Mario agent IDs"
```

---

### Task 9: Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `pnpm build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 2: Run all tests again**

Run: `npx vitest run 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 3: Visual smoke test**

Start dev server with `pnpm dev`, open browser, verify:
- Agent bar shows Mario (⭐) and Luigi (⚡) as active agents
- Pixel avatars render Mario/Luigi sprites (not broken images)
- Chat room hint text shows "@Mario 帮我规划一下…"
- CSS theme colors match (Mario = red, Luigi = green)
