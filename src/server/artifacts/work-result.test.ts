import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { projectRepo } from '../repositories/project-repo';
import { taskRepo } from '../repositories/task-repo';
import { conversationRepo } from '../repositories/conversation-repo';
import { qualityGateRepo } from '../quality-gate/repository';
import { readWorkResult, redactResultStrings } from './work-result';
beforeEach(() => setTestDb(createTestDb()));
afterEach(() => resetDb());
describe('read-only work results', () => {
  it('redacts bundle fields without truncating or flattening the DTO structure', () => {
    const safe = redactResultStrings({ summary: 'api_key=secret-value', acceptanceResults: [{ status: 'passed', evidenceRefs: ['sk-abcdefghijklmnopqrstuvwx'] }], number: 3 });
    expect(safe.number).toBe(3);
    expect(safe.acceptanceResults[0].status).toBe('passed');
    expect(JSON.stringify(safe)).not.toContain('secret-value');
    expect(JSON.stringify(safe)).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });
  it('reads old work without creating a new project or pretending a gate exists', () => {
    const p = projectRepo.create({ name: 'Legacy', rootPath: 'C:/legacy' });
    taskRepo.create({ id: 'old', conversation_id: p.workspace_conversation_id, title: 'Old work', agent_id: 'builder' });
    const result = readWorkResult(p.id, p.workspace_conversation_id, 'old');
    expect(result.gates).toEqual([]);
    expect(result.bundles).toEqual([]);
    expect(result.limitations[0]).toContain('不等于');
  });
  it('includes only decision-accepted evidence and keeps legacy tasks separate', () => {
    const p = projectRepo.create({ name: 'Legacy', rootPath: 'C:/legacy' });
    const conv = p.workspace_conversation_id;
    for (const id of ['a', 'b']) taskRepo.create({ id, conversation_id: conv, title: id, agent_id: 'builder' });
    const gate = qualityGateRepo.request({ conversationId: conv, kind: 'code_review', targetType: 'task', targetId: 'a', artifactRevision: 'sha-old', criteria: { blockers: 0 }, actor: { type: 'agent', id: 'builder' } });
    const included = qualityGateRepo.submitEvidence({ gateId: gate.gate.id, evidenceType: 'review', payload: { evidenceRefs: ['reports/review.md'], api_key: 'never-show-this' }, actor: { type: 'agent', id: 'reviewer' }, idempotencyKey: 'e1' });
    qualityGateRepo.submitEvidence({ gateId: gate.gate.id, evidenceType: 'review', payload: { evidenceRefs: ['unaccepted.md'] }, actor: { type: 'agent', id: 'reviewer' }, idempotencyKey: 'e2' });
    const evaluating = qualityGateRepo.beginEvaluation({ gateId: gate.gate.id, evaluator: { type: 'agent', id: 'reviewer' }, expectedRevision: gate.gate.revision });
    qualityGateRepo.decide({ gateId: gate.gate.id, decision: 'passed', evaluator: { type: 'agent', id: 'reviewer' }, evidenceIds: [included.id], expectedRevision: evaluating.gate.revision });
    const result = readWorkResult(p.id, conv, 'a');
    expect(result.gates).toHaveLength(1);
    expect(result.gates[0]).toMatchObject({ artifactRevision: 'sha-old', status: 'passed', evidence: [{ id: included.id, refs: ['reports/review.md'] }] });
    expect(JSON.stringify(result)).not.toContain('never-show-this');
    expect(JSON.stringify(result)).not.toContain('unaccepted.md');
    expect(readWorkResult(p.id, conv, 'b').gates).toEqual([]);
  });
  it('rejects mismatched project and conversation identities', () => {
    const p = projectRepo.create({ name: 'One', rootPath: 'C:/one' });
    const q = projectRepo.create({ name: 'Two', rootPath: 'C:/two' });
    const conv = conversationRepo.create({ id: 'work', title: 'Work', project_id: p.id, workspace_kind: 'workstream' });
    taskRepo.create({ id: 't', conversation_id: conv.id, title: 'T', agent_id: 'builder' });
    expect(() => readWorkResult(q.id, conv.id, 't')).toThrow('work_result_not_found');
    expect(() => readWorkResult(p.id, p.workspace_conversation_id, 't')).toThrow('work_result_not_found');
  });
});
