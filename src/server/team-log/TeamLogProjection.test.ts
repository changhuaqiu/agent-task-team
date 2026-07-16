import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { messageRepo } from '../repositories/message-repo';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { TeamLogProjectionService, deriveMessageCategory, messageToTeamLogEntry } from './TeamLogProjection';

let workspace: string;

beforeEach(() => {
  setTestDb(createTestDb());
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ath-team-log-'));
});

afterEach(() => {
  resetDb();
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('TeamLogProjection', () => {
  it('derives category and audience from existing message fields', () => {
    expect(deriveMessageCategory({ sender_type: 'agent', intent: 'review', metadata: null })).toBe('review');
    const entry = messageToTeamLogEntry({
      id: 'msg-1',
      conversation_id: 'conv-1',
      task_id: 'TASK-1',
      sender_type: 'agent',
      sender_id: 'peach',
      content: '评审通过',
      content_type: 'text',
      mentions: '["luigi"]',
      intent: 'review',
      metadata: null,
      visibility: 'public',
      created_at: '2026-07-16T10:00:00.000Z',
    });
    expect(entry).toMatchObject({
      audience: ['luigi'],
      category: 'review',
      sender: { id: 'peach', label: '@peach' },
      taskId: 'TASK-1',
    });
    const privateEntry = messageToTeamLogEntry({
      id: 'msg-private',
      conversation_id: 'conv-1',
      task_id: null,
      sender_type: 'agent',
      sender_id: 'peach',
      content: 'private note',
      content_type: 'text',
      mentions: null,
      intent: null,
      metadata: null,
      visibility: 'private',
      created_at: '2026-07-16T10:00:00.000Z',
    });
    expect(privateEntry?.audience).toEqual(['peach']);
  });

  it.each([
    [{ sender_type: 'system', intent: null, metadata: null }, 'system'],
    [{ sender_type: 'agent', intent: null, metadata: '{"approval":true}' }, 'approval'],
    [{ sender_type: 'agent', intent: null, metadata: '{"handoffChainId":"chain-1"}' }, 'handoff'],
    [{ sender_type: 'agent', intent: 'progress', metadata: null }, 'status'],
    [{ sender_type: 'agent', intent: null, metadata: '{"decisionTag":"D-1"}' }, 'decision'],
    [{ sender_type: 'agent', intent: null, metadata: null }, 'discussion'],
  ])('maps existing fields to category %s', (input, expected) => {
    expect(deriveMessageCategory(input)).toBe(expected);
  });

  it('builds audience-aware envelopes and consumes only the captured snapshot', () => {
    const service = new TeamLogProjectionService();
    const first = messageRepo.append({
      conversationId: 'conv-1',
      taskId: 'TASK-1',
      senderType: 'agent',
      senderId: 'peach',
      content: 'TASK-1 评审通过',
      mentions: ['luigi'],
      intent: 'review',
    });
    const firstEnvelope = service.buildEnvelope('conv-1', 'luigi', { taskId: 'TASK-1' });
    expect(firstEnvelope).toMatchObject({ unseenCount: 1, upToEntryId: first });
    expect(firstEnvelope.totalTokens).toBeLessThanOrEqual(150);
    expect(service.buildEnvelope('conv-1', 'toad')).toMatchObject({ unseenCount: 0 });

    const second = messageRepo.append({
      conversationId: 'conv-1',
      taskId: 'TASK-1',
      senderType: 'system',
      senderId: 'system',
      content: 'TASK-1 已进入测试',
    });
    service.markConsumed('conv-1', 'luigi', firstEnvelope.upToEntryId!);
    expect(service.buildEnvelope('conv-1', 'luigi')).toMatchObject({ unseenCount: 1, upToEntryId: second });
    service.markConsumed('conv-1', 'luigi', second);
    service.markConsumed('conv-1', 'luigi', first);
    expect(service.buildEnvelope('conv-1', 'luigi')).toMatchObject({ unseenCount: 0 });

    messageRepo.append({ conversationId: 'conv-1', senderType: 'agent', senderId: 'luigi', content: 'my own output' });
    expect(service.buildEnvelope('conv-1', 'luigi')).toMatchObject({ unseenCount: 0 });
  });

  it('projects selected proof events but ignores internal control-plane noise', () => {
    const service = new TeamLogProjectionService();
    proofLogRepo.append({
      eventType: 'dispatch.requested',
      conversationId: 'conv-1',
      agentId: 'luigi',
    });
    proofLogRepo.append({
      eventType: 'chain_closure_dispatched',
      conversationId: 'conv-1',
      taskId: 'ROOT',
      agentId: 'mario',
      reasonCode: 'chain_ready_for_closure',
    });
    expect(service.buildEnvelope('conv-1', 'luigi')).toMatchObject({ unseenCount: 0 });
    expect(service.buildEnvelope('conv-1', 'mario')).toMatchObject({ unseenCount: 1 });
  });

  it('materializes hot, warm and cold views and refreshes a registered workspace on append', () => {
    const service = new TeamLogProjectionService();
    const now = new Date('2026-07-16T12:00:00.000Z');
    const hotId = messageRepo.append({ conversationId: 'conv-1', senderType: 'agent', senderId: 'luigi', content: 'hot entry' });
    const warmId = messageRepo.append({ conversationId: 'conv-1', senderType: 'agent', senderId: 'peach', content: 'warm review', intent: 'review' });
    const coldId = messageRepo.append({ conversationId: 'conv-1', taskId: 'TASK-9', senderType: 'agent', senderId: 'dk', content: 'cold decision', metadata: { decisionTag: 'D-1' } });
    getDb().prepare('UPDATE chat_message SET created_at = ? WHERE id = ?').run('2026-07-16T11:00:00.000Z', hotId);
    getDb().prepare('UPDATE chat_message SET created_at = ? WHERE id = ?').run('2026-07-14T11:00:00.000Z', warmId);
    getDb().prepare('UPDATE chat_message SET created_at = ? WHERE id = ?').run('2026-07-01T11:00:00.000Z', coldId);

    service.materialize('conv-1', workspace, now);
    expect(fs.readFileSync(path.join(workspace, '.ath', 'team-log.md'), 'utf8')).toContain('hot entry');
    expect(fs.readFileSync(path.join(workspace, '.ath', 'team-log-archive', '2026-07-14.md'), 'utf8')).toContain('warm review');
    expect(fs.readFileSync(path.join(workspace, '.ath', 'team-log-archive', 'INDEX.md'), 'utf8')).toContain('cold decision');
    fs.rmSync(path.join(workspace, '.ath', 'team-log.md'));
    service.materialize('conv-1', workspace, now);
    expect(fs.readFileSync(path.join(workspace, '.ath', 'team-log.md'), 'utf8')).toContain('hot entry');

    const appended = messageRepo.append({ conversationId: 'conv-1', senderType: 'agent', senderId: 'toad', content: 'registered refresh' });
    const appendedRow = messageRepo.getById(appended)!;
    service.append(messageToTeamLogEntry(appendedRow)!);
    expect(fs.readFileSync(path.join(workspace, '.ath', 'team-log.md'), 'utf8')).toContain('registered refresh');
  });

  it('enforces both the hot entry and file-size limits', () => {
    const service = new TeamLogProjectionService();
    for (let index = 0; index < 60; index += 1) {
      const id = messageRepo.append({
        conversationId: 'conv-1',
        senderType: 'agent',
        senderId: 'worker',
        content: `${index}: ${'x'.repeat(180)}`,
      });
      getDb().prepare('UPDATE chat_message SET created_at = ? WHERE id = ?')
        .run(`2026-07-16T11:${String(index).padStart(2, '0')}:00.000Z`, id);
    }
    service.materialize('conv-1', workspace, new Date('2026-07-16T12:30:00.000Z'));
    const file = fs.readFileSync(path.join(workspace, '.ath', 'team-log.md'));
    const text = file.toString('utf8');
    expect(file.byteLength).toBeLessThanOrEqual(5 * 1024);
    expect((text.match(/<!-- source:/g) ?? []).length).toBeLessThanOrEqual(50);
    const envelope = service.buildEnvelope('conv-1', 'luigi');
    expect(envelope.entries.length).toBeLessThanOrEqual(5);
    expect(envelope.totalTokens).toBeLessThanOrEqual(150);
  });
});
