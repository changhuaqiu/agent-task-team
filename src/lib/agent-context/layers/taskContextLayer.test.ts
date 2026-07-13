/**
 * Tests for taskContextLayer.ts
 */

import { describe, it, expect } from 'vitest';
import { buildTaskContextLayer } from './taskContextLayer';

describe('buildTaskContextLayer', () => {
  const mockTask = {
    id: 'task-123',
    title: 'Implement feature X',
    description: 'Detailed description of the task',
    phase: { title: 'implementing' },
    conversationId: 'proj-A',
  };

  describe('project_id assertion', () => {
    it('should not throw when task.conversationId matches projectId', () => {
      expect(() => {
        buildTaskContextLayer(mockTask, 'proj-A');
      }).not.toThrow();
    });

    it('should not throw when projectId is undefined', () => {
      expect(() => {
        buildTaskContextLayer(mockTask, undefined);
      }).not.toThrow();
    });

    it('should not throw when task.conversationId is undefined', () => {
      const taskWithoutConversationId = {
        ...mockTask,
        conversationId: undefined,
      };

      expect(() => {
        buildTaskContextLayer(taskWithoutConversationId, 'proj-A');
      }).not.toThrow();
    });

    it('should throw when task.conversationId differs from projectId', () => {
      expect(() => {
        buildTaskContextLayer(mockTask, 'proj-B');
      }).toThrow(/Task task-123 belongs to project proj-A, but expected proj-B/);
    });

    it('should throw with correct error message format', () => {
      try {
        buildTaskContextLayer(mockTask, 'proj-C');
        fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('task-123');
        expect((error as Error).message).toContain('proj-A');
        expect((error as Error).message).toContain('proj-C');
      }
    });

    it('should not throw when both projectId and task.conversationId are undefined', () => {
      const taskWithoutConversationId = {
        ...mockTask,
        conversationId: undefined,
      };

      expect(() => {
        buildTaskContextLayer(taskWithoutConversationId, undefined);
      }).not.toThrow();
    });
  });

  describe('existing behavior', () => {
    it('should format task with id and title', () => {
      const result = buildTaskContextLayer(mockTask);
      expect(result).toContain('[任务: task-123 Implement feature X]');
    });

    it('should include phase when present', () => {
      const result = buildTaskContextLayer(mockTask);
      expect(result).toContain('[阶段: implementing]');
    });

    it('should include description when present', () => {
      const result = buildTaskContextLayer(mockTask);
      expect(result).toContain('Detailed description of the task');
    });

    it('should handle task without phase', () => {
      const taskWithoutPhase = {
        id: 'task-456',
        title: 'Task without phase',
        description: 'No phase assigned',
        conversationId: 'proj-A',
      };

      const result = buildTaskContextLayer(taskWithoutPhase);
      expect(result).toContain('[任务: task-456 Task without phase]');
      expect(result).not.toContain('[阶段:');
      expect(result).toContain('No phase assigned');
    });

    it('should handle task without description', () => {
      const taskWithoutDescription = {
        id: 'task-789',
        title: 'Task without description',
        phase: { title: 'planning' },
        conversationId: 'proj-A',
      };

      const result = buildTaskContextLayer(taskWithoutDescription);
      expect(result).toContain('[任务: task-789 Task without description]');
      expect(result).toContain('[阶段: planning]');
      expect(result.split('\n').length).toBe(2);
    });

    it('should handle task with minimal fields', () => {
      const minimalTask = {
        id: 'task-000',
        title: 'Minimal task',
      };

      const result = buildTaskContextLayer(minimalTask);
      expect(result).toContain('[任务: task-000 Minimal task]');
      expect(result.split('\n').length).toBe(1);
    });

    it('should preserve newlines in description', () => {
      const taskWithMultilineDescription = {
        id: 'task-multi',
        title: 'Task with multiline description',
        description: 'First line\nSecond line\nThird line',
        conversationId: 'proj-A',
      };

      const result = buildTaskContextLayer(taskWithMultilineDescription);
      expect(result).toContain('First line');
      expect(result).toContain('Second line');
      expect(result).toContain('Third line');
    });
  });

  describe('combined behavior', () => {
    it('should pass scope validation and format correctly', () => {
      const result = buildTaskContextLayer(mockTask, 'proj-A');
      expect(result).toContain('[任务: task-123 Implement feature X]');
      expect(result).toContain('[阶段: implementing]');
      expect(result).toContain('Detailed description of the task');
    });

    it('should handle empty strings in conversationId', () => {
      const taskWithEmptyConversationId = {
        ...mockTask,
        conversationId: '',
      };

      expect(() => {
        buildTaskContextLayer(taskWithEmptyConversationId, '');
      }).not.toThrow();
    });

    it('should not throw when conversationId is empty string (treated as undefined)', () => {
      const taskWithEmptyConversationId = {
        ...mockTask,
        conversationId: '',
      };

      // Empty string '' is treated as undefined (no value), so no throw
      expect(() => {
        buildTaskContextLayer(taskWithEmptyConversationId, 'proj-A');
      }).not.toThrow();
    });
  });
});