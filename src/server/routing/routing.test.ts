import { describe, it, expect } from 'vitest';
import { parseMentions, hasMentions, extractRawMentions } from './mention-parser';

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
