export type TeamLogCategory =
  | 'discussion'
  | 'decision'
  | 'status'
  | 'handoff'
  | 'review'
  | 'approval'
  | 'system';

export interface TeamLogEntry {
  id: string;
  ts: string;
  projectId: string;
  sender: { id: string; type: 'agent' | 'user' | 'system'; label: string };
  audience: 'all' | string[];
  category: TeamLogCategory;
  taskId?: string;
  chainId?: string;
  summary: string;
  body: string;
  refs?: { taskIds?: string[]; artifactPaths?: string[]; decisionTag?: string };
}

export interface TeamLogEnvelope {
  unseenCount: number;
  entries: Array<{ sender: string; category: TeamLogCategory; taskRef?: string; summary: string }>;
  filePath: '.ath/team-log.md';
  totalTokens: number;
  upToEntryId?: string;
}

export function renderTeamLogEnvelope(envelope: TeamLogEnvelope): string {
  if (envelope.unseenCount === 0) return '';
  const lines = [
    `[团队动态 · ${envelope.unseenCount} 条未消费 · 详见 ${envelope.filePath}]`,
    ...envelope.entries.map((entry) =>
      `- ${entry.sender}→你: ${entry.taskRef ? `${entry.taskRef} ` : ''}${entry.summary} [${entry.category}]`
    ),
  ];
  if (envelope.unseenCount > envelope.entries.length) {
    lines.push(`- 另有 ${envelope.unseenCount - envelope.entries.length} 条，请按需读取文件`);
  }
  return lines.join('\n');
}
