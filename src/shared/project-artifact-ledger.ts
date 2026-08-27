export type ProjectArtifactLedgerKind =
  | 'code'
  | 'document'
  | 'design'
  | 'test'
  | 'file'
  | 'link'
  | 'pull_request'
  | 'review'
  | 'proof';

export type ProjectArtifactLedgerStatus = 'working' | 'registered';

export interface ProjectArtifactLedgerItem {
  id: string;
  projectId: string;
  ref: string;
  label: string;
  kind: ProjectArtifactLedgerKind;
  status: ProjectArtifactLedgerStatus;
  updatedAt: string;
  updatedBy: string;
  operations: Array<'create' | 'edit' | 'delete' | 'register'>;
  workId?: string;
  workTitle?: string;
  invocationId?: string;
  proofEventId?: string;
}
