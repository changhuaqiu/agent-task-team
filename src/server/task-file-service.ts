import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

export interface ParsedTask {
  id: string;
  title: string;
  phase: string;
  role: string;
  agent: string;
  status: string;
  depends: string[];
  deliverable: string;
}

export interface ParsedBlocker {
  id: string;
  taskId: string;
  type: string;
  summary: string;
  status: 'open' | 'fixed';
}

export interface ProjectMeta {
  name: string;
  goal: string;
  techStack: string[];
  constraints: string[];
}

export interface TaskProjectionSource {
  id: string;
  title: string;
  status: string;
  agent_id: string;
  dependencies: string | null;
}

const STATUS_MAP: Record<string, string> = {
  todo: 'pending',
  pending: 'pending',
  doing: 'in_progress',
  in_progress: 'in_progress',
  'in progress': 'in_progress',
  wip: 'in_progress',
  review: 'in_review',
  in_review: 'in_review',
  'in review': 'in_review',
  done: 'done',
  completed: 'done',
  blocked: 'blocked',
  rejected: 'rejected',
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

  // Detect format by scanning header row
  let isOldFormat = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && /\bID\b/i.test(trimmed)) {
      const headerCells = trimmed.split('|').map((c) => c.trim().toLowerCase()).filter(Boolean);
      if (headerCells.length >= 8 && headerCells[headerCells.length - 1] === 'level') {
        isOldFormat = true;
      }
      break;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Stop parsing tasks at section boundaries (blockers, notes, etc.)
    if (/^##\s/.test(trimmed)) break;
    if (!trimmed.startsWith('|')) continue;
    // Skip header and separator rows
    if (/^\|[\s-|:]+$/.test(trimmed)) continue;
    if (/\bID\b/i.test(trimmed) && /\bTitle\b/i.test(trimmed)) continue;

    const cells = trimmed.split('|').map((c) => c.trim()).filter(Boolean);
    // Relaxed: accept rows with at least 2 cells (ID + Title minimum)
    if (cells.length < 2) continue;

    const id = cells[0];
    if (!id) continue;
    // Accept any ID that looks task-like: contains dash, dot, or TASK prefix
    if (!id.includes('-') && !id.includes('.') && !/^TASK/i.test(id) && !/^\w+-\d+/.test(id)) continue;

    // Helper to safely get cell value with default
    const cell = (idx: number, fallback = ''): string => {
      const val = cells[idx];
      if (!val || val === '-') return fallback;
      return val;
    };

    const normalizeStatus = (raw: string): string => {
      const key = raw.toLowerCase().trim();
      return STATUS_MAP[key] ?? (key || 'pending');
    };

    const parseDeps = (raw: string): string[] => {
      if (!raw || raw === '-') return [];
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    };

    if (isOldFormat) {
      // Old format: ID | Title | Role | Agent | Status | Depends | Deliverable | Level
      tasks.push({
        id,
        title: cell(1, id),
        phase: '',
        role: cell(2),
        agent: cell(3),
        status: normalizeStatus(cell(4, 'todo')),
        depends: parseDeps(cell(5)),
        deliverable: cell(6),
      });
    } else if (cells.length >= 8) {
      // Full 8-column format: ID | Title | Phase | Role | Agent | Status | Depends | Deliverable
      tasks.push({
        id,
        title: cell(1, id),
        phase: cell(2),
        role: cell(3),
        agent: cell(4),
        status: normalizeStatus(cell(5, 'todo')),
        depends: parseDeps(cell(6)),
        deliverable: cell(7),
      });
    } else if (cells.length >= 6) {
      // Partial format (6-7 columns) — try to match by inferring columns
      // Heuristic: if cell[5] looks like a status, use positional mapping
      const possibleStatus = cells[5]?.toLowerCase().trim() || '';
      if (STATUS_MAP[possibleStatus] || possibleStatus === '') {
        // Likely: ID | Title | Phase | Role | Agent | Status [| Depends] [| Deliverable]
        tasks.push({
          id,
          title: cell(1, id),
          phase: cell(2),
          role: cell(3),
          agent: cell(4),
          status: normalizeStatus(cell(5, 'todo')),
          depends: parseDeps(cell(6)),
          deliverable: cell(7),
        });
      } else {
        // Likely: ID | Title | Agent | Status | Depends | Deliverable (minimal)
        tasks.push({
          id,
          title: cell(1, id),
          phase: '',
          role: '',
          agent: cell(2),
          status: normalizeStatus(cell(3, 'todo')),
          depends: parseDeps(cell(4)),
          deliverable: cell(5),
        });
      }
    } else if (cells.length >= 4) {
      // 4-5 columns: try to find which cell is the status
      // Check if cell[3] looks like a status → ID | Title | Agent | Status [| ...]
      const c3 = cells[3]?.toLowerCase().trim() || '';
      if (STATUS_MAP[c3]) {
        tasks.push({
          id,
          title: cell(1, id),
          phase: '',
          role: '',
          agent: cell(2),
          status: normalizeStatus(cell(3, 'todo')),
          depends: parseDeps(cell(4)),
          deliverable: cell(5),
        });
      } else {
        // cell[2] might be the status → ID | Title | Status | Agent
        const c2 = cells[2]?.toLowerCase().trim() || '';
        if (STATUS_MAP[c2]) {
          tasks.push({
            id,
            title: cell(1, id),
            phase: '',
            role: '',
            agent: cell(3),
            status: normalizeStatus(cell(2, 'todo')),
            depends: parseDeps(cell(4)),
            deliverable: '',
          });
        } else {
          // Default: ID | Title | col2 | col3 → treat as agent/status
          tasks.push({
            id,
            title: cell(1, id),
            phase: '',
            role: '',
            agent: cell(2),
            status: normalizeStatus(cell(3, 'todo')),
            depends: [],
            deliverable: '',
          });
        }
      }
    } else if (cells.length >= 3) {
      // 3 columns: ID | Title | Status (or Agent)
      const third = cells[2]?.toLowerCase().trim() || '';
      const isStatus = !!STATUS_MAP[third];
      tasks.push({
        id,
        title: cell(1, id),
        phase: '',
        role: '',
        agent: isStatus ? '' : cell(2),
        status: isStatus ? normalizeStatus(cell(2)) : 'pending',
        depends: [],
        deliverable: '',
      });
    } else {
      // 2 cells: ID | Title
      tasks.push({
        id,
        title: cell(1, id),
        phase: '',
        role: '',
        agent: '',
        status: 'pending',
        depends: [],
        deliverable: '',
      });
    }
  }

  // Fallback: parse markdown checklist format when table parse found nothing
  if (tasks.length === 0) {
    let seqNum = 1;
    for (const line of lines) {
      const trimmed = line.trim();
      // Match: - [ ] task  or  - [x] task  or  - [X] task
      const checkboxMatch = trimmed.match(/^-\s*\[([ xX])\]\s+(.+)$/);
      if (!checkboxMatch) {
        // Also match: - status: task title (e.g. "- doing: Implement API")
        const statusPrefixMatch = trimmed.match(/^-\s+(todo|doing|done|review|blocked|in_progress|pending):\s*(.+)$/i);
        if (statusPrefixMatch) {
          const rawStatus = statusPrefixMatch[1].toLowerCase();
          const title = statusPrefixMatch[2].trim();
          const idMatch = title.match(/^((?:TASK-\d+|[\w]+-\d+)[:\s])\s*(.*)$/i);
          const id = idMatch ? idMatch[1].replace(/[:\s]+$/, '') : `TASK-${String(seqNum).padStart(3, '0')}`;
          const cleanTitle = idMatch ? (idMatch[2] || title) : title;

          tasks.push({
            id,
            title: cleanTitle,
            phase: '',
            role: '',
            agent: '',
            status: STATUS_MAP[rawStatus] ?? 'pending',
            depends: [],
            deliverable: '',
          });
          seqNum++;
        }
        continue;
      }

      const isDone = checkboxMatch[1].toLowerCase() === 'x';
      const rawTitle = checkboxMatch[2].trim();

      // Try to extract ID prefix: "TASK-001: title" or "BUG-1: title"
      const idMatch = rawTitle.match(/^((?:TASK-\d+|[\w]+-\d+)[:\s])\s*(.*)$/i);
      const id = idMatch ? idMatch[1].replace(/[:\s]+$/, '') : `TASK-${String(seqNum).padStart(3, '0')}`;
      const cleanTitle = idMatch ? (idMatch[2] || rawTitle) : rawTitle;

      tasks.push({
        id,
        title: cleanTitle,
        phase: '',
        role: '',
        agent: '',
        status: isDone ? 'done' : 'pending',
        depends: [],
        deliverable: '',
      });
      seqNum++;
    }
  }

  return tasks;
}

