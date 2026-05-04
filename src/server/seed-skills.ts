import { skillRepo } from './repositories/skill-repo';
import { PRESET_SKILLS } from '../data/presetSkills';

export function seedPresetSkills(): void {
  for (const preset of PRESET_SKILLS) {
    const existing = skillRepo.getByName(preset.name);
    if (!existing) {
      skillRepo.create({
        name: preset.name,
        description: preset.description,
        content: preset.content,
        isPreset: preset.isPreset,
      });
    }
  }
}
