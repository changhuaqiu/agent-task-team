// src/server/seed-team-packs.ts

import { teamPackRepo } from './repositories/team-pack-repo';
import { PRESET_TEAM_PACKS } from '@/data/presetTeamPacks';

export function seedTeamPacks(): void {
  for (const packInput of PRESET_TEAM_PACKS) {
    const existing = teamPackRepo.getByName(packInput.name);
    if (!existing) {
      teamPackRepo.seedLegacy({ ...packInput, isPreset: true });
      continue;
    }

    // Team presets reconcile collaboration topology only. Agent identity,
    // skills, accounts and instructions remain owned by Agent Definition.
    teamPackRepo.reconcileLegacySeed(existing.id, {
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
      roles: packInput.roles,
    });
  }
}