export function formatTasksMd(tasks: ParsedTask[]): string {
  const header = `| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
|----|-------|-------|------|-------|--------|---------|-------------|`;

  const rows = tasks.map((t) => {
    const status = STATUS_REVERSE[t.status] ?? t.status;
    const phase = t.phase || '-';
    const agent = t.agent || '-';
    const depends = t.depends.length > 0 ? t.depends.join(',') : '-';
    const deliverable = t.deliverable || '-';
    return `| ${t.id} | ${t.title} | ${phase} | ${t.role} | ${agent} | ${status} | ${depends} | ${deliverable} |`;
  });

  return `# 任务看板\n\n${header}\n${rows.join('\n')}\n`;
}

export function parseBlockersMd(content: string): ParsedBlocker[] {
  const blockers: ParsedBlocker[] = [];
  const sectionRegex = /^##\s*风险\s*\/\s*阻塞/;
  const lines = content.split('\n');
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (sectionRegex.test(trimmed)) {
      inSection = true;
      continue;
    }

    // Stop at the next ## heading
    if (inSection && /^##\s/.test(trimmed)) {
      break;
    }

    if (!inSection) continue;

    if (!trimmed.startsWith('|') || trimmed.startsWith('|-') || trimmed.startsWith('| ID') || trimmed.startsWith('|ID')) continue;

    const cells = trimmed.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 5) continue;

    const id = cells[0];
    if (!id) continue;

    blockers.push({
      id,
      taskId: cells[1],
      type: cells[2],
      summary: cells[3] === '-' ? '' : cells[3],
      status: cells[4] === 'fixed' ? 'fixed' : 'open',
    });
  }

  return blockers;
}

