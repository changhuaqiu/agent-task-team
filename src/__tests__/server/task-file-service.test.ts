import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  parseTasksMd,
  formatTasksMd,
  parseBlockersMd,
  formatBlockersMd,
  readTasksMd,
  initProjectDir,
} from '@/server/task-file-service';

const TMP = join(__dirname, '__tmp_task_file_service__');

beforeEach(() => { mkdirSync(TMP, { recursive: true }); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('parseTasksMd', () => {
  it('parses new 8-col format with Phase', () => {
    const md = `# 任务看板

| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
|----|-------|-------|------|-------|--------|---------|-------------|
| TASK-001 | 拆分 Store | phase-1 | backend | luigi | doing | - | store slices |
| TASK-002 | 测试覆盖 | phase-1 | testing | - | todo | TASK-001 | - |
`;

    const tasks = parseTasksMd(md);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({
      id: 'TASK-001',
      title: '拆分 Store',
      phase: 'phase-1',
      role: 'backend',
      agent: 'luigi',
      status: 'in_progress',
      depends: [],
      deliverable: 'store slices',
    });
    expect(tasks[1].depends).toEqual(['TASK-001']);
    expect(tasks[1].agent).toBe('');
    expect(tasks[1].phase).toBe('phase-1');
  });

  it('parses old 8-col format with Level (backward compat)', () => {
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
      phase: '',
      role: 'backend',
      agent: 'luigi',
      status: 'in_progress',
      depends: [],
      deliverable: 'store slices',
    });
    expect(tasks[1].phase).toBe('');
  });

  it('returns empty array for markdown without table', () => {
    expect(parseTasksMd('# No tasks here\n')).toEqual([]);
  });

  it('skips separator rows', () => {
    const md = `| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |\n|----|-------|-------|------|-------|--------|---------|-------------|\n| TASK-001 | Foo | phase-1 | backend | - | todo | - | - |`;
    const tasks = parseTasksMd(md);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('TASK-001');
  });

  it('parses dot-separated IDs (1.1, 1.2, 2.1)', () => {
    const md = `# 任务看板

| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
|----|-------|-------|------|-------|--------|---------|-------------|
| 1.1 | Setup project | phase-1 | planner | mario | done | - | project init |
| 1.2 | Design UI | phase-1 | frontend | peach | doing | - | Figma mockup |
| 2.1 | Build API | phase-2 | backend | luigi | todo | - | REST endpoints |
`;

    const tasks = parseTasksMd(md);
    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toEqual({
      id: '1.1',
      title: 'Setup project',
      phase: 'phase-1',
      role: 'planner',
      agent: 'mario',
      status: 'done',
      depends: [],
      deliverable: 'project init',
    });
    expect(tasks[1]).toEqual({
      id: '1.2',
      title: 'Design UI',
      phase: 'phase-1',
      role: 'frontend',
      agent: 'peach',
      status: 'in_progress',
      depends: [],
      deliverable: 'Figma mockup',
    });
    expect(tasks[2]).toEqual({
      id: '2.1',
      title: 'Build API',
      phase: 'phase-2',
      role: 'backend',
      agent: 'luigi',
      status: 'pending',
      depends: [],
      deliverable: 'REST endpoints',
    });
  });
});

describe('formatTasksMd', () => {
  it('round-trips parse → format with phase field', () => {
    const original = [
      { id: 'TASK-001', title: 'Do thing', phase: 'phase-1', role: 'backend', agent: 'luigi', status: 'pending', depends: [], deliverable: '' },
    ];
    const md = formatTasksMd(original);
    const reparsed = parseTasksMd(md);
    expect(reparsed).toEqual(original);
  });

  it('round-trips with empty phase', () => {
    const original = [
      { id: 'TASK-002', title: 'Another task', phase: '', role: 'testing', agent: '', status: 'pending', depends: ['TASK-001'], deliverable: 'tests' },
    ];
    const md = formatTasksMd(original);
    const reparsed = parseTasksMd(md);
    expect(reparsed).toEqual(original);
  });
});

