# 团队精简（6→4 人 + 移除其他团队）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将默认团队从 6 人精简到 4 人（合并 toad→luigi、yoshi→peach），移除 engineering-trio 和 research-team 的全部数据/提示词/前端/代码。

**Architecture:** 自底向上改 5 层：数据（agentStore/presetTeamPacks/seed）→ 提示词（roleLayer/teamPackLayer/collaborationLayer）→ 前端（CSS/PixelAvatar/ChatMessageItem）→ 代码清理（全局 toad/yoshi/engineering-trio/research-team）→ DB 清理 + 验证。

**Tech Stack:** TypeScript / Next.js 16 / React 19 / SQLite / Zustand / Vitest

---

## Task 1: agentStore — 删除 toad/yoshi，更新 Luigi/Peach

**Files:**
- Modify: `src/store/agentStore.ts`

- [ ] **Step 1: 更新 AgentTheme 类型（删 toad/yoshi）**

`src/store/agentStore.ts:12`，将：
```ts
export type AgentTheme = 'mario' | 'luigi' | 'toad' | 'peach' | 'dk' | 'yoshi';
```
改为：
```ts
export type AgentTheme = 'mario' | 'luigi' | 'peach' | 'dk';
```

- [ ] **Step 2: 更新 Luigi roleLabel（前端实现 → 全栈开发）**

`src/store/agentStore.ts` FALLBACK_AGENTS 里 Luigi 对象，将：
```ts
    roleLabel: '前端实现',
    roleCardId: 'preset-frontend',
```
改为：
```ts
    roleLabel: '全栈开发',
    roleCardId: 'preset-frontend',
```

- [ ] **Step 3: 更新 Peach roleLabel（代码评审 → 质量保障）**

`src/store/agentStore.ts` FALLBACK_AGENTS 里 Peach 对象，将：
```ts
    roleLabel: '代码评审',
```
改为：
```ts
    roleLabel: '质量保障',
```

- [ ] **Step 4: 删除 toad 对象**

删除 FALLBACK_AGENTS 中整个 toad 对象：
```ts
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
```

- [ ] **Step 5: 删除 yoshi 对象**

删除 FALLBACK_AGENTS 中整个 yoshi 对象：
```ts
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
```

- [ ] **Step 6: 更新 ROLE_MAP（删 preset-backend/preset-qa）**

将：
```ts
const ROLE_MAP: Record<string, AgentRole> = {
  'preset-planner': 'planner',
  'preset-frontend': 'worker',
  'preset-backend': 'worker',
  'preset-code-reviewer': 'reviewer',
  'preset-arch-reviewer': 'reviewer',
  'preset-qa': 'reviewer',
};
```
改为：
```ts
const ROLE_MAP: Record<string, AgentRole> = {
  'preset-planner': 'planner',
  'preset-frontend': 'worker',
  'preset-code-reviewer': 'reviewer',
  'preset-arch-reviewer': 'reviewer',
};
```

- [ ] **Step 7: 更新 ROLE_LABEL_MAP（删 preset-backend/preset-qa，更新 frontend/code-reviewer）**

将：
```ts
const ROLE_LABEL_MAP: Record<string, string> = {
  'preset-planner': '项目统筹',
  'preset-frontend': '前端实现',
  'preset-backend': '后端开发',
  'preset-code-reviewer': '代码评审',
  'preset-arch-reviewer': '架构工程',
  'preset-qa': 'QA 测试',
};
```
改为：
```ts
const ROLE_LABEL_MAP: Record<string, string> = {
  'preset-planner': '项目统筹',
  'preset-frontend': '全栈开发',
  'preset-code-reviewer': '质量保障',
  'preset-arch-reviewer': '架构工程',
};
```

- [ ] **Step 8: Build 验证**

Run: `pnpm build 2>&1 | tail -5`
Expected: build 通过（可能有其他文件引用 toad/yoshi 的类型错误，后面 Task 修复）

- [ ] **Step 9: Commit**

```bash
git add src/store/agentStore.ts
git commit -m "refactor(agentStore): 6→4 人组，删 toad/yoshi，更新 luigi/peach roleLabel"
```

---

## Task 2: globals.css — 删除 toad/yoshi CSS 变量

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: 删除 toad CSS 变量**

删除这 3 行：
```css
  --agent-toad:       25 20% 85%;
  --agent-toad-soft:  0 60% 95%;
  --agent-toad-border:0 65% 80%;
```

- [ ] **Step 2: 删除 yoshi CSS 变量**