export function formatBlockersMd(blockers: ParsedBlocker[]): string {
  if (blockers.length === 0) return '';

  const header = `## 风险 / 阻塞\n\n| ID | Task | Type | Summary | Status |\n|----|------|------|---------|--------|`;

  const rows = blockers.map((b) => {
    const summary = b.summary || '-';
    return `| ${b.id} | ${b.taskId} | ${b.type} | ${summary} | ${b.status} |`;
  });

  return `${header}\n${rows.join('\n')}\n`;
}

export function readTasksMd(projectPath: string): { tasks: ParsedTask[]; blockers: ParsedBlocker[] } {
  const filePath = join(projectPath, '.ath', 'TASKS.md');
  if (!existsSync(filePath)) return { tasks: [], blockers: [] };
  const content = readFileSync(filePath, 'utf-8');
  return {
    tasks: parseTasksMd(content),
    blockers: parseBlockersMd(content),
  };
}

export function writeTasksMd(projectPath: string, tasks: ParsedTask[], blockers?: ParsedBlocker[]): void {
  const dir = join(projectPath, '.ath');
  mkdirSync(dir, { recursive: true });
  let content = formatTasksMd(tasks);
  if (blockers && blockers.length > 0) {
    content += '\n' + formatBlockersMd(blockers);
  }
  writeFileSync(join(dir, 'TASKS.md'), content, 'utf-8');
}

function projectionDependencies(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
}

/** Materialize the compatibility task entry once without overwriting runtime edits. */
export function ensureTasksMdProjection(projectPath: string, rows: TaskProjectionSource[]): boolean {
  if (existsSync(join(projectPath, '.ath', 'TASKS.md'))) return false;
  writeTasksMd(projectPath, rows.map((row) => ({
    id: row.id,
    title: row.title,
    phase: '',
    role: 'worker',
    agent: row.agent_id,
    status: row.status,
    depends: projectionDependencies(row.dependencies),
    deliverable: '',
  })));
  return true;
}

export function updateTaskInMd(projectPath: string, taskId: string, updates: Partial<Pick<ParsedTask, 'status' | 'agent' | 'deliverable'>>): boolean {
  const { tasks, blockers } = readTasksMd(projectPath);
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return false;
  Object.assign(tasks[idx], updates);
  writeTasksMd(projectPath, tasks, blockers);
  return true;
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
