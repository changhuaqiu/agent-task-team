// src/server/a2a/queue.ts
import type { MailboxEntry } from './types';

export function buildA2ADispatchPrompt(entry: MailboxEntry): string {
  const lines = [
    `═══ 跨角色协作消息 ═══`,
    `来自：${entry.a2aFrom ?? entry.fromAgentId}`,
    `消息内容：`,
    entry.content,
  ];

  if (entry.contextSnapshot) {
    try {
      const ctx = JSON.parse(entry.contextSnapshot);
      lines.push('', '当前任务上下文：');
      if (ctx.taskTitle) lines.push(`  任务：${ctx.taskTitle}`);
      if (ctx.taskStatus) lines.push(`  状态：${ctx.taskStatus}`);
      if (ctx.decisions) lines.push(`  前序决策：${ctx.decisions}`);
    } catch { /* invalid JSON, skip */ }
  }

  lines.push('', '请根据以上信息继续工作。', '═════════════════════');
  return lines.join('\n');
}