describe('parseBlockersMd', () => {
  it('parses risk/blocker section', () => {
    const md = `# 任务看板

| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
|----|-------|-------|------|-------|--------|---------|-------------|

## 风险 / 阻塞

| ID | Task | Type | Summary | Status |
|----|------|------|---------|--------|
| BLK-001 | TASK-001 | dependency | API not ready | open |
| BLK-002 | TASK-003 | technical | Memory leak | fixed |
`;

    const blockers = parseBlockersMd(md);
    expect(blockers).toHaveLength(2);
    expect(blockers[0]).toEqual({
      id: 'BLK-001',
      taskId: 'TASK-001',
      type: 'dependency',
      summary: 'API not ready',
      status: 'open',
    });
    expect(blockers[1]).toEqual({
      id: 'BLK-002',
      taskId: 'TASK-003',
      type: 'technical',
      summary: 'Memory leak',
      status: 'fixed',
    });
  });

  it('returns empty array when no risk section', () => {
    const md = `# 任务看板\n\nSome content without blockers.\n`;
    expect(parseBlockersMd(md)).toEqual([]);
  });

  it('stops parsing blockers at next ## heading', () => {
    const md = `## 风险 / 阻塞

| ID | Task | Type | Summary | Status |
|----|------|------|---------|--------|
| BLK-001 | TASK-001 | dependency | API not ready | open |

## 另一个章节

| ID | Task | Type | Summary | Status |
|----|------|------|---------|--------|
| BLK-999 | TASK-999 | other | should not parse | open |
`;

    const blockers = parseBlockersMd(md);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].id).toBe('BLK-001');
  });
});

describe('formatBlockersMd', () => {
  it('round-trips parseBlockersMd → formatBlockersMd', () => {
    const blockers = [
      { id: 'BLK-001', taskId: 'TASK-001', type: 'dependency', summary: 'API not ready', status: 'open' as const },
      { id: 'BLK-002', taskId: 'TASK-003', type: 'technical', summary: 'Memory leak', status: 'fixed' as const },
    ];
    const md = formatBlockersMd(blockers);
    const reparsed = parseBlockersMd(md);
    expect(reparsed).toEqual(blockers);
  });

  it('returns empty string for empty blockers array', () => {
    expect(formatBlockersMd([])).toBe('');
  });
});

describe('readTasksMd', () => {
  it('returns { tasks, blockers } from file', () => {
    const md = `# 任务看板

| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
|----|-------|-------|------|-------|--------|---------|-------------|
| TASK-001 | Do thing | phase-1 | backend | luigi | todo | - | - |

## 风险 / 阻塞

| ID | Task | Type | Summary | Status |
|----|------|------|---------|--------|
| BLK-001 | TASK-001 | dependency | API not ready | open |
`;

    const athDir = join(TMP, '.ath');
    mkdirSync(athDir, { recursive: true });
    writeFileSync(join(athDir, 'TASKS.md'), md, 'utf-8');

    const result = readTasksMd(TMP);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('TASK-001');
    expect(result.tasks[0].phase).toBe('phase-1');
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].id).toBe('BLK-001');
  });

  it('returns empty tasks and blockers when file does not exist', () => {
    const result = readTasksMd(TMP);
    expect(result).toEqual({ tasks: [], blockers: [] });
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

describe('parseTasksMd — checklist fallback', () => {
  it('parses markdown checkbox format', () => {
    const md = `# Tasks

- [ ] Build login page
- [x] Setup database
- [ ] Write unit tests
`;
    const tasks = parseTasksMd(md);
    expect(tasks).toHaveLength(3);
    expect(tasks[0].title).toBe('Build login page');
    expect(tasks[0].status).toBe('pending');
    expect(tasks[1].title).toBe('Setup database');
    expect(tasks[1].status).toBe('done');
    expect(tasks[2].id).toBe('TASK-003');
  });

  it('extracts task IDs from checkbox lines', () => {
    const md = `- [ ] TASK-001: Implement auth
- [x] BUG-7: Fix memory leak
`;
    const tasks = parseTasksMd(md);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe('TASK-001');
    expect(tasks[0].title).toBe('Implement auth');
    expect(tasks[1].id).toBe('BUG-7');
    expect(tasks[1].status).toBe('done');
  });

  it('parses status-prefix format', () => {
    const md = `- doing: Implement API endpoints
- done: Database schema
- blocked: Frontend deployment
`;
    const tasks = parseTasksMd(md);
    expect(tasks).toHaveLength(3);
    expect(tasks[0].status).toBe('in_progress');
    expect(tasks[0].title).toBe('Implement API endpoints');
    expect(tasks[1].status).toBe('done');
    expect(tasks[2].status).toBe('blocked');
  });

  it('does NOT use checklist fallback when table is present', () => {
    const md = `| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
|----|-------|-------|------|-------|--------|---------|-------------|
| TASK-001 | Real task | P1 | backend | luigi | doing | - | - |

- [ ] This should NOT be parsed
`;
    const tasks = parseTasksMd(md);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('TASK-001');
    expect(tasks[0].title).toBe('Real task');
  });

  it('handles partial table (fewer columns)', () => {
    const md = `| ID | Title | Agent | Status |
|----|-------|-------|--------|
| TASK-001 | Fix bug | mario | doing |
| TASK-002 | Add tests | toad | todo |
`;
    const tasks = parseTasksMd(md);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe('TASK-001');
    expect(tasks[0].status).toBe('in_progress');
    expect(tasks[1].status).toBe('pending');
  });
});
