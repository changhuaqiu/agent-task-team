import type { DeliveryBundle } from '@/server/autonomous-delivery/types';
import type { QualityGateStatus, QualityGateKind } from '@/server/quality-gate/types';

export interface WorkResultGate {
  id: string;
  taskId: string;
  taskTitle: string;
  kind: QualityGateKind;
  status: QualityGateStatus;
  artifactRevision: string;
  evaluatorId?: string;
  decidedAt?: string;
  reason?: string;
  criteria: string;
  evidence: Array<{ id: string; type: string; sourceRef?: string; content: string; refs: string[]; recordedAt: string }>;
}
export interface WorkResult {
  projectId: string;
  conversationId: string;
  workId: string;
  title: string;
  status: string;
  gates: WorkResultGate[];
  bundles: Array<{ runId: string; bundle: DeliveryBundle }>;
  projectReviewCount: number;
  limitations: string[];
}

export type ArtifactPreview =
  | { kind: 'text'; content: string; ref: string; sha256: string; modifiedAt: string; redacted: boolean }
  | { kind: 'image'; dataUrl: string; ref: string; sha256: string; modifiedAt: string };