删除这 3 行：
```css
  --agent-yoshi:         100 60% 50%;
  --agent-yoshi-soft:    100 40% 93%;
  --agent-yoshi-border:  100 50% 75%;
```

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "refactor(css): 删除 toad/yoshi 主题变量"
```

---

## Task 3: PixelAvatar — 删除 toad/yoshi 头像

**Files:**
- Modify: `src/components/task-hub/PixelAvatar.tsx`

- [ ] **Step 1: 删除 toad 像素头像数据 + theme map**

删除 PixelAvatar.tsx 中 `toad:` 的像素头像数组（约 `:47-57`）和 theme map 里的 `toad:` 条目（约 `:106-108`）。

- [ ] **Step 2: 删除 yoshi 像素头像数据 + theme map**

删除 PixelAvatar.tsx 中 `yoshi:` 的像素头像数组（约 `:80-91`）和 theme map 里的 `yoshi:` 条目（约 `:124-126`）。

- [ ] **Step 3: Commit**

```bash
git add src/components/task-hub/PixelAvatar.tsx
git commit -m "refactor(PixelAvatar): 删除 toad/yoshi 像素头像"
```

---

## Task 4: ChatMessageItem — 删除 toad/yoshi AVATAR_THEME_CLASSES

**Files:**
- Modify: `src/components/task-hub/ChatMessageItem.tsx`

- [ ] **Step 1: 删除 AVATAR_THEME_CLASSES 里的 toad/yoshi**

删除 `:28` 和 `:31`：
```ts
  toad: 'bg-[hsl(var(--agent-toad))] border-[hsl(var(--agent-toad-border))]',
  yoshi: 'bg-[hsl(var(--agent-yoshi))] border-[hsl(var(--agent-yoshi-border))]',
```

- [ ] **Step 2: Commit**

```bash
git add src/components/task-hub/ChatMessageItem.tsx
git commit -m "refactor(ChatMessageItem): 删除 toad/yoshi theme class"
```

---

## Task 5: teamPackLayer — 更新 HARNESS_STAGE_GUIDANCE 为 4 人

**Files:**
- Modify: `src/lib/agent-context/layers/teamPackLayer.ts`

- [ ] **Step 1: 重写 HARNESS_STAGE_GUIDANCE（删 toad/yoshi，更新 luigi/peach）**

将 `:4-40` 的 HARNESS_STAGE_GUIDANCE 对象替换为：

```ts
const HARNESS_STAGE_GUIDANCE: Record<string, string> = {
  mario: [
    '你是 planning owner：拆解任务、排列依赖、分派到 Luigi。',
    '不要在正常 quality_gate reject 中充当中转；只有范围不清、反复失败、架构或产品取舍时处理升级。',
    '最终总结只在 quality_gate 通过或用户要求时进行。',
  ].join('\n'),
  luigi: [
    '你在 implementing 阶段负责全栈实现（前端 + 后端 + API 契约 + 数据模型）。',
    '完成后必须提交变更摘要和证据，并 @peach 请评审；不要直接宣称 done。',
    '涉及架构/schema/安全风险时 @dk 请评估。',
    '收到 Peach/DK reject 时，按问题修复并重新 @peach 请评审。',
  ].join('\n'),
  peach: [
    '你是 quality_gate owner：先审查代码质量、安全、回归风险，然后亲自做集成测试验证。',
    '评审不通过时直接 @luigi 请修正；发现架构/schema/安全风险时 @dk 请评估。',
    '评审 + 测试都通过后再允许任务进入 done。',
  ].join('\n'),
  dk: [
    '你是按需架构门禁，不是常规实现者。',
    '只在架构、schema、安全、性能、跨模块边界或 Peach/Luigi/Mario 明确请求时介入。',
    '架构反馈 @luigi 请按建议调整；需要范围取舍时 @mario 请决策。',
    '不要直接修改代码，除非用户明确改变你的角色权限。',
  ].join('\n'),
};
```

- [ ] **Step 2: 更新 workflow 描述（:77-82）**

将 `:77-82`：
```ts
    parts.push([
      '默认团队按 planning → implementing → review_gate → test_gate → done 推进。',
      'Luigi/Toad 在 implementing 阶段按 frontend/backend lane 并行执行。',
      'Peach 是 review_gate owner，DK 是按需架构 gate，Yoshi 是 test_gate owner。',
      'Reject 直接打回责任角色；只有范围不清、反复失败或需要取舍时升级给 Mario。',
    ].join('\n'));
