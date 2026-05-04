// src/lib/agent-context/layers/a2aLayer.ts

export interface A2ALayerOpts {
  a2aFrom?: string;
  a2aContent?: string;
  a2aContextSnapshot?: string;
}

export function buildA2ALayer(opts: A2ALayerOpts): string {
  if (!opts.a2aFrom || !opts.a2aContent) return '';

  const lines = [
    `═══ 跨角色协作消息 ═══`,
    `来自：${opts.a2aFrom}`,
    `消息内容：`,
    opts.a2aContent,
  ];

  if (opts.a2aContextSnapshot) {
    try {
      const ctx = JSON.parse(opts.a2aContextSnapshot);
      lines.push('', '当前任务上下文：');
      if (ctx.taskTitle) lines.push(`  任务：${ctx.taskTitle}`);
      if (ctx.taskStatus) lines.push(`  状态：${ctx.taskStatus}`);
      if (ctx.decisions) lines.push(`  前序决策：${ctx.decisions}`);
    } catch { /* skip */ }
  }

  lines.push('', '请根据以上信息继续工作。', '═════════════════════');
  return lines.join('\n');
}
