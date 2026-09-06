/**
 * Local UX fixture, not an Agent benchmark or production migration.
 * Requires explicit ATH_UX_FIXTURE=1 and refuses a database containing real projects.
 */
import path from 'node:path';
import { getDb } from '../src/server/db';
import { projectRepo } from '../src/server/repositories/project-repo';
import { conversationRepo } from '../src/server/repositories/conversation-repo';
import { taskRepo } from '../src/server/repositories/task-repo';
import { messageRepo } from '../src/server/repositories/message-repo';
import { qualityGateRepo } from '../src/server/quality-gate/repository';
import { PlatformEventLog } from '../src/server/platform-events/event-log';

if (process.env.ATH_UX_FIXTURE !== '1') throw new Error('Set ATH_UX_FIXTURE=1 only for the isolated evaluation checkout');
const projects = projectRepo.list();
const expectedRoot = path.resolve('.ath/ux-evaluation-project').replace(/\\/g, '/');
if (projects.length !== 1 || projects[0].name !== '体验评测 · 隔离样本' || projects[0].root_path !== expectedRoot) {
  throw new Error('Refusing to seed anything except the single explicitly named isolated fixture project');
}
const project = projects[0], db = getDb(), now = new Date().toISOString();
if (taskRepo.getById('ux-fixture-root')) throw new Error('Fixture already seeded; do not replay');
const conv = conversationRepo.getById('ux-fixture-work') ?? conversationRepo.create({ id: 'ux-fixture-work', title: '交付报告闭环（固定样本）', project_id: project.id, project_path: expectedRoot, workspace_kind: 'workstream' });
const rows = [
  { id: 'ux-legacy-a', conversation_id: project.workspace_conversation_id, title: '历史工作 A：待处理', status: 'ready' },
  { id: 'ux-legacy-b', conversation_id: project.workspace_conversation_id, title: '历史工作 B：查收验收', status: 'done' },
  { id: 'ux-fixture-root', conversation_id: conv.id, title: conv.title, status: 'in_progress' },
  ...Array.from({ length: 9 }, (_, index) => ({ id: 'ux-child-' + index, conversation_id: conv.id, title: index === 0 ? '核对报告：等待用户提供素材' : '执行步骤 ' + (index + 1), status: index === 0 ? 'blocked' : 'done' })),
];
for (const row of rows) {
  if (!taskRepo.getById(row.id)) taskRepo.create({ id: row.id, conversation_id: row.conversation_id, title: row.title, agent_id: '', description: '固定 UX 样本，不代表真实模型执行结果。' });
  // Seed presentation state directly. No task assignment or dispatch events.
  const steps = row.status === 'done' ? ['in_progress', 'in_review', 'done'] : [row.status];
  for (const status of steps) db.prepare('UPDATE task SET status=?,review_note=? WHERE id=?').run(status, status === 'blocked' ? '缺少用户提供的素材，请补充后再检查重试。' : null, row.id);
}
const action = 'ux-fixture-artifact-action';
new PlatformEventLog().append({ type: 'work.created', category: 'domain', projectId: conv.id, streamKey: 'work:ux-fixture-root', aggregate: { type: 'work', id: 'ux-fixture-root' }, subject: { type: 'work', id: 'ux-fixture-root' }, actor: { type: 'system', id: 'ux-fixture' }, correlationId: 'ux-fixture', payload: { title: conv.title } });
db.prepare('INSERT INTO task_action (id,conversation_id,actor_id,actor_type,type,task_ids,payload,created_at) VALUES (?,?,?,?,?,?,?,?)')
  .run(action, project.workspace_conversation_id, 'mario', 'agent', 'task.review_requested', '["ux-legacy-b"]', '{}', now);
db.prepare('INSERT INTO task_artifact_ref (id,conversation_id,task_id,kind,label,path,created_by_action_id,created_at) VALUES (?,?,?,?,?,?,?,?)')
  .run('ux-fixture-artifact', project.workspace_conversation_id, 'ux-legacy-b', 'file', '交付验收报告', 'acceptance.md', action, now);
const gate = qualityGateRepo.request({ conversationId: project.workspace_conversation_id, kind: 'acceptance_verification', targetType: 'task', targetId: 'ux-legacy-b', artifactRevision: 'fixture-v1-not-real-code', criteria: { reportSections: ['目标', '过程', '结果', '风险'] }, actor: { type: 'agent', id: 'mario' } });
const evidence = qualityGateRepo.submitEvidence({ gateId: gate.gate.id, evidenceType: 'ux_fixture_report', payload: { evidenceRefs: ['acceptance.md'], summary: '固定测试数据：四节俱全' }, actor: { type: 'agent', id: 'luigi' }, idempotencyKey: 'ux-fixture-evidence' });
const evaluating = qualityGateRepo.beginEvaluation({ gateId: gate.gate.id, evaluator: { type: 'agent', id: 'luigi' }, expectedRevision: gate.gate.revision });
qualityGateRepo.decide({ gateId: gate.gate.id, decision: 'passed', evaluator: { type: 'agent', id: 'luigi' }, evidenceIds: [evidence.id], expectedRevision: evaluating.gate.revision });
for (const content of ['已整理目标（样本）', '已核对四个章节（样本）', '报告可以查收；固定测试数据，不是真实执行。']) {
  messageRepo.append({ conversationId: conv.id, senderType: 'agent', senderId: 'mario', invocationId: 'ux-fixture-invocation', content });
}
console.log(JSON.stringify({ projectId: project.id, workConversationId: conv.id, rootId: 'ux-fixture-root', childId: 'ux-child-0', legacyConversationId: project.workspace_conversation_id, legacyA: 'ux-legacy-a', legacyB: 'ux-legacy-b', fixtureOnly: true }));