```
改为：
```ts
    parts.push([
      '默认团队按 planning → implementing → quality_gate → done 推进。',
      'Luigi 在 implementing 阶段独立负责全栈实现。',
      'Peach 是 quality_gate owner（评审 + 测试），DK 是按需架构 gate。',
      'Reject 直接打回 Luigi；只有范围不清、反复失败或需要取舍时升级给 Mario。',
    ].join('\n'));
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent-context/layers/teamPackLayer.ts
git commit -m "refactor(teamPackLayer): HARNESS 4 人组，quality_gate 合并"
```

---

## Task 6: roleLayer — 合并 qa 分支进 code_reviewer，更新 planner

**Files:**
- Modify: `src/lib/agent-context/layers/roleLayer.ts`

- [ ] **Step 1: 更新 planner 分支（:64-66 已泛化，进一步改为提 Luigi）**

将 `:64-66`（当前是泛化的"前端角色/后端角色"）：
```ts
5. 按团队 Workflow Harness 分派：planning → implementing → review_gate → test_gate → done
6. 前端任务给前端角色，后端任务给后端角色；跨域任务拆成有依赖的两个任务，不让统筹角色代替实现
7. 正常 reject/test feedback 不经过统筹角色；只有范围不清、反复失败或需要取舍才升级给统筹角色
```
改为：
```ts
5. 按团队 Workflow Harness 分派：planning → implementing → quality_gate → done
6. 实现任务给 Luigi（全栈开发）；不让统筹角色代替实现
7. 正常 quality_gate reject 不经过统筹角色；只有范围不清、反复失败或需要取舍才升级给统筹角色
```

- [ ] **Step 2: 更新 code_reviewer 分支（合并 qa 职责）**

将 `:75-80`（当前 code_reviewer gate）：
```ts
  if (roleCard.category === 'code_reviewer') {
    parts.push(`## Gate 职责
- 你负责 review_gate：评审不通过时直接打回责任实现者，并附具体证据和修复方向
- 发现架构、schema、安全、性能或跨模块边界风险时，升级给架构评审角色
- 评审通过后交给测试/验收角色进入 test_gate，不直接宣称交付完成`);
  }
```
改为：
```ts
  if (roleCard.category === 'code_reviewer') {
    parts.push(`## Quality Gate 职责
- 你负责 quality_gate：先评审代码质量、安全、回归风险，再做集成测试验证
- 评审不通过时直接打回实现角色（Luigi），并附具体证据和修复方向
- 发现架构、schema、安全、性能或跨模块边界风险时，升级给架构评审角色
- 评审 + 测试都通过后才允许任务进入 done，不直接宣称交付完成`);
  }
```

- [ ] **Step 3: 更新 arch_reviewer 分支（泛化已改，确认引用为 Luigi）**

当前 arch_reviewer（`:82-89`）应已经是泛化的（"反馈给相关实现或评审角色"）。确认无需再改。

- [ ] **Step 4: 删除 qa 分支（:91-97）**

删除：
```ts
  if (roleCard.category === 'qa') {
    parts.push(`## Gate 职责
- 你负责 test_gate：验证集成行为、规格一致性、回归风险和交付完整性
- 测试失败时直接打回实现角色；发现评审遗漏时反馈给评审角色
- 发现架构风险时反馈给架构评审角色评估
- 验收通过后再允许任务进入 done`);
  }
```

- [ ] **Step 5: Build 验证**

Run: `pnpm build 2>&1 | tail -5`
Expected: 通过

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent-context/layers/roleLayer.ts
git commit -m "refactor(roleLayer): 合并 qa 进 code_reviewer，planner 提 Luigi"
```

---

## Task 7: presetTeamPacks — 只留 default-team 4 人 + 删除其他团队

**Files:**
- Modify: `src/data/presetTeamPacks.ts`

- [ ] **Step 1: 读取当前 presetTeamPacks.ts 全文**

Run: `cat src/data/presetTeamPacks.ts | wc -l`
确认文件行数，然后读全文理解 default-team workflow 结构。

- [ ] **Step 2: 更新 default-team workflow 为 4 人**

default-team 的 workflow states 从 5 阶段（planning → implementing → review_gate → test_gate → done）改为 4 阶段（planning → implementing → quality_gate → done）：
- implementing：role 从 'luigi' 不变，描述从"Luigi 负责 frontend lane，Toad 负责 backend lane"改为"Luigi 负责全栈实现"
- review_gate + test_gate 合并为 quality_gate：role='peach'，描述"Peach 负责代码评审 + 集成测试"
- 更新所有 transitions（review_gate/test_gate 相关改为 quality_gate）

- [ ] **Step 3: 更新 default-team roles 为 4 人**

default-team 的 roles 数组从 6 个（mario/luigi/toad/peach/dk/yoshi）改为 4 个（mario/luigi/peach/dk）：
- 删除 toad、yoshi role
- 更新 luigi soul（从"前端实现"扩展为"全栈开发"，用 spec 里的 persona）
- 更新 peach soul（从"代码评审"扩展为"质量保障：评审+测试"，用 spec 里的 persona）

