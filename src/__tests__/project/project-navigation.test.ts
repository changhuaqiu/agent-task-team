import { describe, expect, it } from 'vitest';
import { parseProjectNavigationHash, projectNavigationHash } from '@/lib/project-navigation';
describe('exact project navigation', () => {
  it('round trips Unicode and every locator without mixing scope and work', () => {
    const target = { projectId: '项目 & one', tab: 'work' as const, work: { conversationId: 'scope/a', taskId: 'child?2' }, detailTab: 'activity' as const, messageId: 'msg#1' };
    expect(parseProjectNavigationHash(projectNavigationHash(target))).toEqual(target);
  });
  it.each(['#project=p&view=unknown', '#project=p&view=work&work=a', '#project=p&view=work&scope=a', '#project=p&view=work&detail=unknown', '#workspace=agents'])('rejects incomplete or unsupported navigation %s', (hash) => {
    expect(parseProjectNavigationHash(hash)).toBeNull();
  });
});
