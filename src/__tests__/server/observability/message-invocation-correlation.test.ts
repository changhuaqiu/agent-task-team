import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { messageRepo } from '@/server/repositories/message-repo';

beforeEach(() => { setTestDb(createTestDb()); conversationRepo.create({ id: 'conv-obs', title: 'Observability' }); });
afterEach(() => resetDb());

describe('chat message invocation correlation', () => {
  it('persists invocation_id as a first-class column', () => {
    const id = messageRepo.append({ conversationId: 'conv-obs', senderType: 'agent', senderId: 'reviewer', content: 'done', invocationId: 'inv-42' });
    expect(messageRepo.getById(id)).toMatchObject({ invocation_id: 'inv-42' });
  });
});
