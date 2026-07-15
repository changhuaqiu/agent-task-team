import { describe, expect, it } from 'vitest';
import { StreamTextPersistence } from './streamTextPersistence';

describe('StreamTextPersistence', () => {
  it('coalesces consecutive chunks into one logical message', () => {
    const messages = new Map<string, string>();
    let sequence = 0;
    const stream = new StreamTextPersistence({
      create(content) {
        const id = `m${++sequence}`;
        messages.set(id, content);
        return id;
      },
      append(id, content) {
        const current = messages.get(id);
        if (current === undefined) return false;
        messages.set(id, current + content);
        return true;
      },
    });

    expect(stream.appendChunk('工作').created).toBe(true);
    expect(stream.appendChunk('目录').created).toBe(false);
    expect([...messages.values()]).toEqual(['工作目录']);
  });

  it('starts a new message after a tool or terminal boundary', () => {
    const messages: string[] = [];
    const stream = new StreamTextPersistence({
      create(content) {
        messages.push(content);
        return String(messages.length - 1);
      },
      append(id, content) {
        const index = Number(id);
        if (messages[index] === undefined) return false;
        messages[index] += content;
        return true;
      },
    });

    stream.appendChunk('工具前');
    stream.closeSegment();
    stream.appendChunk('工具后');
    expect(messages).toEqual(['工具前', '工具后']);
  });
});
