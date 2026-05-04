# Md-Driven Task Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the task assignment system work end-to-end using markdown files as source of truth, with file watching, prompt injection, task lifecycle closure, and UI status cards.

**Architecture:** `.ath/` directory holds 4 markdown files (TASKS.md, PROJECT.md, PROTOCOLS.md, ROLES.md) as SSOT. FileWatcher syncs to DB for UI. ProtocolLayer injects minimal constraints + file paths into every dispatch prompt. Task lifecycle auto-advances on CLI exit and tool invocations.

**Tech Stack:** TypeScript, chokidar (file watching), better-sqlite3 (existing), Socket.IO (existing), React + Zustand (existing), Tailwind CSS (existing)

**Design spec:** `docs/superpowers/specs/2026-05-04-md-driven-task-dispatch-design.md`

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `src/server/task-file-service.ts` | Read/write/parse .ath/ markdown files |
| `src/server/task-file-watcher.ts` | chokidar watcher: detect TASKS.md changes → sync DB → broadcast |
| `src/lib/agent-context/layers/protocolLayer.ts` | Build minimal protocol prompt (constraints + file paths) |
| `src/components/task-hub/TaskStatusCard.tsx` | Compact status card rendered in chat on task status changes |
| `src/__tests__/server/task-file-service.test.ts` | Tests for TaskFileService |
| `src/__tests__/agent-context/protocolLayer.test.ts` | Tests for protocolLayer |

### Modified files
| File | Change |
|------|--------|
| `src/lib/agent-context/PromptComposer.ts:66-102` | Refactor: move skillLayer/toolLayer from system→user prompt, remove isFirstWake guard from history, add protocolLayer to user prompt |
| `src/store/taskHubStore.ts:1225-1284` | Add exit=0 → in_review logic in terminal:exit handler |
| `src/store/taskStore.ts:298-398` | Add .ath/ file writing + Planner dispatch to confirmBreakdown |
| `src/pages/api/mutations.ts:189-191` | Expand task_assign handler to update TASKS.md + broadcast task.assigned |
| `src/components/task-hub/ChatMessageItem.tsx` | Render TaskStatusCard for task.status_changed events |

---

## Task 1: Install chokidar

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install chokidar**

Run: `npm install chokidar && npm install -D @types/chokidar`

- [ ] **Step 2: Verify installation**

Run: `node -e "require('chokidar'); console.log('ok')"`

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add chokidar for .ath/ file watching"
```

---

## Task 2: TaskFileService — types and parser

**Files:**
- Create: `src/server/task-file-service.ts`
- Create: `src/__tests__/server/task-file-service.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/__tests__/server/task-file-service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { parseTasksMd, formatTasksMd, initProjectDir } from '@/server/task-file-service';

const TMP = join(__dirname, '__tmp_task_file_service__');

