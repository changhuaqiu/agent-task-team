import { describe, expect, it } from 'vitest';
import { AGENT_ROSTER } from '../../store/taskHubStore';

describe('AGENT_ROSTER account bindings', () => {
  it('initializes every preset agent with an explicit empty account list', () => {
    for (const agent of AGENT_ROSTER) {
      expect(agent.accountIds).toEqual([]);
    }
  });
});
