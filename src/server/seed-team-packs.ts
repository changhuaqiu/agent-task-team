// src/server/seed-team-packs.ts

import { teamPackRepo } from './repositories/team-pack-repo';
import { PRESET_TEAM_PACKS } from '@/data/presetTeamPacks';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { roleCardToSnapshot } from './team-pack-role-snapshot';

export function seedTeamPacks(): void {
  for (const packInput of PRESET_TEAM_PACKS) {
    const existing = teamPackRepo.getByName(packInput.name);
    if (!existing) {
      teamPackRepo.create({ ...packInput, isPreset: true });
      continue;
    }

    // Presets are managed data: reconcile the whole structure on every seed so
    // stale workflow/matrix/role snapshots cannot survive an application
    // upgrade. Preserve user-selected account/skill bindings by stable role id.
    const existingByRole = new Map(existing.roles.map((role) => [role.id, role]));
    const roles = packInput.roles.map((role) => {
      const previous = existingByRole.get(role.id);
      const sourceCard = role.roleCardId
        ? PRESET_ROLE_CARDS.find((card) => card.id === role.roleCardId)
        : undefined;
      return {
        ...role,
        roleCardSnapshot: sourceCard ? roleCardToSnapshot(sourceCard) : role.roleCardSnapshot,
        accountIds: previous?.accountIds ?? role.accountIds,
        skillIds: previous?.skillIds ?? role.skillIds,
      };
    });
    teamPackRepo.update(existing.id, {
      displayName: packInput.displayName,
      description: packInput.description,
      version: packInput.version,
      tags: packInput.tags,
      category: packInput.category,
      teamMode: packInput.teamMode,
      workflow: packInput.workflow,
      communicationMatrix: packInput.communicationMatrix,
      sharedContext: packInput.sharedContext,
      rules: packInput.rules,
      isPreset: true,
      roles,
    });
  }
}
