// src/server/seed-team-packs.ts

import { teamPackRepo } from './repositories/team-pack-repo';
import { PRESET_TEAM_PACKS } from '@/data/presetTeamPacks';

export function seedTeamPacks(): void {
  for (const packInput of PRESET_TEAM_PACKS) {
    const existing = teamPackRepo.getByName(packInput.name);
    if (!existing) {
      teamPackRepo.create(packInput);
    }
  }
}
