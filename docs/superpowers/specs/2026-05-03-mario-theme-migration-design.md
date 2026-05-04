# Mario Theme Migration Design

**Goal:** Replace all Genshin Impact theming (6 agent characters, CSS variables, pixel art, persona voice) with Super Mario Bros theme.

**Approach:** Full rename — all internal IDs, CSS variables, type definitions change from Genshin names to Mario names. Existing localStorage/SQLite data will be reset.

**Scope:** ~22 source files across types, data, CSS, components, server routing, store logic, and tests.

---

## Character Mapping

| Old ID | New ID | Display Name | Role | Theme Color | Pixel Art |
|--------|--------|-------------|------|-------------|-----------|
| `jean` | `mario` | Mario | 项目统筹 (planner) | Red `#DC2626` | Red cap with M badge |
| `keqing` | `luigi` | Luigi | 前端实现 (frontend) | Green `#16A34A` | Green cap with L badge |
| `zhongli` | `toad` | Toad | 后端开发 (backend) | White-Red `#E8E0D4/#DC2626` | Mushroom head + blue vest |
| `nahida` | `peach` | Peach | 代码评审 (reviewer) | Pink-Gold `#EC4899/#F59E0B` | Gold crown + pink hair |
| `albedo` | `dk` | Donkey Kong | 架构工程 (arch) | Brown-Red `#92400E/#DC2626` | Brown body + red tie |
| `venti` | `yoshi` | Yoshi | QA 测试 (qa) | Green-Orange `#22C55E/#F97316` | Green body + orange shell |

Default active agents: `['mario', 'luigi']`

## Type Changes

**`AgentTheme`** (`src/store/taskHubStore.ts`):
```ts
// FROM: 'jean' | 'keqing' | 'zhongli' | 'nahida' | 'albedo' | 'venti'
// TO:   'mario' | 'luigi' | 'toad' | 'peach' | 'dk' | 'yoshi'
```

## CSS Variable Rename (`src/app/globals.css`)

Each agent has 3 CSS variables (base, soft, border) × 2 modes (light, dark) = 36 replacements:

```
--agent-jean       → --agent-mario
--agent-jean-soft  → --agent-mario-soft
--agent-jean-border→ --agent-mario-border
--agent-keqing       → --agent-luigi
... (same pattern for all 6)
```

Color values update per character mapping above.

## AGENT_ROSTER (`src/store/taskHubStore.ts`)

Replace all 6 entries with new IDs, names, emojis, themes. Keep `roleCardId` references pointing to preset card IDs (those also rename).

## Preset Role Cards (`src/data/presetRoleCards.ts`)

All 6 persona introductions rewritten in Mario universe voice. Key style principles:
- Reference Mario universe metaphors (pipes, stars, coins, levels, bosses)
- Maintain the same functional responsibilities
- Keep personality distinct per character

### Persona Examples

**Mario (preset-planner):**
> 你是 Mario，这个项目的统筹。你虽然习惯亲自上阵，但更擅长指挥团队。你总能在复杂局面中找到最直接的路线，像在迷宫里找星星一样拆解问题。你用简短有力的指令协调团队，确保每个人都知道下一步该去哪根管道。

**Luigi (preset-frontend):**
> 你是 Luigi，前端负责人。你比任何人都注重细节和用户体验——毕竟你总是在 Mario 的光环下工作，所以你必须做得更精致。你对像素级的完美有执念，从交互到动画都不放过。遇到 bug 就像遇到幽灵，你绝不放过任何一个。

**Toad (preset-backend):**
> 你是 Toad，后端开发负责人。你稳定可靠，是整个王国基础设施的守护者。你设计的系统像蘑菇王国城堡一样坚固——数据安全、接口清晰、服务高可用。你用务实的态度对待每一个技术选型。

**Peach (preset-code-reviewer):**
> 你是 Peach，代码评审。你以温柔但严格的标准审查每一行代码——像治理王国一样追求秩序和优雅。你看重代码的可读性、可维护性，以及是否遵循了团队约定。

**Donkey Kong (preset-arch-reviewer):**
> 你是 Donkey Kong，架构评审。你用原始但敏锐的直觉评估系统设计——像审视自己领地一样检查架构的每个角落。你关注性能瓶颈、安全风险和可扩展性，不接受花架子。

**Yoshi (preset-qa):**
> 你是 Yoshi，质量守卫。你用舌头一样灵活的测试策略捕捉每一个 bug——功能测试、边界测试、回归测试一个不落。你忠诚地守护着交付质量，确保没有 bug 能从你的眼皮底下溜走。

## Pixel Art (`src/components/task-hub/PixelAvatar.tsx`)

Replace 6 pixel grids and palettes. Each character gets an 8×8 pixel grid in their signature colors:

- Mario: Red cap (fill top rows), skin face, blue overalls
- Luigi: Green cap (taller than Mario's), skin face, blue overalls
- Toad: White mushroom dome, round face, blue vest
- Peach: Gold crown top, pink long hair, pink dress
- DK: Brown body, wide face, red DK tie
- Yoshi: Green round body, white belly, orange ridge

## Component Theme Maps

Three component-level theme maps update:

1. **`TaskCard.tsx`** `themeAccent` — 6 border-left class entries
2. **`AgentTaskGroup.tsx`** `themeStyles` — 6 agents × 6 CSS class entries = 36 lines
3. **`RoleCardBadge.tsx`** `CATEGORY_CONFIG` — 6 category-to-theme mappings

## Hardcoded Text Updates

| File | Old Text | New Text |
|------|----------|----------|
| `ProjectCreateDialog.tsx` | `自动拆解任务（由 ⚔️ Jean 分析）` | `自动拆解任务（由 ⭐ Mario 分析）` |
| `ProjectChatPanel.tsx` | `为 ⚔️ Jean 配置账号后可拆解任务` | `为 ⭐ Mario 配置账号后可拆解任务` |
| `ProjectChatPanel.tsx` | `⚔️ Jean 正在拆解任务...` | `⭐ Mario 正在拆解任务...` |
| `ChatHubView.tsx` | `@jean` | `@mario` |
| `GlobalChatRoom.tsx` hints | `@Jean 帮我规划一下...` | `@Mario 帮我规划一下...` |
| `GlobalChatRoom.tsx` AGENT_META | 6 entries with Genshin names | 6 entries with Mario names |
| `TimelineCards.tsx` | `'keqing'`, `'jean'`, `'nahida'`, `'zhongli'` | `'luigi'`, `'mario'`, `'peach'`, `'toad'` |

## Store Logic Updates

- `triggerBreakdown` prompt: `你是项目统筹 Jean` → `你是项目统筹 Mario`
- Fallback agentId: `|| 'jean'` → `|| 'mario'`
- Comment: `// Auto-trigger Jean breakdown` → `// Auto-trigger Mario breakdown`

## Server Routing (`src/server/routing/mention-parser.ts`)

```ts
// FROM: const AGENT_IDS = ['jean', 'keqing', 'zhongli', 'nahida', 'albedo', 'venti']
// TO:   const AGENT_IDS = ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi']
```

## Test Files

4 test files update fixture agentIds: `routing.test.ts`, `chat-message-extensions.test.ts`, `account-binding.test.ts`, `breakdownParser.test.ts`.

## Files NOT Changed

- Documentation files in `docs/archive/`, `design/` — historical, no code impact
- Server config/routes that reference agents by runtime-determined IDs (already dynamic)

## Data Migration

No backward compatibility layer. Users clear localStorage on next load. SQLite sessions table has agent_id column — old sessions with Genshin IDs become orphaned but harmless (sealed sessions aren't actively queried).
