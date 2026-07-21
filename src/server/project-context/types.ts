export const PROJECT_CONTEXT_SCHEMA_VERSION = 1 as const;
export const PROJECT_CONTEXT_GENERATOR = 'agent-task-hub/project-context' as const;
export const PROJECT_CONTEXT_OWNER_FILE = '.project-context-owner.json' as const;
export const PROJECT_CONTEXT_MANIFEST_CHECKPOINT_FILE = '.manifest-checkpoint.json' as const;

export type ProjectKnowledgeLayer =
  | 'scope'
  | 'norms-constraints'
  | 'topology'
  | 'development'
  | 'work'
  | 'knowledge';

export type ProjectContextClassification =
  | 'codebase'
  | 'empty'
  | 'existing_context'
  | 'single_candidate'
  | 'ambiguous_workspace';

export interface ProjectConversationInput {
  id: string;
  title: string;
  goal?: string | null;
  status?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectContextOwner {
  schemaVersion: typeof PROJECT_CONTEXT_SCHEMA_VERSION;
  generator: typeof PROJECT_CONTEXT_GENERATOR;
  root: string;
  createdAt: string;
}

export interface ProjectContextManifestCheckpoint {
  schemaVersion: typeof PROJECT_CONTEXT_SCHEMA_VERSION;
  generator: typeof PROJECT_CONTEXT_GENERATOR;
  root: string;
  revision: number;
  manifestDigest: string;
  publishedAt: string;
}

interface ProjectContextPrepareBase {
  projectPath: string;
}

export type ProjectContextPrepareInput =
  | (ProjectContextPrepareBase & { mode: 'inspect' })
  | (ProjectContextPrepareBase & {
      mode: 'rollback';
      conversationId: string;
      /** Complete remaining authoritative workstreams after DB compensation. */
      workstreams?: ProjectConversationInput[];
      resolveWorkstreams?: () => ProjectConversationInput[] | Promise<ProjectConversationInput[]>;
    })
  | (ProjectContextPrepareBase & {
      mode: 'initialize' | 'load' | 'refresh';
      conversation: ProjectConversationInput;
      /**
       * When supplied, this is the complete authoritative set for the selected
       * codebase. It lets the module remove stale generated projections without
       * learning about the database.
       */
      workstreams?: ProjectConversationInput[];
      /** Re-read the authoritative set after the per-root filesystem lock is held. */
      resolveWorkstreams?: () => ProjectConversationInput[] | Promise<ProjectConversationInput[]>;
      requestText?: string;
    });

export interface ProjectContextInspection {
  selectedPath: string;
  root: string;
  projectName: string;
  classification: ProjectContextClassification;
  existingContext: boolean;
  candidates: string[];
  activeWorkstreamCount: number;
}

export interface ProjectInstructionEntry {
  path: string;
  title: string;
  appliesTo: string;
  priority: number;
  authority: 'explicit';
  kind: 'instruction' | 'standard' | 'active-spec';
}

export interface ProjectCommandEntry {
  name: string;
  command: string;
  source: string;
  authority: 'explicit';
}

export interface ProjectKnowledgeEntry {
  id: string;
  layer: Exclude<ProjectKnowledgeLayer, 'scope' | 'work'>;
  path: string;
  title: string;
  summary: string;
  tags: string[];
  authority: 'explicit' | 'inferred';
  freshness: 'stable' | 'structural' | 'volatile';
  priority: number;
}

export interface ProjectFreshnessInput {
  path: string;
  kind: 'file' | 'directory';
  mtimeMs: number;
  size: number;
}

export interface ProjectScanDiagnostics {
  cacheHit: boolean;
  entriesVisited: number;
  filesRead: number;
  bytesRead: number;
  indexedDocuments: number;
  indexedModules: number;
  selectedKnowledgeCount: number;
  freshnessChecks: number;
  durationMs: number;
  truncated: boolean;
  freshnessCoverage: 'complete' | 'incomplete';
}

export interface CodeTopologyModule {
  path: string;
  language: string;
  kind: 'source' | 'test' | 'config' | 'manifest';
  exportedSymbols: string[];
  inbound: number;
  outbound: number;
  entrypoint: boolean;
}

export interface CodeTopologyEdge {
  from: string;
  to: string;
  kind: 'import' | 'manifest';
}

export interface CodeTopology {
  schemaVersion: typeof PROJECT_CONTEXT_SCHEMA_VERSION;
  revision: number;
  generatedAt: string;
  precision: 'heuristic';
  entrypoints: string[];
  modules: CodeTopologyModule[];
  edges: CodeTopologyEdge[];
  unresolvedImports: number;
  truncated: boolean;
}

export interface ProjectContextManifest {
  schemaVersion: typeof PROJECT_CONTEXT_SCHEMA_VERSION;
  revision: number;
  generatedAt: string;
  sourceFingerprint: string;
  project: {
    root: string;
    name: string;
    kind: 'codebase' | 'empty';
    technologies: string[];
    packageManager?: string;
  };
  layers: Array<{
    id: ProjectKnowledgeLayer;
    sources: string[];
    freshness: 'stable' | 'structural' | 'volatile';
  }>;
  instructions: ProjectInstructionEntry[];
  commands: ProjectCommandEntry[];
  topology: {
    path: '.ath/context/topology.json';
    moduleCount: number;
    edgeCount: number;
    precision: 'heuristic';
    digest: string;
  };
  knowledge: ProjectKnowledgeEntry[];
  freshnessInputs: ProjectFreshnessInput[];
  diagnostics: ProjectScanDiagnostics;
}

export interface ProjectWorkstream {
  schemaVersion: typeof PROJECT_CONTEXT_SCHEMA_VERSION;
  conversationId: string;
  title: string;
  goalSummary: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface RankedTopologyModule extends CodeTopologyModule {
  score: number;
  neighbors: string[];
}

export interface ProjectContextCapsule {
  revision: number;
  content: string;
  selectedKnowledge: ProjectKnowledgeEntry[];
  repoMap: RankedTopologyModule[];
  evidenceRefs: string[];
  currentWorkstream: ProjectWorkstream;
  siblingWorkstreams: ProjectWorkstream[];
}

export interface ProjectContextResult {
  inspection: ProjectContextInspection;
  manifest?: ProjectContextManifest;
  topology?: CodeTopology;
  capsule?: ProjectContextCapsule;
  diagnostics: ProjectScanDiagnostics;
}

export type ProjectContextReasonCode =
  | 'project_path_missing'
  | 'project_path_not_found'
  | 'project_path_not_directory'
  | 'project_root_required'
  | 'ambiguous_workspace'
  | 'project_context_unreadable'
  | 'project_context_write_failed'
  | 'project_context_schema_unsupported';

export class ProjectContextError extends Error {
  constructor(
    readonly reasonCode: ProjectContextReasonCode,
    message: string,
    readonly candidates: string[] = [],
  ) {
    super(message);
    this.name = 'ProjectContextError';
  }
}
