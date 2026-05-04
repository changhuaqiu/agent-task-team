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
        config: preset.config,
        isPreset: preset.isPreset,
      });
    }
  }

  // Auto-assign task-management to Mario (planner)
  const taskMgmt = skillRepo.getByName('task-management');
  if (taskMgmt) {
    skillRepo.assignToAgent('mario', taskMgmt.id);
  }
}
