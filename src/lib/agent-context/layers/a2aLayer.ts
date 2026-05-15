// src/lib/agent-context/layers/a2aLayer.ts

export interface A2ALayerOpts {
  a2aFrom?: string;
  a2aContent?: string;
  a2aContextSnapshot?: string;
}

export function buildA2ALayer(opts: A2ALayerOpts): string {
  if (!opts.a2aFrom || !opts.a2aContent) return '';

  const parts = [
    '═══ 跨角色协作消息 ═══',
    `触发来源：@${opts.a2aFrom}`,
    '触发方式：上游 agent 在回复中 @ 了你，系统已将该协作请求路由到当前会话。',
    '你的任务：直接回应这次协作请求；不要把它当作普通用户消息，也不要只确认收到。',
    `回声防护：不要为了确认、总结或礼貌性回复再 @${opts.a2aFrom}；只有确有新的、可执行的反向任务时才允许 @ 回来源。`,
    '',
    '── 上游指令与链路上下文 ──',
    opts.a2aContent,
  ];

  if (opts.a2aContextSnapshot) {
    parts.push('', '── 上下文快照 ──', opts.a2aContextSnapshot);
  }

  parts.push('═══════════════════');

  return parts.join('\n');
}
