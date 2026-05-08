import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import type { RoleCard, RoleCardCategory } from '@/types/roleCard';
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
  return {
    name: role.id,
    displayName: role.displayName,
    description: role.description ?? role.soul.slice(0, 160),
    category: categoryForRole(role),
    tags: [],
    applicableScenarios: [],
    responsibilities: role.description ? [role.description] : [],
    nonResponsibilities: [],
    successCriteria: [],
    clarifyBeforeExecute: 'when_ambiguous',
    outputStyle: 'structured',
    preferStructuredOutput: true,
    allowedActions: ['can_propose_only'],
    requiresConfirmation: [],
    forbiddenActions: [],
    preferredEngines: [],
    allowedTools: [],
    accountIds: role.accountIds ?? [],
    outputFormat: 'checklist',
    requiresEvidence: true,
    riskGrading: 'optional',
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
