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
      const result = parseMentions('@jean please write code');
      expect(result.strategy).toBe('serial');
      expect(result.targets).toEqual(['jean']);
      expect(result.hasExplicitMention).toBe(true);
    });

    it('routes multiple @mentions to serial in order', () => {
      const result = parseMentions('@jean write code, then @keqing review it');
      expect(result.strategy).toBe('serial');
      expect(result.targets).toEqual(['jean', 'keqing']);
    });

    it('deduplicates repeated @mentions', () => {
      const result = parseMentions('@jean do this @jean also that');
      expect(result.targets).toEqual(['jean']);
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
      const result = parseMentions('@Jean write code');
      expect(result.targets).toEqual(['jean']);
    });

    it('matches by agent name (display name)', () => {
      const result = parseMentions('@Jean write code');
      expect(result.targets).toContain('jean');
    });

    it('ignores @mentions inside code blocks', () => {
      const result = parseMentions('here is code:\n```\n@jean not a mention\n```\nbut @keqing is');
      expect(result.targets).toEqual(['keqing']);
    });

    it('falls back to broadcast when no known agent matched', () => {
      const result = parseMentions('@unknownagent do something');
      expect(result.strategy).toBe('broadcast');
      expect(result.hasExplicitMention).toBe(false);
    });

    it('uses provided participants for broadcast', () => {
      const result = parseMentions('hello', ['jean', 'keqing']);
      expect(result.targets).toEqual(['jean', 'keqing']);
    });
  });

  describe('hasMentions', () => {
    it('returns true for messages with @', () => {
      expect(hasMentions('@jean hello')).toBe(true);
    });

    it('returns false for plain messages', () => {
      expect(hasMentions('hello world')).toBe(false);
    });

    it('ignores @ in code blocks', () => {
      expect(hasMentions('```\n@jean\n```')).toBe(false);
    });
  });

  describe('extractRawMentions', () => {
    it('extracts raw mention names', () => {
      expect(extractRawMentions('@jean @keqing hello')).toEqual(['jean', 'keqing']);
    });

    it('returns empty for no mentions', () => {
      expect(extractRawMentions('hello')).toEqual([]);
    });
  });
});

describe('agent-router', () => {
  describe('routeMessage', () => {
    it('routes based on mentions', () => {
      const result = routeMessage('@jean do this', {
        participants: ['jean', 'keqing'],
        agentStatus: {},
      });
      expect(result.strategy).toBe('serial');
      expect(result.targets).toEqual(['jean']);
    });

    it('broadcasts when no mentions', () => {
      const result = routeMessage('hello', {
        participants: ['jean', 'keqing'],
        agentStatus: {},
      });
      expect(result.strategy).toBe('broadcast');
      expect(result.targets).toEqual(['jean', 'keqing']);
    });

    it('filters out busy agents', () => {
      const result = routeMessage('hello', {
        participants: ['jean', 'keqing'],
        agentStatus: { jean: 'busy' },
      });
      expect(result.targets).not.toContain('jean');
      expect(result.targets).toContain('keqing');
    });

    it('returns all targets even if busy when no alternatives', () => {
      const result = routeMessage('@jean do this', {
        participants: ['jean'],
        agentStatus: { jean: 'busy' },
      });
      expect(result.targets).toEqual(['jean']);
    });
  });

  describe('planSerialExecution', () => {
    it('plans sequential dispatches with delays', () => {
      const plan = planSerialExecution(['jean', 'keqing'], 'write code', {});
      expect(plan).toHaveLength(2);
      expect(plan[0].agentId).toBe('jean');
      expect(plan[0].delay).toBe(0);
      expect(plan[1].agentId).toBe('keqing');
      expect(plan[1].delay).toBe(1000);
    });

    it('returns single plan for single target', () => {
      const plan = planSerialExecution(['jean'], 'write code', {});
      expect(plan).toHaveLength(1);
      expect(plan[0].delay).toBe(0);
    });
  });
});