beforeEach(() => { mkdirSync(TMP, { recursive: true }); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('parseTasksMd', () => {
  it('parses a valid TASKS.md table', () => {
    const md = `# 任务看板

| ID | Title | Role | Agent | Status | Depends | Deliverable | Level |
|----|-------|------|-------|--------|---------|-------------|-------|
| TASK-001 | 拆分 Store | backend | luigi | doing | - | store slices | L2 |
| TASK-002 | 测试覆盖 | testing | - | todo | TASK-001 | - | L1 |
`;

    const tasks = parseTasksMd(md);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({
      id: 'TASK-001',
      title: '拆分 Store',
      role: 'backend',
      agent: 'luigi',
      status: 'doing',
      depends: [],
      deliverable: 'store slices',
      level: 'L2',
    });
    expect(tasks[1].depends).toEqual(['TASK-001']);
    expect(tasks[1].agent).toBe('');
  });

  it('returns empty array for markdown without table', () => {
    expect(parseTasksMd('# No tasks here\n')).toEqual([]);
  });

  it('skips separator rows', () => {
    const md = `| ID | Title |\n|----|-------|\n| T-001 | Foo |`;
    const tasks = parseTasksMd(md);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('T-001');
  });
});

describe('formatTasksMd', () => {
  it('round-trips parse → format', () => {
    const original = [
      { id: 'TASK-001', title: 'Do thing', role: 'backend', agent: 'luigi', status: 'todo', depends: [], deliverable: '-', level: 'L2' },
    ];
    const md = formatTasksMd(original);
    const reparsed = parseTasksMd(md);
    expect(reparsed).toEqual(original);
  });
});

describe('initProjectDir', () => {
  it('creates .ath/ directory with 4 files', () => {
    initProjectDir(TMP, {
      name: 'Test Project',
      goal: 'Test goal',
      techStack: ['Next.js'],
      constraints: ['Must pass tests'],
    });

    expect(existsSync(join(TMP, '.ath', 'TASKS.md'))).toBe(true);
    expect(existsSync(join(TMP, '.ath', 'PROJECT.md'))).toBe(true);
    expect(existsSync(join(TMP, '.ath', 'PROTOCOLS.md'))).toBe(true);
    expect(existsSync(join(TMP, '.ath', 'ROLES.md'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/server/task-file-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement TaskFileService**

Create `src/server/task-file-service.ts`:

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface ParsedTask {
  id: string;
  title: string;
  role: string;
  agent: string;
  status: string;
  depends: string[];
  deliverable: string;
  level: string;
}

export interface ProjectMeta {
  name: string;
  goal: string;
  techStack: string[];
  constraints: string[];
}

const STATUS_MAP: Record<string, string> = {
  todo: 'pending',
  doing: 'in_progress',
  review: 'in_review',
  done: 'done',
  blocked: 'blocked',
};

const STATUS_REVERSE: Record<string, string> = {
  pending: 'todo',
  in_progress: 'doing',
  in_review: 'review',
  done: 'done',
  blocked: 'blocked',
};

export function parseTasksMd(content: string): ParsedTask[] {
  const lines = content.split('\n');
  const tasks: ParsedTask[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || trimmed.startsWith('|-') || trimmed.startsWith('| ID') || trimmed.startsWith('|ID')) continue;

    const cells = trimmed.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 8) continue;

    const id = cells[0];
    if (!id || id.includes('-') === false) continue; // skip non-ID rows

    tasks.push({
      id,
      title: cells[1],
      role: cells[2],
      agent: cells[3] === '-' ? '' : cells[3],
      status: STATUS_MAP[cells[4]] ?? cells[4],
      depends: cells[5] === '-' ? [] : cells[5].split(',').map((s) => s.trim()),
      deliverable: cells[6] === '-' ? '' : cells[6],
      level: cells[7],
    });
  }

  return tasks;
}

export function formatTasksMd(tasks: ParsedTask[]): string {
  const header = `| ID | Title | Role | Agent | Status | Depends | Deliverable | Level |
|----|-------|------|-------|--------|---------|-------------|-------|`;

  const rows = tasks.map((t) => {
    const status = STATUS_REVERSE[t.status] ?? t.status;
    const agent = t.agent || '-';
    const depends = t.depends.length > 0 ? t.depends.join(',') : '-';
    const deliverable = t.deliverable || '-';
    return `| ${t.id} | ${t.title} | ${t.role} | ${agent} | ${status} | ${depends} | ${deliverable} | ${t.level} |`;
  });

  return `# 任务看板\n\n${header}\n${rows.join('\n')}\n`;
}

export function readTasksMd(projectPath: string): ParsedTask[] {
  const filePath = join(projectPath, '.ath', 'TASKS.md');
  if (!existsSync(filePath)) return [];
  return parseTasksMd(readFileSync(filePath, 'utf-8'));
}

export function writeTasksMd(projectPath: string, tasks: ParsedTask[]): void {
  const dir = join(projectPath, '.ath');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'TASKS.md'), formatTasksMd(tasks), 'utf-8');
}

export function updateTaskInMd(projectPath: string, taskId: string, updates: Partial<Pick<ParsedTask, 'status' | 'agent' | 'deliverable'>>): void {
  const tasks = readTasksMd(projectPath);
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return;
  Object.assign(tasks[idx], updates);
  writeTasksMd(projectPath, tasks);
}

export function initProjectDir(projectPath: string, meta: ProjectMeta): void {
  const dir = join(projectPath, '.ath');
  mkdirSync(dir, { recursive: true });

  if (!existsSync(join(dir, 'TASKS.md'))) {
    writeFileSync(join(dir, 'TASKS.md'), formatTasksMd([]), 'utf-8');
  }

  if (!existsSync(join(dir, 'PROJECT.md'))) {
    writeFileSync(join(dir, 'PROJECT.md'), `# 项目：${meta.name}\n\n## 目标\n${meta.goal}\n\n## 技术栈\n${meta.techStack.map((t) => `- ${t}`).join('\n')}\n\n## 约束\n${meta.constraints.map((c) => `- ${c}`).join('\n')}\n`, 'utf-8');
  }

  if (!existsSync(join(dir, 'PROTOCOLS.md'))) {
    writeFileSync(join(dir, 'PROTOCOLS.md'), `# 任务流转协议\n\n## 状态机\ntodo → doing → review → done / blocked\n\n## 完成标准 (DoD)\n### backend 角色\n- 代码可编译运行\n- 包含类型定义\n- 无 lint 错误\n\n### frontend 角色\n- 组件可渲染\n- 符合 design-system.md 规范\n\n### testing 角色\n- 测试覆盖率 > 80%\n- 所有用例通过\n\n## 交付规则\n- 完成任务后：将 TASKS.md 中 Status 改为 review\n- 在 Deliverable 列填写产出文件路径\n- 如果阻塞：将 Status 改为 blocked，在表格下方说明原因\n`, 'utf-8');
  }

  if (!existsSync(join(dir, 'ROLES.md'))) {
    writeFileSync(join(dir, 'ROLES.md'), `# 角色定义\n\n| Role | 典型 Agent | 职责 | 技能 |\n|------|-----------|------|------|\n| planner | mario | 需求拆解、任务分配、进度追踪 | WBS、调度 |\n| backend | luigi | 后端逻辑、数据层、API | Node.js、SQL |\n| frontend | peach | UI 组件、页面交互 | React、Tailwind |\n| testing | toad | 测试编写、质量验证 | Jest、Playwright |\n| security | dk | 安全审计、漏洞扫描 | OWASP、依赖检查 |\n| devops | yoshi | 构建、部署、CI/CD | Docker、GitHub Actions |\n`, 'utf-8');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/server/task-file-service.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/task-file-service.ts src/__tests__/server/task-file-service.test.ts
git commit -m "feat: add TaskFileService for .ath/ markdown read/write"
```

---

## Task 3: ProtocolLayer — prompt constraint + guidance

**Files:**
- Create: `src/lib/agent-context/layers/protocolLayer.ts`
- Create: `src/__tests__/agent-context/protocolLayer.test.ts`

- [ ] **Step 1: Write the test**

Create `src/__tests__/agent-context/protocolLayer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildProtocolLayer, deriveRoleFromCard } from '@/lib/agent-context/layers/protocolLayer';

describe('deriveRoleFromCard', () => {
  it('returns first domain from capabilities', () => {
    const roleCard = { capabilities: { domains: ['backend', 'api'] } } as any;
    expect(deriveRoleFromCard(roleCard)).toBe('backend');
  });

  it('returns "worker" when no capabilities', () => {
    expect(deriveRoleFromCard(undefined)).toBe('worker');
  });
});

describe('buildProtocolLayer', () => {
  it('includes constraints section with agentId and role', () => {
    const result = buildProtocolLayer({ agentId: 'luigi', agentRole: 'backend', projectPath: '/project', hasTaskAssignment: false, isPlanner: false });
    expect(result).toContain('agentId: luigi');
    expect(result).toContain('Role: backend');
    expect(result).toContain('.ath/TASKS.md');
    expect(result).toContain('.ath/PROTOCOLS.md');
  });

  it('includes task assignment guidance when hasTaskAssignment=true', () => {
    const result = buildProtocolLayer({ agentId: 'luigi', agentRole: 'backend', projectPath: '/project', hasTaskAssignment: true, isPlanner: false });
    expect(result).toContain('你被分配了');
  });

  it('includes planner guidance when isPlanner=true', () => {
    const result = buildProtocolLayer({ agentId: 'mario', agentRole: 'planner', projectPath: '/project', hasTaskAssignment: false, isPlanner: true });
    expect(result).toContain('调度职责');
  });

  it('includes self-check guidance when no task and not planner', () => {
    const result = buildProtocolLayer({ agentId: 'luigi', agentRole: 'backend', projectPath: '/project', hasTaskAssignment: false, isPlanner: false });
    expect(result).toContain('自检');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/agent-context/protocolLayer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement protocolLayer**

Create `src/lib/agent-context/layers/protocolLayer.ts`:

```ts
import type { RoleCard } from '@/types/roleCard';

export function deriveRoleFromCard(roleCard?: RoleCard): string {
  if (!roleCard?.capabilities?.domains?.length) return 'worker';
  return roleCard.capabilities.domains[0];
}

interface ProtocolLayerOpts {
  agentId: string;
  agentRole: string;
  projectPath: string;
  hasTaskAssignment: boolean;
  isPlanner: boolean;
}

export function buildProtocolLayer(opts: ProtocolLayerOpts): string {
  const constraints = `## 任务协作协议

### 你的身份
- agentId: ${opts.agentId} | Role: ${opts.agentRole}

### 规则
1. 先读 .ath/TASKS.md 查看全部任务
2. 有分配给你的 → 认领（doing）→ 执行
3. Role 匹配且 todo 的 → 也可以认领
4. 完成后 → review + 填 Deliverable
5. 阻塞 → blocked + 写原因

### 禁止
- 不改其他 Agent 的任务行
- 不跳过 review 直接标 done

### 资源位置
- 任务看板: .ath/TASKS.md
- 完成标准: .ath/PROTOCOLS.md
- 角色映射: .ath/ROLES.md
- 项目上下文: .ath/PROJECT.md`;

  let guidance = '';

  if (opts.isPlanner) {
    guidance = '\n\n调度职责：读取 .ath/TASKS.md，按优先级使用 task_assign 分配任务。';
  } else if (opts.hasTaskAssignment) {
    guidance = '\n\n你被分配了任务。读取 .ath/TASKS.md 确认，完成后更新。';
  } else {
    guidance = `\n\n自检 .ath/TASKS.md，认领 Role=${opts.agentRole} 的 todo 任务。没有则按用户指令执行。`;
  }

  return constraints + guidance;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/agent-context/protocolLayer.test.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-context/layers/protocolLayer.ts src/__tests__/agent-context/protocolLayer.test.ts
git commit -m "feat: add protocolLayer with constraint + guidance prompt"
```

---

## Task 4: Refactor PromptComposer — split system vs user prompt

**Files:**
- Modify: `src/lib/agent-context/PromptComposer.ts:1-102`
- Modify: `src/__tests__/agent-context/promptComposer.test.ts`

- [ ] **Step 1: Update PromptComposer.ts**

Replace the full file content of `src/lib/agent-context/PromptComposer.ts` with:

```ts
import type { RoleCard } from '@/types/roleCard';
import type { ChatMessage } from '@/store/types';
import { AGENT_ROSTER } from '@/store/agentStore';
import { buildRoleLayer } from './layers/roleLayer';
import { buildProjectLayer } from './layers/projectLayer';
import { buildTeamLayer } from './layers/teamLayer';
import { buildProjectStatusLayer } from './layers/projectStatusLayer';
import { buildHistoryLayer } from './layers/historyLayer';
import { buildTaskContextLayer } from './layers/taskContextLayer';
import { buildUserMessageLayer } from './layers/userMessageLayer';
import { buildBehaviorLayer } from './layers/behaviorLayer';
import { buildSkillLayer } from './layers/skillLayer';
import { buildToolLayer } from './layers/toolLayer';
import { buildProtocolLayer, deriveRoleFromCard } from './layers/protocolLayer';

export interface ParamDef {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ParamDef[];
  handler: string;
}

export interface SkillSummary {
  name: string;
  content: string;
  files?: { path: string; content: string }[];
  config?: string;
}

export function extractToolsFromSkills(skills: SkillSummary[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const skill of skills) {
    if (!skill.config) continue;
    try {
      const parsed = JSON.parse(skill.config);
      if (Array.isArray(parsed.tools)) {
        tools.push(...parsed.tools);
      }
    } catch {
      // invalid config JSON — skip
    }
  }
  return tools;
}

export interface ComposeOptions {
  agent: { id: string; name: string };
  roleCard?: RoleCard;
  allRoleCards: RoleCard[];
  project: { name: string; path: string };
  isFirstWake: boolean;
  messages?: ChatMessage[];
  task?: { id: string; title: string; description?: string; phase?: { title: string } };
  rawPrompt: string;
  currentLoad?: Record<string, number>;
  tasks?: { id: string; title: string; agentId: string; status: string }[];
  skills?: SkillSummary[];
}

export function composeSystemPrompt(opts: ComposeOptions): string | undefined {
  if (!opts.isFirstWake) return undefined;

  const projectStatus = opts.tasks
    ? buildProjectStatusLayer(
        AGENT_ROSTER.map((a) => ({ id: a.id, name: a.name, emoji: a.emoji })),
        opts.tasks as Parameters<typeof buildProjectStatusLayer>[1],
      )
    : '';

  return [
    buildRoleLayer(opts.agent, opts.roleCard),
    buildProjectLayer(opts.project),
    buildTeamLayer(opts.agent.id, opts.allRoleCards, opts.currentLoad),
    projectStatus,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function composeUserPrompt(opts: ComposeOptions): string {
  const parts: string[] = [];

  // Skills + tools (every dispatch — CLI is a new process)
  const tools = extractToolsFromSkills(opts.skills ?? []);
  const skillLayer = buildSkillLayer(opts.skills ?? []);
  const toolLayer = buildToolLayer(tools);
  if (skillLayer) parts.push(skillLayer);
  if (toolLayer) parts.push(toolLayer);

  // Protocol layer (every dispatch — constraints + guidance)
  const protocol = buildProtocolLayer({
    agentId: opts.agent.id,
    agentRole: deriveRoleFromCard(opts.roleCard),
    projectPath: opts.project.path,
    hasTaskAssignment: !!opts.task,
    isPlanner: opts.roleCard?.category === 'planner',
  });
  if (protocol) parts.push(protocol);

  // History (every dispatch — future: add compression)
  const history = buildHistoryLayer(opts.messages ?? [], opts.agent.id);
  if (history) parts.push(history);

  // Task context + user message + behavior
  if (opts.task) {
    parts.push(buildTaskContextLayer(opts.task));
  }
  parts.push(buildUserMessageLayer(opts.rawPrompt));
  parts.push(buildBehaviorLayer());

  return parts.join('\n\n---\n\n');
}
```

- [ ] **Step 2: Run existing promptComposer tests**

Run: `npx vitest run src/__tests__/agent-context/promptComposer.test.ts`

If any tests fail due to the moved layers (skillLayer/toolLayer now in user prompt), update the test expectations to match the new structure. The key change: `composeSystemPrompt` no longer includes skills/tools, and `composeUserPrompt` now includes them plus protocolLayer.

- [ ] **Step 3: Fix any test failures**

Tests that assert `composeSystemPrompt` includes skill/tool content need to be updated to check `composeUserPrompt` instead. Tests that check `composeUserPrompt` output need to account for the new skill/tool/protocol layers appearing before history.

- [ ] **Step 4: Run all agent-context tests**

Run: `npx vitest run src/__tests__/agent-context/`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-context/PromptComposer.ts src/__tests__/agent-context/promptComposer.test.ts
git commit -m "refactor: split prompt layers — persona in system, context in user prompt"
```

---

## Task 5: TaskFileWatcher — file change → DB sync

**Files:**
- Create: `src/server/task-file-watcher.ts`

- [ ] **Step 1: Implement TaskFileWatcher**

Create `src/server/task-file-watcher.ts`:

```ts
import chokidar from 'chokidar';
import { readTasksMd } from './task-file-service';
import { taskRepo } from './repositories/task-repo';
import type { IOServer } from 'socket.io';

const watchers = new Map<string, chokidar.FSWatcher>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function startTaskWatcher(projectPath: string, io: IOServer): void {
  if (watchers.has(projectPath)) return;

  const tasksFile = `${projectPath}/.ath/TASKS.md`;
  const watcher = chokidar.watch(tasksFile, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500 },
  });

  watcher.on('change', () => {
    if (debounceTimers.has(projectPath)) clearTimeout(debounceTimers.get(projectPath)!);
    debounceTimers.set(projectPath, setTimeout(() => {
      debounceTimers.delete(projectPath);
      syncTasksToDb(projectPath, io);
    }, 500));
  });

  watchers.set(projectPath, watcher);
}

export function stopTaskWatcher(projectPath: string): void {
  const watcher = watchers.get(projectPath);
  if (watcher) {
    watcher.close();
    watchers.delete(projectPath);
  }
  const timer = debounceTimers.get(projectPath);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(projectPath);
  }
}

function syncTasksToDb(projectPath: string, io: IOServer): void {
  const parsed = readTasksMd(projectPath);
  if (parsed.length === 0) return;

  for (const t of parsed) {
    const existing = taskRepo.getById(t.id);
    if (!existing) continue;

    const dbStatus = t.status; // already mapped by parseTasksMd
    if (existing.status !== dbStatus) {
      taskRepo.updateStatus(t.id, dbStatus);
    }
    if (t.agent && existing.agent_id !== t.agent) {
      taskRepo.update(t.id, { agent_id: t.agent });
    }
  }

  io.emit('task.sync', {
    projectPath,
    tasks: parsed,
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit src/server/task-file-watcher.ts 2>&1 | head -20`

Fix any type errors. The watcher depends on `IOServer` type from `socket.io`.

- [ ] **Step 3: Commit**

```bash
git add src/server/task-file-watcher.ts
git commit -m "feat: add TaskFileWatcher with chokidar → DB sync → Socket.IO broadcast"
```

---

## Task 6: Task lifecycle — exit=0 auto-advance + confirmBreakdown dispatch

**Files:**
- Modify: `src/store/taskHubStore.ts:1245` (terminal:exit handler)
- Modify: `src/store/taskStore.ts:298-398` (confirmBreakdown)

- [ ] **Step 1: Add exit=0 → in_review in terminal:exit handler**

In `src/store/taskHubStore.ts`, find the `terminal:exit` handler around line 1245. After the existing `code !== 0` block (which ends around line 1267), add the success path:

Find this block (around lines 1245-1267):
```ts
  if (typeof code === 'number' && code !== 0 && taskId && conversationId) {
    // ... existing failure handling ...
  }
```

Insert immediately after the closing `}` of that block (before line 1269 `const exitProjectId`):

```ts
  // Auto-advance: CLI exit=0 → task in_review
  if (code === 0 && taskId) {
    const task = store.getTaskById(taskId);
    if (task && task.status === 'in_progress') {
      store.updateTaskStatus(taskId, 'in_review');
    }
  }
```

- [ ] **Step 2: Add .ath/ writing + Planner dispatch to confirmBreakdown**

In `src/store/taskStore.ts`, find `confirmBreakdown` (line 298). After the line `get().setBreakdownStatus(conversationId, 'confirmed');` (around line 369), add:

```ts
      // Write .ath/ files
      const { initProjectDir, writeTasksMd } = await import('@/server/task-file-service');
      const conv = get().conversations.find((c: any) => c.id === conversationId);
      const projectPath = conv?.projectPath || process.cwd();

      initProjectDir(projectPath, {
        name: conv?.title || 'Project',
        goal: conv?.goal || '',
        techStack: ['Next.js', 'TypeScript', 'SQLite'],
        constraints: ['All existing tests must pass'],
      });

      const allNewTasks = get().tasks.filter((t: any) => t.conversationId === conversationId);
      writeTasksMd(projectPath, allNewTasks.map((t: any) => ({
        id: t.id,
        title: t.title,
        role: t.agentId === 'mario' ? 'planner' : t.agentId === 'toad' ? 'testing' : t.agentId === 'peach' ? 'frontend' : t.agentId === 'dk' ? 'security' : t.agentId === 'yoshi' ? 'devops' : 'backend',
        agent: t.agentId || '',
        status: t.status,
        depends: t.dependencies || [],
        deliverable: '',
        level: 'L2',
      })));

      // Dispatch Planner to drive task assignment
      const totalTaskCount = enriched.reduce((sum, p) => sum + p.tasks.length, 0);
      get().dispatchToAgent({
        agentId: 'mario',
        prompt: `任务分解已完成，共 ${totalTaskCount} 个任务已写入 .ath/TASKS.md。请：
1. 读取 .ath/TASKS.md 确认任务清单
2. 按优先级和依赖关系，逐个使用 task_assign 工具将任务分配给对应 Agent
3. task_assign 会自动触发目标 Agent 的 dispatch`,
      });
```

Note: `confirmBreakdown` may need to become `async` for the dynamic import. Check if the store action type allows this. If not, use synchronous `require` or top-level import.

- [ ] **Step 3: Run the app to verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: no errors related to modified files

- [ ] **Step 4: Commit**

```bash
git add src/store/taskHubStore.ts src/store/taskStore.ts
git commit -m "feat: exit=0 auto-advances task to in_review, confirmBreakdown writes .ath/ and dispatches Planner"
```

---

## Task 7: task_assign triggers real dispatch

**Files:**
- Modify: `src/pages/api/mutations.ts:167-196`

- [ ] **Step 1: Expand the task_assign handler**

In `src/pages/api/mutations.ts`, find the `task_assign` handler (around line 189). Replace:

```ts
        } else if (toolName === 'task_assign') {
          taskRepo.update(input.task_id, { agent_id: input.agent_id });
          res.json({ ok: true });
        }
```

With:

```ts
        } else if (toolName === 'task_assign') {
          taskRepo.update(input.task_id, { agent_id: input.agent_id });

          // Update .ath/TASKS.md
          const { updateTaskInMd } = await import('@/server/task-file-service');
          const projectId = (payload as any).projectId || (payload as any).conversationId || 'default';
          updateTaskInMd(projectId, input.task_id, { agent: input.agent_id });

          res.json({ ok: true });
          // Broadcast task.assigned after response
          // The store listens for this event to trigger dispatchToAgent
          if ((global as any).__io) {
            (global as any).__io.emit('task.assigned', {
              taskId: input.task_id,
              agentId: input.agent_id,
              conversationId: (payload as any).conversationId,
            });
          }
        }
```

- [ ] **Step 2: Add task.assigned listener in store**

In `src/store/taskHubStore.ts`, after the existing socket event listeners (after the `terminal:exit` block around line 1284), add:

```ts
socket.on('task.assigned', ({ taskId, agentId, conversationId }: { taskId: string; agentId: string; conversationId: string }) => {
  const store = useTaskHubStore.getState();
  const task = store.getTaskById(taskId);
  if (!task) return;

  // Update local store
  useTaskHubStore.setState((state) => ({
    tasks: state.tasks.map((t) =>
      t.id === taskId ? { ...t, agentId, updatedAt: new Date().toISOString() } : t
    ),
  }));

  // Dispatch the target agent
  store.dispatchToAgent({
    agentId,
    referencedTaskId: taskId,
    prompt: `你被分配了 ${taskId}: ${task.title}. ${task.description || ''}`,
  });
});

socket.on('task.sync', ({ projectPath, tasks: syncedTasks }: { projectPath: string; tasks: any[] }) => {
  const store = useTaskHubStore.getState();
  for (const synced of syncedTasks) {
    const existing = store.getTaskById(synced.id);
    if (!existing) continue;
    if (existing.status !== synced.status || existing.agentId !== synced.agent) {
      useTaskHubStore.setState((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === synced.id
            ? { ...t, status: synced.status, agentId: synced.agent || t.agentId, updatedAt: new Date().toISOString() }
            : t
        ),
      }));
    }
  }
});
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/mutations.ts src/store/taskHubStore.ts
git commit -m "feat: task_assign updates .ath/ and broadcasts task.assigned for auto-dispatch"
```

---

## Task 8: TaskStatusCard component

**Files:**
- Create: `src/components/task-hub/TaskStatusCard.tsx`

- [ ] **Step 1: Implement TaskStatusCard**

Create `src/components/task-hub/TaskStatusCard.tsx`:

```tsx
'use client';

import { cn } from '@/lib/utils';
import { StatusBadge } from './StatusBadge';
import { useTaskHubStore } from '@/store/taskHubStore';
import { AGENT_ROSTER } from '@/store/agentStore';
import { format } from 'date-fns';

interface TaskStatusCardProps {
  taskId: string;
  agentId: string;
  title: string;
  status: string;
  timestamp: string;
}

const AGENT_COLORS: Record<string, string> = {
  mario: 'var(--agent-opus)',
  luigi: 'var(--agent-codex)',
  toad: 'var(--agent-gemini)',
  peach: 'var(--agent-owner)',
  dk: 'var(--agent-opus)',
  yoshi: 'var(--agent-codex)',
};

export function TaskStatusCard({ taskId, agentId, title, status, timestamp }: TaskStatusCardProps) {
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);
  const agent = AGENT_ROSTER.find((a) => a.id === agentId);
  const emoji = agent?.emoji || '🤖';
  const borderColor = AGENT_COLORS[agentId] || 'var(--border)';
  const timeStr = timestamp ? format(new Date(timestamp), 'HH:mm') : '';

  return (
    <button
      type="button"
      onClick={() => setSelectedTaskId(taskId)}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border-l-2 bg-card px-3 py-2 text-left',
        'transition-opacity opacity-0 animate-in fade-in duration-150',
        'hover:bg-muted cursor-pointer',
      )}
      style={{ borderLeftColor: borderColor }}
    >
      <span className="text-sm">
        {emoji} {agentId}
      </span>
      <span className="flex-1 truncate text-sm font-medium">{taskId}: {title}</span>
      <StatusBadge status={status as any} compact />
      <span className="text-xs text-muted-foreground">{timeStr}</span>
    </button>
  );
}
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit 2>&1 | grep TaskStatusCard`
Expected: no output (no errors)

- [ ] **Step 3: Commit**

```bash
git add src/components/task-hub/TaskStatusCard.tsx
git commit -m "feat: add TaskStatusCard for chat status updates"
```

---

## Task 9: Wire TaskStatusCard into ChatMessageItem

**Files:**
- Modify: `src/components/task-hub/ChatMessageItem.tsx`

- [ ] **Step 1: Import TaskStatusCard**

In `src/components/task-hub/ChatMessageItem.tsx`, add to the imports:

```ts
import { TaskStatusCard } from './TaskStatusCard';
```

- [ ] **Step 2: Add rendering for task status events**

Inside the `ChatMessageItem` component, find where the message bubble is rendered. Before the main bubble rendering, add a check for task status events:

```tsx
  // Task status card rendering
  if (message.intent === 'task_status') {
    return (
      <div className="py-1">
        <TaskStatusCard
          taskId={message.metadata?.taskId || ''}
          agentId={message.agentId === 'system' ? (message.metadata?.agentId || '') : message.agentId}
          title={message.metadata?.title || ''}
          status={message.metadata?.status || ''}
          timestamp={message.timestamp}
        />
      </div>
    );
  }
```

Note: the exact location depends on the current ChatMessageItem structure. Look for the main return statement and add this conditional before it.

- [ ] **Step 3: Verify the app builds**

Run: `npx next build 2>&1 | tail -20`
Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/components/task-hub/ChatMessageItem.tsx
git commit -m "feat: render TaskStatusCard in chat for task status change events"
```

---

## Task 10: Dependency resolution in TaskFileWatcher

**Files:**
- Modify: `src/server/task-file-watcher.ts`

- [ ] **Step 1: Add dependency check to syncTasksToDb**

In `src/server/task-file-watcher.ts`, update the `syncTasksToDb` function to detect newly-done tasks and check their dependents:

```ts
function syncTasksToDb(projectPath: string, io: IOServer): void {
  const parsed = readTasksMd(projectPath);
  if (parsed.length === 0) return;

  const newlyDone: string[] = [];

  for (const t of parsed) {
    const existing = taskRepo.getById(t.id);
    if (!existing) continue;

    if (existing.status !== t.status) {
      taskRepo.updateStatus(t.id, t.status);
      if (t.status === 'done') newlyDone.push(t.id);
    }
    if (t.agent && existing.agent_id !== t.agent) {
      taskRepo.update(t.id, { agent_id: t.agent });
    }
  }

  // Dependency resolution: check if any todo tasks are now unblocked
  for (const doneId of newlyDone) {
    for (const t of parsed) {
      if (t.depends.includes(doneId) && t.status === 'pending' && t.agent) {
        const allDone = t.depends.every((depId) => {
          const dep = parsed.find((p) => p.id === depId);
          return dep?.status === 'done';
        });
        if (allDone) {
          io.emit('task.ready', { taskId: t.id, agentId: t.agent, projectPath });
        }
      }
    }
  }

  io.emit('task.sync', { projectPath, tasks: parsed });
}
```

- [ ] **Step 2: Add task.ready listener in store**

In `src/store/taskHubStore.ts`, after the `task.sync` listener, add:

```ts
socket.on('task.ready', ({ taskId, agentId }: { taskId: string; agentId: string }) => {
  const store = useTaskHubStore.getState();
  const task = store.getTaskById(taskId);
  if (!task || task.status !== 'pending') return;

  store.updateTaskStatus(taskId, 'in_progress');
  store.dispatchToAgent({
    agentId,
    referencedTaskId: taskId,
    prompt: `依赖已满足，开始执行 ${taskId}: ${task.title}. ${task.description || ''}`,
  });
});
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/server/task-file-watcher.ts src/store/taskHubStore.ts
git commit -m "feat: add dependency resolution — auto-dispatch when deps are done"
```

---

## Task 11: Wire FileWatcher into daemon lifecycle

**Files:**
- Modify: `src/server/daemon.ts`

- [ ] **Step 1: Import and start/stop watcher in daemon**

In `src/server/daemon.ts`, add the import near the top:

```ts
import { startTaskWatcher, stopTaskWatcher } from './task-file-watcher';
```

Find where the daemon registers handlers (the main `registerDaemon` function). After the existing Socket.IO event registration, add watcher lifecycle:

- When a `terminal:start` event fires and the project has a `.ath/` directory, call `startTaskWatcher(workdir, io)`.
- Find the project path from the `TerminalStartPayload.projectId` or from `WorkdirManager`.

Locate the `terminal:start` handler and after `const workdir = ...` (where the working directory is resolved), add:

```ts
    // Start file watcher for this project's .ath/ directory
    if (workdir) {
      startTaskWatcher(workdir, io);
    }
```

- [ ] **Step 2: Verify daemon starts without errors**

Run: `npx tsc --noEmit 2>&1 | grep daemon`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/server/daemon.ts
git commit -m "feat: wire TaskFileWatcher into daemon lifecycle"
```

---

## Task 12: Emit task status cards on status changes

**Files:**
- Modify: `src/store/taskStore.ts` (updateTaskStatus)

- [ ] **Step 1: Add task_status message emission**

In `src/store/taskStore.ts`, find the `updateTaskStatus` action. After the existing `addEvent` call (which emits `task.status_changed`), add a chat message with `intent: 'task_status'`:

After the line that calls `get().addEvent(...)` in updateTaskStatus, add:

```ts
      // Emit task status card in chat
      const task = get().getTaskById(taskId);
      if (task) {
        const convId = task.conversationId;
        const msg = {
          id: `msg-${Date.now()}-ts-${taskId}`,
          agentId: task.agentId || 'system',
          content: `${taskId} status → ${status}`,
          timestamp: new Date().toISOString(),
          intent: 'task_status' as const,
          conversationId: convId,
          metadata: { taskId, title: task.title, status, agentId: task.agentId },
        };
        set((s: any) => ({
          chatMessagesByConversation: {
            ...s.chatMessagesByConversation,
            [convId]: [...(s.chatMessagesByConversation[convId] || []), msg],
          },
        }));
      }
```

Note: this requires the `ChatMessage` type to support `metadata` and `intent: 'task_status'`. Check the type definition in `src/store/types.ts` and add `metadata?: Record<string, string>` and `'task_status'` to the `intent` union if not already present.

- [ ] **Step 2: Update ChatMessage type if needed**

In `src/store/types.ts`, ensure the `ChatMessage.intent` type includes `'task_status'` and there is a `metadata?: Record<string, any>` field.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/store/taskStore.ts src/store/types.ts
git commit -m "feat: emit task_status chat message on status changes for card rendering"
```

---

## Task 13: Full integration test

**Files:** None new — manual verification

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Create a project and trigger breakdown**

1. Open the app in browser
2. Create a new conversation
3. Send a message that triggers a breakdown proposal
4. Confirm the breakdown
5. Verify `.ath/` directory is created with 4 files
6. Verify Mario is dispatched with scheduler instructions

- [ ] **Step 3: Verify task lifecycle**

1. Check TASKS.md was written with correct task table
2. Verify Mario can use `task_assign` to assign a task
3. Verify target agent is dispatched
4. Verify agent reads TASKS.md and updates status
5. Verify kanban updates in real-time
6. Verify TaskStatusCard appears in chat

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: all tests pass

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete md-driven task dispatch system end-to-end"
```
