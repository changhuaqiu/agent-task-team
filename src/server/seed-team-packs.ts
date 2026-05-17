// src/server/seed-team-packs.ts

import { teamPackRepo } from './repositories/team-pack-repo';
import { PRESET_TEAM_PACKS } from '@/data/presetTeamPacks';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { roleCardToSnapshot } from './team-pack-role-snapshot';

export function seedTeamPacks(): void {
  for (const packInput of PRESET_TEAM_PACKS) {
    const existing = teamPackRepo.getByName(packInput.name);
    if (!existing) {
      teamPackRepo.create(packInput);
      continue;
    }

    for (const role of packInput.roles) {
      if (!role.roleCardId) continue;
      const sourceCard = PRESET_ROLE_CARDS.find((card) => card.id === role.roleCardId);
      if (!sourceCard) continue;
      const existingRole = existing.roles.find((item) => item.id === role.id);
      if (!existingRole) continue;
      if (
        existingRole.roleCardId === role.roleCardId
        && existingRole.roleCardSnapshot?.sourceRoleCardId === role.roleCardId
      ) {
        continue;
      }
      teamPackRepo.updateRoleConfig(existing.id, role.id, {
        roleCardId: role.roleCardId,
        roleCardSnapshot: roleCardToSnapshot(sourceCard),
      });
    }
  }
}
