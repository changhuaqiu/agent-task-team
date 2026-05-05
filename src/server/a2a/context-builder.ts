// src/server/a2a/context-builder.ts
import type { AgentDispatchContext, TaskSummary, MessageSummary, WorklistEntry } from './types-v2';
import type { ChainRepo } from './chain';
import type { CursorRepo } from './cursor';

const RESPONSE_GUIDANCE = `规则：
- 不要广播状态（状态在 TASKS.md 里，不需要通过消息同步）
- 不要确认收到（没有 ack 机制，确认无意义）
- 只做实际工作或报告无法执行的原因
- 如果需要其他 agent 执行操作，用 @mention 并说明具体指令
- 删除文件内容后，必须立即搜索确认关键内容仍然存在；如果误删，立即恢复
- 不要编辑其他 agent 正在编辑的文件（见下方"编辑互斥"段落）

TASKS.md 编辑格式（必须严格遵守）：
| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
- 每行必须用 | 分隔，保持 8 列完整
- Status 只能是: todo, doing, review, done, blocked
- Depends 用逗号分隔任务ID，无依赖填 -
- 不要在表格中间插入空行或注释行
- 不要修改表头行`;

export interface ContextBuilderDeps {
  chainRepo: ChainRepo;
  cursorRepo: CursorRepo;
  getTasksForAgent: (conversationId: string, agentId: string) => TaskSummary[];
  getOtherExecutingTasks?: (conversationId: string, excludeAgentId: string) => TaskSummary[];
}

export function buildDispatchContext(
  deps: ContextBuilderDeps,
  entry: WorklistEntry,
  conversationId: string,
): AgentDispatchContext {
  const { chainRepo, cursorRepo, getTasksForAgent } = deps;

  const chain = chainRepo.getById(entry.chainId);
  const remainingBudget = chain ? (8 - chainRepo.getTotalCount(chain.id)) : 0;

  // Get tasks relevant to this agent
  const relevantTasks = getTasksForAgent(conversationId, entry.agentId);

  // Get tasks being worked on by OTHER agents (for file mutex)
  const otherAgentTasks = deps.getOtherExecutingTasks
    ? deps.getOtherExecutingTasks(conversationId, entry.agentId)
    : [];

  // Get incremental messages since cursor
  const recentEntries = cursorRepo.getEntriesAfterCursor(entry.agentId, conversationId);
  const newMessages: MessageSummary[] = recentEntries.map(e => ({
    id: e.entryId,
    from: e.requestedBy,
    content: e.prompt.slice(0, 500),
    timestamp: e.completedAt,
  }));

  return {
    instruction: entry.prompt,
    requestedBy: entry.requestedBy,
    chainId: entry.chainId,
    depth: entry.depth,
    remainingBudget: Math.max(0, remainingBudget),
    relevantTasks,
    otherAgentTasks,
    newMessages,
    responseGuidance: RESPONSE_GUIDANCE,
  };
}

export function renderDispatchPrompt(ctx: AgentDispatchContext): string {
  const lines: string[] = [
    `═══ A2A 任务指派 ═══`,
    `来自：${ctx.requestedBy}`,
    `链深度：${ctx.depth} / 剩余配额：${ctx.remainingBudget}`,
  ];

  if (ctx.relevantTasks.length > 0) {
    lines.push('', '你的相关任务：');
    for (const t of ctx.relevantTasks) {
      lines.push(`  [${t.status}] ${t.title}`);
    }
  }

  if (ctx.otherAgentTasks && ctx.otherAgentTasks.length > 0) {
    lines.push('', '── 编辑互斥 ──');
    lines.push('以下任务正被其他 agent 执行，不要编辑它们涉及的文件：');
    for (const t of ctx.otherAgentTasks) {
      lines.push(`  [${t.agentId}] ${t.title}`);
    }
  }

  if (ctx.newMessages.length > 0) {
    lines.push('', '最近协作消息（增量）：');
    for (const m of ctx.newMessages) {
      lines.push(`  ${m.from}: ${m.content.slice(0, 200)}`);
    }
  }

  lines.push('', '── 指令 ──', ctx.instruction);
  lines.push('', '── 约束 ──', ctx.responseGuidance);
  lines.push('', '═══════════════════');

  return lines.join('\n');
}
