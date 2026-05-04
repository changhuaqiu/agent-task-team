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

  // Detect old format by scanning for header row with "Level" as last column
  let isOldFormat = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && (trimmed.includes('| ID') || trimmed.includes('|ID'))) {
      const headerCells = trimmed.split('|').map((c) => c.trim()).filter(Boolean);
      if (headerCells.length >= 8 && /^Level$/i.test(headerCells[headerCells.length - 1])) {
        isOldFormat = true;
      }
      break;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || trimmed.startsWith('|-') || trimmed.startsWith('| ID') || trimmed.startsWith('|ID')) continue;

    const cells = trimmed.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 8) continue;

    const id = cells[0];
    if (!id || (!id.includes('-') && !id.includes('.'))) continue;

    if (isOldFormat) {
      // Old format: ID | Title | Role | Agent | Status | Depends | Deliverable | Level
      tasks.push({
        id,
        title: cells[1],
        phase: '',
        role: cells[2],
        agent: cells[3] === '-' ? '' : cells[3],
        status: STATUS_MAP[cells[4]] ?? cells[4],
        depends: cells[5] === '-' ? [] : cells[5].split(',').map((s) => s.trim()),
        deliverable: cells[6] === '-' ? '' : cells[6],
      });
    } else {
      // New format: ID | Title | Phase | Role | Agent | Status | Depends | Deliverable
      tasks.push({
        id,
        title: cells[1],
        phase: cells[2] === '-' ? '' : cells[2],
        role: cells[3],
        agent: cells[4] === '-' ? '' : cells[4],
        status: STATUS_MAP[cells[5]] ?? cells[5],
        depends: cells[6] === '-' ? [] : cells[6].split(',').map((s) => s.trim()),
        deliverable: cells[7] === '-' ? '' : cells[7],
      });
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

export function updateTaskInMd(projectPath: string, taskId: string, updates: Partial<Pick<ParsedTask, 'status' | 'agent' | 'deliverable'>>): void {
  const { tasks, blockers } = readTasksMd(projectPath);
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return;
  Object.assign(tasks[idx], updates);
  writeTasksMd(projectPath, tasks, blockers);
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
