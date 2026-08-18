// src/lib/agent-context/layers/a2aLayer.ts

export interface A2ALayerOpts {
  a2aFrom?: string;
  a2aContent?: string;
  a2aContextSnapshot?: string;
}

export function buildA2ALayer(opts: A2ALayerOpts): string {
  if (!opts.a2aFrom || !opts.a2aContent) return '';

  const parts = [
    '═══ A2A 跨角色协作消息 ═══',
    `触发来源：@${opts.a2aFrom}`,
    '触发方式：平台已将结构化协作上下文路由到当前工作。',
    '你的任务：直接回应这次协作请求；不要把它当作普通用户消息，也不要只确认收到。',
    `回声防护：不要为了确认、复述或礼貌性回复把工作交回 @${opts.a2aFrom}；只有存在新的、可执行的反向任务时才允许交回。`,
    '完成规则：完成真实工作并提交结构化 outcome；平台会自动通知负责收口的角色。',
    '继续协作规则：只有需要其他角色执行新的独立动作时，才提交带动作和交付物的结构化 handoff。',
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
