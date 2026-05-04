// src/__tests__/server/a2a/router.test.ts
import { describe, it, expect } from 'vitest';
import { shouldDeliver, recordPingPong, resetPingPong } from '@/server/a2a/router';

describe('shouldDeliver', () => {
  it('allows delivery within depth limit', () => {
    const result = shouldDeliver({ fromAgentId: 'mario', toAgentId: 'luigi', chainDepth: 3 });
    expect(result.deliver).toBe(true);
  });

  it('blocks delivery when depth exceeds 10', () => {
    const result = shouldDeliver({ fromAgentId: 'mario', toAgentId: 'luigi', chainDepth: 11 });
    expect(result.deliver).toBe(false);
    expect(result.reason).toContain('depth');
  });

  it('blocks delivery at ping-pong threshold (4)', () => {
    resetPingPong('mario', 'luigi');
    resetPingPong('luigi', 'mario');
    recordPingPong('mario', 'luigi', false);
    recordPingPong('luigi', 'mario', false);
    recordPingPong('mario', 'luigi', false);
    recordPingPong('luigi', 'mario', false);

    const result = shouldDeliver({ fromAgentId: 'mario', toAgentId: 'luigi', chainDepth: 0 });
    expect(result.deliver).toBe(false);
    expect(result.reason).toContain('ping-pong');
  });

  it('resets ping-pong on substantive work', () => {
    resetPingPong('mario', 'luigi');
    resetPingPong('luigi', 'mario');
    recordPingPong('mario', 'luigi', false);
    recordPingPong('luigi', 'mario', false);
    recordPingPong('mario', 'luigi', true); // substantive — resets
    recordPingPong('luigi', 'mario', false);
    recordPingPong('mario', 'luigi', false);

    const result = shouldDeliver({ fromAgentId: 'mario', toAgentId: 'luigi', chainDepth: 0 });
    expect(result.deliver).toBe(true);
  });
});
