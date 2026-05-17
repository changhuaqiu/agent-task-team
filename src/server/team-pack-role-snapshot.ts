import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import type {
  ActionPermission,
  ClarifyPolicy,
  OutputFormat,
  OutputStyle,
  RiskGrading,
  RoleCard,
  RoleCardCategory,
} from '@/types/roleCard';
import type { RoleCardSnapshot, TeamPack, TeamPackRole } from '@/types/teamPack';

const ROLE_CATEGORY_HINTS: Array<[RegExp, RoleCardCategory]> = [
  [/planner|plan|统筹|规划/, 'planner'],
  [/frontend|前端|ui|ux/, 'frontend'],
  [/review|审查|评审/, 'code_reviewer'],
  [/arch|架构/, 'arch_reviewer'],
  [/qa|test|测试/, 'qa'],
];

function categoryForRole(role: TeamPackRole): RoleCardCategory {
  const text = `${role.id} ${role.displayName} ${role.description ?? ''}`.toLowerCase();
  return ROLE_CATEGORY_HINTS.find(([pattern]) => pattern.test(text))?.[1] ?? 'backend';
}

function defaultsForCategory(category: RoleCardCategory): {
  allowedActions: ActionPermission[];
  forbiddenActions: string[];
  outputFormat: OutputFormat;
  outputStyle: OutputStyle;
  clarifyBeforeExecute: ClarifyPolicy;
  requiresEvidence: boolean;
  riskGrading: RiskGrading;
} {
  switch (category) {
    case 'frontend':
      return {
        allowedActions: ['can_modify_code', 'can_create_files'],
        forbiddenActions: [],
        outputFormat: 'freeform',
        outputStyle: 'concise',
        clarifyBeforeExecute: 'when_ambiguous',
        requiresEvidence: true,
        riskGrading: 'optional',
      };
    case 'backend':
      return {
        allowedActions: ['can_modify_code', 'can_modify_config', 'can_create_files'],
        forbiddenActions: [],
        outputFormat: 'freeform',
        outputStyle: 'detailed',
        clarifyBeforeExecute: 'when_ambiguous',
        requiresEvidence: true,
        riskGrading: 'required',
      };
    case 'planner':
      return {
        allowedActions: ['can_propose_only'],
        forbiddenActions: [],
        outputFormat: 'structured_list',
        outputStyle: 'structured',
        clarifyBeforeExecute: 'always',
        requiresEvidence: false,
        riskGrading: 'optional',
      };
    case 'code_reviewer':
      return {
        allowedActions: ['can_propose_only'],
        forbiddenActions: ['直接修改代码'],
        outputFormat: 'checklist',
        outputStyle: 'structured',
        clarifyBeforeExecute: 'never',
        requiresEvidence: true,
        riskGrading: 'required',
      };
    case 'arch_reviewer':
      return {
        allowedActions: ['can_propose_only'],
        forbiddenActions: ['直接修改架构代码'],
        outputFormat: 'report',
        outputStyle: 'detailed',
        clarifyBeforeExecute: 'always',
        requiresEvidence: true,
        riskGrading: 'required',
      };
    case 'qa':
      return {
        allowedActions: ['can_propose_only'],
        forbiddenActions: ['修改源代码'],
        outputFormat: 'checklist',
        outputStyle: 'structured',
        clarifyBeforeExecute: 'when_ambiguous',
        requiresEvidence: true,
        riskGrading: 'required',
      };
    default:
      return {
        allowedActions: ['can_propose_only'],
        forbiddenActions: [],
        outputFormat: 'checklist',
        outputStyle: 'structured',
        clarifyBeforeExecute: 'when_ambiguous',
        requiresEvidence: true,
        riskGrading: 'optional',
      };
  }
}

export function roleCardToSnapshot(card: RoleCard, snapshottedAt = new Date().toISOString()): RoleCardSnapshot {
  const { id, isPreset, version, createdAt, updatedAt, ...snapshotBase } = card;
  return {
    ...snapshotBase,
    sourceRoleCardId: id,
    snapshotVersion: version,
    snapshottedAt,
  };
}

export function synthesizeRoleSnapshot(role: TeamPackRole, snapshottedAt = new Date().toISOString()): RoleCardSnapshot {
  const category = categoryForRole(role);
  const defaults = defaultsForCategory(category);
  return {
    name: role.id,
    displayName: role.displayName,
    description: role.description ?? role.soul.slice(0, 160),
    category,
    tags: [],
    applicableScenarios: [],
    responsibilities: role.description ? [role.description] : [],
    nonResponsibilities: [],
    successCriteria: [],
    clarifyBeforeExecute: defaults.clarifyBeforeExecute,
    outputStyle: defaults.outputStyle,
    preferStructuredOutput: defaults.outputStyle === 'structured',
    allowedActions: defaults.allowedActions,
    requiresConfirmation: [],
    forbiddenActions: defaults.forbiddenActions,
    preferredEngines: [],
    allowedTools: [],
    accountIds: role.accountIds ?? [],
    outputFormat: defaults.outputFormat,
    requiresEvidence: defaults.requiresEvidence,
    riskGrading: defaults.riskGrading,
    persona: {
      introduction: role.soul.slice(0, 500),
      voice: '',
      mindset: '',
      habits: '',
      collaboration: '',
    },
    snapshotVersion: 1,
    snapshottedAt,
  };
}

export function materializeTeamRoleSnapshot(
  role: TeamPackRole,
  roleCards: RoleCard[] = PRESET_ROLE_CARDS,
  snapshottedAt = new Date().toISOString(),
): TeamPackRole {
  if (role.roleCardSnapshot) return role;
  const sourceCard = role.roleCardId
    ? roleCards.find((card) => card.id === role.roleCardId)
    : undefined;
  return {
    ...role,
    roleCardSnapshot: sourceCard
      ? roleCardToSnapshot(sourceCard, snapshottedAt)
      : synthesizeRoleSnapshot(role, snapshottedAt),
  };
}

export function materializeTeamPack(
  pack: TeamPack,
  roleCards: RoleCard[] = PRESET_ROLE_CARDS,
  snapshottedAt = new Date().toISOString(),
): TeamPack {
  return {
    ...pack,
    roles: pack.roles.map((role) => materializeTeamRoleSnapshot(role, roleCards, snapshottedAt)),
  };
}
