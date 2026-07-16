/**
 * Tests for historyLayer.ts
 */

import { describe, it, expect } from 'vitest';
import { buildHistoryLayer, type HistoryLayerOpts } from './historyLayer';
import type { ChatMessage } from '@/store/types';

describe('buildHistoryLayer', () => {
  const mockMessages: ChatMessage[] = [
    {
      id: 'msg-1',
      agentId: 'agent-1',
      content: 'Hello from project A',
      timestamp: '2024-01-01T10:00:00Z',
      conversationId: 'proj-A',
    },
    {
      id: 'msg-2',
      agentId: 'agent-2',
      content: 'Hello from project B',
      timestamp: '2024-01-01T11:00:00Z',
      conversationId: 'proj-B',
    },
    {
      id: 'msg-3',
      agentId: 'agent-1',
      content: 'Another message from project A',
      timestamp: '2024-01-01T12:00:00Z',
      conversationId: 'proj-A',
    },
  ];

  describe('project_id filtering', () => {
    it('should filter messages by projectId when provided', () => {
      const result = buildHistoryLayer(mockMessages, 'agent-1', {
        projectId: 'proj-A',
      });

      expect(result).toContain('Hello from project A');
      expect(result).toContain('Another message from project A');
      expect(result).not.toContain('Hello from project B');
    });

    it('should return empty string when no messages match projectId', () => {
      const result = buildHistoryLayer(mockMessages, 'agent-1', {
        projectId: 'proj-nonexistent',
      });

      expect(result).toBe('');
    });

    it('should include only self messages when projectId is not provided', () => {
      const result = buildHistoryLayer(mockMessages, 'agent-1', {});

      expect(result).toContain('Hello from project A');
      expect(result).not.toContain('Hello from project B');
      expect(result).toContain('Another message from project A');
    });

    it('should filter messages with undefined conversationId', () => {
      const messagesWithUndefined: ChatMessage[] = [
        ...mockMessages,
        {
          id: 'msg-4',
          agentId: 'agent-1',
          content: 'Message without project',
          timestamp: '2024-01-01T13:00:00Z',
          conversationId: undefined,
        },
      ];

      const result = buildHistoryLayer(messagesWithUndefined, 'agent-1', {
        projectId: 'proj-A',
      });

      expect(result).not.toContain('Message without project');
    });

    it('should return empty when the specified project has no self messages', () => {
      const result = buildHistoryLayer(mockMessages, 'agent-1', {
        projectId: 'proj-B',
      });

      expect(result).toBe('');
    });
  });

  describe('existing behavior', () => {
    it('should return empty string for empty messages array', () => {
      const result = buildHistoryLayer([], 'agent-1', {});
      expect(result).toBe('');
    });

    it('should format time in Chinese locale', () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg-1',
          agentId: 'agent-1',
          content: 'Test message',
          timestamp: '2024-01-01T14:30:45Z',
          conversationId: 'proj-A',
        },
      ];

      const result = buildHistoryLayer(messages, 'agent-1', {
        projectId: 'proj-A',
      });

      expect(result).toMatch(/\d{2}:\d{2}/);
    });

    it('should truncate long content', () => {
      const longContent = 'A'.repeat(300);
      const messages: ChatMessage[] = [
        {
          id: 'msg-1',
          agentId: 'agent-1',
          content: longContent,
          timestamp: '2024-01-01T10:00:00Z',
          conversationId: 'proj-A',
        },
      ];

      const result = buildHistoryLayer(messages, 'agent-1', {
        projectId: 'proj-A',
      });

      expect(result).toContain('[截断]');
      expect(result.length).toBeLessThan(longContent.length);
    });

    it('should label agent correctly as "你（之前）"', () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg-1',
          agentId: 'current-agent',
          content: 'My own message',
          timestamp: '2024-01-01T10:00:00Z',
          conversationId: 'proj-A',
        },
      ];

      const result = buildHistoryLayer(messages, 'current-agent', {
        projectId: 'proj-A',
      });

      expect(result).toContain('你（之前）');
    });

    it('should omit system messages from private self history', () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg-1',
          agentId: 'system',
          content: 'System message',
          timestamp: '2024-01-01T10:00:00Z',
          conversationId: 'proj-A',
        },
      ];

      const result = buildHistoryLayer(messages, 'agent-1', {
        projectId: 'proj-A',
      });

      expect(result).toBe('');
    });

    it('should omit human messages from private self history', () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg-1',
          agentId: 'human',
          content: 'User message',
          timestamp: '2024-01-01T10:00:00Z',
          conversationId: 'proj-A',
        },
      ];

      const result = buildHistoryLayer(messages, 'agent-1', {
        projectId: 'proj-A',
      });

      expect(result).toBe('');
    });
  });

  describe('options with query and limit', () => {
    it('should work with projectId and query', () => {
      const result = buildHistoryLayer(mockMessages, 'agent-1', {
        projectId: 'proj-A',
        query: 'project',
      });

      expect(result).toContain('Hello from project A');
      expect(result).not.toContain('Hello from project B');
    });

    it('should work with projectId and limit', () => {
      const manyMessages: ChatMessage[] = Array.from({ length: 50 }, (_, i) => ({
        id: `msg-${i}`,
        agentId: 'agent-1',
        content: `Message ${i}`,
        timestamp: new Date(2024, 0, 1, i, 0, 0).toISOString(),
        conversationId: i % 2 === 0 ? 'proj-A' : 'proj-B',
      }));

      const result = buildHistoryLayer(manyMessages, 'agent-1', {
        projectId: 'proj-A',
      });

      // Should have the header/footer
      expect(result).toContain('[对话历史');
      expect(result).toContain('[/对话历史]');

      // After filtering by proj-A (25 messages), should take MAX_MESSAGES (10)
      const messageLines = result.split('\n').filter(line =>
        line.match(/\[\d{2}:\d{2}/)
      );

      expect(messageLines.length).toBe(10);
    });
  });
});
