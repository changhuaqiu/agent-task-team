import type { PassIntent } from './types-possession';

export interface BuildHandoffPacketInput {
  fromHolderId: string;
  toAgentId: string;
  content: string;
  intent: PassIntent;
  sourceMessageIds?: string[];
}

function firstLine(text: string): string {
  return text.split('\n').map((line) => line.trim()).find(Boolean) ?? text.trim();
}

function compact(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

export function buildHandoffPacketDraft(input: BuildHandoffPacketInput) {
  const requestedAction = compact(input.content, 1000);
  return {
    title: compact(firstLine(input.content), 120) || `${input.fromHolderId} → ${input.toAgentId}`,
    requestedAction,
    possessionSummary: requestedAction,
    relevantDecisions: [],
    evidenceRefs: [],
    constraints: [
      '以项目任务系统和 TASKS.md 为项目状态事实源。',
      '只执行交接包中的具体请求，不要把普通 @提及当作新派发。',
    ],
    openQuestions: [],
    forbiddenBehaviors: [
      '不要只回复确认收到。',
      '不要出于礼貌把任务传回上游持球者。',
    ],
    sourceMessageIds: input.sourceMessageIds ?? [],
  };
}
