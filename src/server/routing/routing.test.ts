import { describe, it, expect } from 'vitest';
import { parseMentions, hasMentions, extractRawMentions } from './mention-parser';
import { routeMessage, planSerialExecution } from './agent-router';

describe('mention-parser', () => {
  describe('parseMentions', () => {
    it('returns broadcast for messages without mentions', () => {
      const result = parseMentions('hello world');
      expect(result.strategy).toBe('broadcast');
      expect(result.hasExplicitMention).toBe(false);
      expect(result.targets.length).toBeGreaterThan(0);
    });

    it('routes single @mention to serial', () => {
      const result = parseMentions('@mario please write code');
      expect(result.strategy).toBe('serial');
      expect(result.targets).toEqual(['mario']);
      expect(result.hasExplicitMention).toBe(true);
    });

    it('routes multiple @mentions to serial in order', () => {
      const result = parseMentions('@mario write code, then @luigi review it');
      expect(result.strategy).toBe('serial');
      expect(result.targets).toEqual(['mario', 'luigi']);
    });

    it('deduplicates repeated @mentions', () => {
      const result = parseMentions('@mario do this @mario also that');
      expect(result.targets).toEqual(['mario']);
    });

    it('handles @all as broadcast', () => {
      const result = parseMentions('@all report your progress');
      expect(result.strategy).toBe('broadcast');
      expect(result.hasExplicitMention).toBe(true);
    });

    it('handles @全体 as broadcast', () => {
      const result = parseMentions('@全体 汇报进度');
      expect(result.strategy).toBe('broadcast');
      expect(result.hasExplicitMention).toBe(true);
    });

    it('is case-insensitive', () => {
      const result = parseMentions('@Mario write code');
      expect(result.targets).toEqual(['mario']);
    });

    it('matches by agent name (display name)', () => {
      const result = parseMentions('@Mario write code');
      expect(result.targets).toContain('mario');
    });

    it('ignores @mentions inside code blocks', () => {
      const result = parseMentions('here is code:\n```\n@mario not a mention\n```\nbut @luigi is');
      expect(result.targets).toEqual(['luigi']);
    });

    it('falls back to broadcast when no known agent matched', () => {
      const result = parseMentions('@unknownagent do something');
      expect(result.strategy).toBe('broadcast');
      expect(result.hasExplicitMention).toBe(false);
    });

    it('uses provided participants for broadcast', () => {
      const result = parseMentions('hello', ['mario', 'luigi']);
      expect(result.targets).toEqual(['mario', 'luigi']);
    });
  });

  describe('hasMentions', () => {
    it('returns true for messages with @', () => {
      expect(hasMentions('@mario hello')).toBe(true);
    });

    it('returns false for plain messages', () => {
      expect(hasMentions('hello world')).toBe(false);
    });

    it('ignores @ in code blocks', () => {
      expect(hasMentions('```\n@mario\n```')).toBe(false);
    });
  });

  describe('extractRawMentions', () => {
    it('extracts raw mention names', () => {
      expect(extractRawMentions('@mario @luigi hello')).toEqual(['mario', 'luigi']);
    });

    it('returns empty for no mentions', () => {
      expect(extractRawMentions('hello')).toEqual([]);
    });
  });
});

describe('agent-router', () => {
  describe('routeMessage', () => {
    it('routes based on mentions', () => {
      const result = routeMessage('@mario do this', {
        participants: ['mario', 'luigi'],
        agentStatus: {},
      });
      expect(result.strategy).toBe('serial');
      expect(result.targets).toEqual(['mario']);
    });

    it('broadcasts when no mentions', () => {
      const result = routeMessage('hello', {
        participants: ['mario', 'luigi'],
        agentStatus: {},
      });
      expect(result.strategy).toBe('broadcast');
      expect(result.targets).toEqual(['mario', 'luigi']);
    });

    it('filters out busy agents', () => {
      const result = routeMessage('hello', {
        participants: ['mario', 'luigi'],
        agentStatus: { mario: 'busy' },
      });
      expect(result.targets).not.toContain('mario');
      expect(result.targets).toContain('luigi');
    });

    it('filters out agents waiting for background child work', () => {
      const result = routeMessage('hello', {
        participants: ['mario', 'luigi'],
        agentStatus: { mario: 'background' },
      });
      expect(result.targets).not.toContain('mario');
      expect(result.targets).toContain('luigi');
    });

    it('returns all targets even if busy when no alternatives', () => {
      const result = routeMessage('@mario do this', {
        participants: ['mario'],
        agentStatus: { mario: 'busy' },
      });
      expect(result.targets).toEqual(['mario']);
    });
  });

  describe('planSerialExecution', () => {
    it('plans sequential dispatches with delays', () => {
      const plan = planSerialExecution(['mario', 'luigi'], 'write code', {});
      expect(plan).toHaveLength(2);
      expect(plan[0].agentId).toBe('mario');
      expect(plan[0].delay).toBe(0);
      expect(plan[1].agentId).toBe('luigi');
      expect(plan[1].delay).toBe(1000);
    });

    it('returns single plan for single target', () => {
      const plan = planSerialExecution(['mario'], 'write code', {});
      expect(plan).toHaveLength(1);
      expect(plan[0].delay).toBe(0);
    });
  });
});
