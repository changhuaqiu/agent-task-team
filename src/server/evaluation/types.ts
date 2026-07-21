export type EvalMode = 'online' | 'offline' | 'replay';
export type EvalApplicability = 'applicable' | 'not_applicable' | 'unknown';
export type EvalLabel = 'pass' | 'partial' | 'fail' | 'unknown';

export interface EvaluationRequest {
  conversationId: string;
  triggerId?: string;
  sourceSnapshotId?: string;
  caseId?: string;
  applicationManifest?: Record<string, unknown>;
  rootTaskId?: string;
  chainId?: string;
  evidenceCutoffAt?: string;
  mode?: EvalMode;
  taskType?: string;
  difficulty?: string;
  language?: string;
}

export interface EvidenceRef {
  kind: string;
  id: string;
  traceId?: string;
  taskId?: string;
  chainId?: string;
  passId?: string;
}

export interface SubjectSnapshot {
  id: string;
  conversationId: string;
  rootTaskId?: string;
  chainId?: string;
  mode: EvalMode;
  evidenceCutoffAt: string;
  collectedAt: string;
  snapshotHash: string;
  evidenceRefs: EvidenceRef[];
  evidence: Record<string, unknown>;
  appManifest: Record<string, unknown>;
  dataQuality: { coverage: number; missing: string[]; truncated: string[]; byDimension?: Record<string, number> };
  taskType: string;
  difficulty: string;
  language: string;
}

export interface EvaluationScore {
  dimensionKey: string;
  evaluatorKind: 'gate' | 'deterministic' | 'judge';
  evaluatorRevision: string;
  applicability: EvalApplicability;
  normalizedScore?: number;
  label: EvalLabel;
  rationale: string;
  evidenceRefs: EvidenceRef[];
}

export interface EvaluationReport {
  run: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  scores: Array<Record<string, unknown>>;
  gaps: Array<Record<string, unknown>>;
  judgeAttempts: Array<Record<string, unknown>>;
  reviewQueue: Array<Record<string, unknown>>;
}
