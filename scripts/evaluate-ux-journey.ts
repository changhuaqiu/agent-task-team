import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { projectWorkItems, projectWorkSummary, resolveProjectWorkItem } from '../src/lib/project-work-items';
import { projectAttention } from '../src/lib/project-attention';
import type { Conversation, WorkspaceProject } from '../src/store/taskHubStore';
import type { Task } from '../src/store/taskStore';

const baselineRevision = 'c507451';
const oldSidebar = execFileSync('git', ['show', baselineRevision + ':src/components/project/ProjectSidebar.tsx'], { encoding: 'utf8' });
const oldOverview = execFileSync('git', ['show', baselineRevision + ':src/components/project/ProjectOverviewSurface.tsx'], { encoding: 'utf8' });
if (!oldSidebar.includes('for (const task of tasks)') || !oldOverview.includes("['ready', 'proposed', 'in_progress']")) throw new Error('Baseline source contract changed');
const now = '2026-09-06T00:00:00.000Z';
const project: WorkspaceProject = { id: 'p', name: 'Fixture', rootPath: 'C:/fixture', workspaceConversationId: 'legacy', createdAt: now, updatedAt: now };
function conversation(id: string, kind: Conversation['workspaceKind'], rootTaskId?: string): Conversation {
  return { id, projectId: 'p', workspaceKind: kind, rootTaskId, title: id, goal: '', status: 'active', priority: 'p2', projectPath: project.rootPath, breakdownStatus: 'none', createdAt: now, updatedAt: now };
}
function task(id: string, conversationId: string, status: Task['status']): Task {
  return { id, conversationId, title: id, status, phaseId: '', description: '', agentId: '', dependencies: [], artifacts: [], createdAt: now, updatedAt: now, revision: 1 };
}
const conversations = [conversation('legacy', 'project_workspace'), conversation('work', 'workstream', 'root'), conversation('pending', 'workstream')];
const tasks = [task('a', 'legacy', 'ready'), task('b', 'legacy', 'done'), task('root', 'work', 'in_progress'), ...Array.from({ length: 10 }, (_, i) => task('child-' + i, 'work', i === 0 ? 'blocked' : 'done'))];
const items = projectWorkItems(project, conversations, tasks);
const summary = projectWorkSummary(items);
const cases = [
  { metric: 'sidebar_work_count', expected: 4, baseline: tasks.length, candidate: summary.total },
  { metric: 'actually_in_progress', expected: 1, baseline: items.filter((item) => ['ready', 'proposed', 'in_progress'].includes(item.status)).length, candidate: summary.active },
  { metric: 'current_blocked_tasks_visible', expected: 1, baseline: items.filter((item) => item.status === 'blocked').length, candidate: projectAttention(items).length },
];
const exactTargets = [['legacy', 'a', 'a'], ['legacy', 'b', 'b'], ['work', 'child-0', 'root'], ['pending', 'pending', 'pending'], ['legacy', 'child-0', null]].map(([conversationId, taskId, expected]) => ({ conversationId, taskId, expected, actual: resolveProjectWorkItem(items, { conversationId: conversationId!, taskId: taskId! })?.id ?? null }));
const result = {
  evaluation: 'UX-JOURNEY-2026-09-06', level: 'C', baselineRevision,
  candidateSourceSha256: createHash('sha256').update(readFileSync('src/lib/project-work-items.ts')).update(readFileSync('src/lib/project-attention.ts')).digest('hex'),
  fixture: { workItems: items.length, tasks: tasks.length, hasUnplannedWork: true, hasLegacySharedScope: true },
  cases, exactTargets, baselineCountCasesPassed: cases.filter((item) => item.baseline === item.expected).length,
  candidateCountCasesPassed: cases.filter((item) => item.candidate === item.expected).length,
  limitations: ['Deterministic projection comparison, not human usability timing.', 'No live Agent runs; no task-completion-rate claim.', 'Navigation baseline assessed in audit/component regressions, not synthesized as a numeric success rate.'],
};
mkdirSync('docs/technical/evaluation/raw', { recursive: true });
writeFileSync('docs/technical/evaluation/raw/2026-09-06-ux-journey.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (cases.some((item) => item.candidate !== item.expected) || exactTargets.some((item) => item.actual !== item.expected)) process.exitCode = 1;
