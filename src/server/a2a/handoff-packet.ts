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

function extractRelevantDecisions(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /决策|决定|decision/i.test(line))
    .map((line) => compact(line.replace(/^[\s\d.)、-]+/, ''), 240))
    .slice(0, 5);
}

function extractEvidenceRefs(content: string) {
  const refs = new Map<string, { label: string; path?: string; taskId?: string }>();
  const pathPattern = /\b(?:src|app|pages|components|server|docs|specs|design|tests|__tests__)\/[^\s，。；、)）]+/g;
  const taskPattern = /\bTASK-\d+\b/g;

  for (const match of content.matchAll(pathPattern)) {
    const path = match[0].replace(/[.,;:!?]+$/, '');
    refs.set(`path:${path}`, { label: path, path });
  }
  for (const match of content.matchAll(taskPattern)) {
    const taskId = match[0];
    refs.set(`task:${taskId}`, { label: taskId, taskId });
  }

  return Array.from(refs.values()).slice(0, 8);
}

function extractOpenQuestions(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /[?？]|风险|疑问|待确认|不确定/.test(line))
    .map((line) => compact(line.replace(/^[\s\d.)、-]+/, ''), 240))
    .slice(0, 5);
}

export function buildHandoffPacketDraft(input: BuildHandoffPacketInput) {
  const requestedAction = compact(input.content, 1000);
  return {
    title: compact(firstLine(input.content), 120) || `${input.fromHolderId} → ${input.toAgentId}`,
    requestedAction,
    possessionSummary: requestedAction,
    relevantDecisions: extractRelevantDecisions(input.content),
    evidenceRefs: extractEvidenceRefs(input.content),
    constraints: [
      '以平台 Task Graph 为项目状态事实源；TASKS.md 只作为只读投影。',
      '只执行交接包中的具体请求，不要把普通 @提及当作新派发。',
    ],
    openQuestions: extractOpenQuestions(input.content),
    forbiddenBehaviors: [
      '不要只回复确认收到。',
      '不要出于礼貌把任务传回上游持球者。',
    ],
    sourceMessageIds: input.sourceMessageIds ?? [],
  };
}
