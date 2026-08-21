export type SkillResourceKind = 'reference' | 'script' | 'asset' | 'agent_metadata' | 'other';

export type SkillActivationReason =
  | 'agent_binding'
  | 'explicit'
  | 'task'
  | 'handoff'
  | 'rule'
  | 'semantic';

export interface SkillPackageFileInput {
  path: string;
  content: Uint8Array;
}

export interface SkillPackageInput {
  name: string;
  description: string;
  body: string;
  skillMarkdown: string;
  files: SkillPackageFileInput[];
  config?: string;
  isPreset?: boolean;
}

export interface InstalledSkillRevision {
  id: string;
  skillId: string;
  name: string;
  description: string;
  revision: string;
  contentHash: string;
  packagePath: string;
  body: string;
  resourceRefs: string[];
  config?: string;
  createdAt: string;
}

export interface SkillCatalogEntry {
  skillId: string;
  name: string;
  description: string;
  revision: string;
}

export interface ActivatedSkill {
  skillId: string;
  name: string;
  description: string;
  revision: string;
  contentHash: string;
  body: string;
  resourceRefs: string[];
  reason: SkillActivationReason;
  required: boolean;
  config?: string;
}

export interface SkillDeliveryDecision {
  skillId: string;
  name: string;
  revision: string;
  contentHash: string;
  outcome: 'loaded' | 'omitted' | 'trimmed' | 'failed';
  reasonCode: string;
  activationReason: SkillActivationReason;
  tokens: number;
}

export interface SkillCompileResult {
  catalog: SkillCatalogEntry[];
  activated: ActivatedSkill[];
  decisions: SkillDeliveryDecision[];
}

export interface SkillCompileRequest {
  /** Every Skill bound to the Agent and therefore eligible for deterministic routing. */
  skillIds: string[];
  /** Routed subset whose bodies and tools enter this Invocation. Defaults to every eligible Skill. */
  activatedSkillIds?: string[];
  requiredSkillIds?: string[];
  activationReasons?: Record<string, SkillActivationReason>;
  /** Evaluation/replay mode: require these immutable revisions instead of current active revisions. */
  revisionIds?: Record<string, string>;
}

export interface SkillRuntime {
  install(source: SkillPackageInput): Promise<InstalledSkillRevision>;
  compile(input: SkillCompileRequest): Promise<SkillCompileResult>;
}
