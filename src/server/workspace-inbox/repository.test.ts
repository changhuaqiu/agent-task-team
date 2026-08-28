import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { projectRepo } from '../repositories/project-repo';
import { messageRepo } from '../repositories/message-repo';
import { WorkspaceInboxRepository } from './repository';

describe('WorkspaceInboxRepository', () => {
  beforeEach(() => setTestDb(createTestDb()));
  afterEach(() => resetDb());

  it('keeps a stable conversation identity and unread frontier across updates', () => {
    const project = projectRepo.create({ name: 'Alpha', rootPath: 'C:/alpha' });
    const repo = new WorkspaceInboxRepository();
    repo.project({
      conversationKey: 'work:one', kind: 'work', projectId: project.id,
      subject: { type: 'work', id: 'one' }, actor: { type: 'agent', id: 'builder' },
      title: 'Build it', latestEventId: 'work:one:r1', latestAt: '2026-08-25T00:00:00.000Z',
    });
    repo.markRead('work:one', '2026-08-25T00:00:01.000Z');
    repo.project({
      conversationKey: 'work:one', kind: 'work', projectId: project.id,
      subject: { type: 'work', id: 'one' }, actor: { type: 'agent', id: 'builder' },
      title: 'Build it', latestEventId: 'work:one:r2', latestAt: '2026-08-25T00:00:02.000Z',
    });
    repo.project({
      conversationKey: 'work:one', kind: 'work', projectId: project.id,
      subject: { type: 'work', id: 'one' }, actor: { type: 'agent', id: 'builder' },
      title: 'Build it', latestEventId: 'work:one:r2', latestAt: '2026-08-25T00:00:02.000Z',
    });
    expect(repo.list()).toMatchObject([{ conversationKey: 'work:one', unreadCount: 1, revision: 2 }]);
  });

  it('groups replies by their stable thread root during reconciliation', () => {
    const project = projectRepo.create({ name: 'Alpha', rootPath: 'C:/alpha' });
    const conversationId = project.workspace_conversation_id;
    const rootId = messageRepo.append({ conversationId, senderType: 'human', senderId: 'local-user', content: 'Root' });
    const replyId = messageRepo.append({
      conversationId, senderType: 'agent', senderId: 'builder', content: 'Reply',
      metadata: { threadRootId: rootId },
    });
    const repo = new WorkspaceInboxRepository();
    repo.reconcile();
    const messages = repo.list().filter((item) => item.kind === 'message_thread');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      conversationKey: `message:${conversationId}:${rootId}`,
      latestEventId: replyId,
      actor: { type: 'agent', id: 'builder' },
    });
  });

  it('keeps Runtime observations out of the Inbox while preserving chat trace rows', () => {
    const project = projectRepo.create({ name: 'Alpha', rootPath: 'C:/alpha' });
    const conversationId = project.workspace_conversation_id;
    const messageId = messageRepo.append({
      conversationId,
      senderType: 'agent',
      senderId: 'builder',
      content: 'Verified result',
    });
    const toolMessageId = messageRepo.append({
      conversationId,
      senderType: 'agent',
      senderId: 'builder',
      content: '🔧 使用工具：Read',
      contentType: 'tool_use',
      metadata: { toolEvent: { type: 'tool_use', name: 'Read' } },
    });
    const thinkingMessageId = messageRepo.append({
      conversationId,
      senderType: 'agent',
      senderId: 'builder',
      content: 'I should inspect the implementation before answering.',
      contentType: 'thinking',
    });

    const repo = new WorkspaceInboxRepository();
    repo.reconcile();

    expect(messageRepo.getByConversation(conversationId).map((message) => message.id))
      .toEqual([messageId, toolMessageId, thinkingMessageId]);
    expect(repo.list().filter((item) => item.kind === 'message_thread'))
      .toMatchObject([{ latestEventId: messageId, title: 'Verified result' }]);
  });

  it('removes legacy thinking rows during reconciliation', () => {
    const project = projectRepo.create({ name: 'Alpha', rootPath: 'C:/alpha' });
    const conversationId = project.workspace_conversation_id;
    const thinkingId = messageRepo.append({
      conversationId,
      senderType: 'agent',
      senderId: 'builder',
      content: 'Internal reasoning summary',
      contentType: 'thinking',
    });
    const repo = new WorkspaceInboxRepository();
    repo.project({
      conversationKey: `message:${conversationId}:${thinkingId}`,
      kind: 'message_thread',
      projectId: project.id,
      subject: { type: 'message_thread', id: thinkingId },
      actor: { type: 'agent', id: 'builder' },
      title: 'Internal reasoning summary',
      latestEventId: thinkingId,
      latestAt: '2026-08-28T00:00:00.000Z',
    });

    repo.reconcile();

    expect(repo.list().filter((item) => item.kind === 'message_thread')).toEqual([]);
  });

  it('removes legacy tool rows and restores an eligible message when a tool advanced its thread', () => {
    const project = projectRepo.create({ name: 'Alpha', rootPath: 'C:/alpha' });
    const conversationId = project.workspace_conversation_id;
    const rootId = messageRepo.append({
      conversationId,
      senderType: 'human',
      senderId: 'local-user',
      content: 'Please verify this',
    });
    const threadedToolId = messageRepo.append({
      conversationId,
      senderType: 'agent',
      senderId: 'builder',
      content: '🔧 使用工具：Shell',
      contentType: 'tool_use',
      metadata: { threadRootId: rootId, toolEvent: { type: 'tool_use', name: 'Shell' } },
    });
    const standaloneToolId = messageRepo.append({
      conversationId,
      senderType: 'agent',
      senderId: 'builder',
      content: 'tool result',
      contentType: 'tool_result',
    });
    const repo = new WorkspaceInboxRepository();
    repo.project({
      conversationKey: `message:${conversationId}:${rootId}`,
      kind: 'message_thread',
      projectId: project.id,
      subject: { type: 'message_thread', id: rootId },
      actor: { type: 'agent', id: 'builder' },
      title: '🔧 使用工具：Shell',
      latestEventId: threadedToolId,
      latestAt: '2026-08-25T00:00:00.000Z',
    });
    repo.project({
      conversationKey: `message:${conversationId}:${standaloneToolId}`,
      kind: 'message_thread',
      projectId: project.id,
      subject: { type: 'message_thread', id: standaloneToolId },
      actor: { type: 'agent', id: 'builder' },
      title: 'tool result',
      latestEventId: standaloneToolId,
      latestAt: '2026-08-25T00:00:01.000Z',
    });

    repo.reconcile();

    expect(repo.list().filter((item) => item.kind === 'message_thread')).toMatchObject([{
      conversationKey: `message:${conversationId}:${rootId}`,
      latestEventId: rootId,
      title: 'Please verify this',
    }]);
  });
});