- [ ] **Step 4: 删除 engineering-trio 整个对象**

删除 engineering-trio 的完整定义（包括 roles、workflow、communicationMatrix 等）。

- [ ] **Step 5: 删除 research-team 整个对象**

删除 research-team 的完整定义。

- [ ] **Step 6: 更新 export**

确保 `export const PRESET_TEAM_PACKS` 只导出 `[defaultTeam]`（1 个团队）。

- [ ] **Step 7: Build 验证**

Run: `pnpm build 2>&1 | tail -5`

- [ ] **Step 8: Commit**

```bash
git add src/data/presetTeamPacks.ts
git commit -m "refactor(presetTeamPacks): 只留 default-team 4 人，删 engineering-trio/research-team"
```

---

## Task 8: 全局清理 toad/yoshi/engineering-trio/research-team 残留引用

**Files:**
- Multiple（全局搜索后逐个修复）

- [ ] **Step 1: 搜索全部残留**

Run:
```bash
grep -rn "toad\|yoshi" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".test."
```

- [ ] **Step 2: 搜索 engineering-trio / research-team 残留**

Run:
```bash
grep -rn "engineering-trio\|research-team\|engineeringTrio\|researchTeam" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules
```

- [ ] **Step 3: 逐个修复残留引用**

对每个文件：
- `toad` 引用 → 删除或替换为 `luigi`
- `yoshi` 引用 → 删除或替换为 `peach`
- `engineering-trio` / `research-team` 引用 → 删除

重点检查：
- `src/server/seed-team-packs.ts`
- `src/server/seed-skills.ts`
- `src/__tests__/` 下的测试文件
- `src/components/` 组件中的硬编码

- [ ] **Step 4: Build 验证**

Run: `pnpm build 2>&1 | tail -5`
Expected: 通过

- [ ] **Step 5: grep 确认无残留**

Run:
```bash
grep -rn "toad\|yoshi\|engineering-trio\|research-team" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".test."
```
Expected: 空（无残留）

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: 全局清理 toad/yoshi/engineering-trio/research-team 残留"
```

---

## Task 9: 更新测试文件

**Files:**
- Multiple（`src/__tests__/` 下的相关测试）

- [ ] **Step 1: 搜索引用 toad/yoshi 的测试**

Run:
```bash
grep -rln "toad\|yoshi\|engineering-trio\|research-team" src/__tests__/ src/**/*.test.ts src/**/*.test.tsx 2>/dev/null
```

- [ ] **Step 2: 逐个修复测试文件**

对每个测试文件：
- 删除 toad/yoshi 相关的 test case
- 更新引用 6 人组 → 4 人组
- 删除 engineering-trio/research-team 相关的 test case

- [ ] **Step 3: 运行测试**

Run: `pnpm test 2>&1 | tail -10`
Expected: 全绿（或只剩既有的 Windows 兼容性 fail，无新增 fail）

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: 更新测试适配 4 人组"
```

---

## Task 10: DB 清理 + 最终验证

**Files:**
- DB: `.ath/data.db`

- [ ] **Step 1: DB 删除 engineering-trio/research-team**

Run:
```bash
node -e "
const D = require('better-sqlite3');
const db = new D('.ath/data.db');
// 删除非 default-team 的 team_pack_role
const r1 = db.prepare('DELETE FROM team_pack_role WHERE pack_id NOT IN (SELECT id FROM team_pack WHERE name = ?)').run('default-team');
console.log('删除非 default-team role:', r1.changes);
// 删除非 default-team 的 team_pack
const r2 = db.prepare('DELETE FROM team_pack WHERE name != ?').run('default-team');
console.log('删除非 default-team pack:', r2.changes);
"
```

- [ ] **Step 2: 最终 build**

Run: `pnpm build 2>&1 | tail -5`
Expected: 通过

- [ ] **Step 3: 最终 grep 确认**

Run:
```bash
echo "=== toad/yoshi ===" && grep -rn "toad\|yoshi" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | wc -l
echo "=== engineering-trio/research-team ===" && grep -rn "engineering-trio\|research-team" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | wc -l
```
Expected: 0 / 0

- [ ] **Step 4: 重启 server + UI 验证**

重启 server，刷新浏览器，确认：
- UI 显示 4 人组（mario⭐ / dk⚙️ / luigi⚡ / peach🌸）
- 无 toad/yoshi 残留
- workflow 4 阶段

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: DB 清理 + 最终验证通过"
```
