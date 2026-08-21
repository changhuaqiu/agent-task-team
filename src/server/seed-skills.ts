import { skillRepo } from './repositories/skill-repo';
import { PRESET_SKILLS } from '../data/presetSkills';

const BUILT_IN_TEAM_AGENT_IDS = [
  'mario',
  'luigi',
  'toad',
  'peach',
  'dk',
  'yoshi',
  'planner',
  'coder',
  'reviewer',
  'researcher',
  'analyst',
  'writer',
];
const BUILT_IN_PLANNER_AGENT_IDS = new Set(['mario', 'planner']);

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
    } else if (existing.is_preset === 1 && (
      existing.description !== (preset.description ?? null)
      || existing.content !== preset.content
      || existing.config !== (preset.config ?? null)
    )) {
      skillRepo.update(existing.id, {
        description: preset.description ?? null,
        content: preset.content,
        config: preset.config ?? null,
      });
    }
  }

  // Planning owns task creation and assignment.
  const taskMgmt = skillRepo.getByName('task-management');
  if (taskMgmt) {
    for (const agentId of BUILT_IN_TEAM_AGENT_IDS) {
      if (BUILT_IN_PLANNER_AGENT_IDS.has(agentId)) {
        skillRepo.assignToAgent(agentId, taskMgmt.id);
      } else {
        skillRepo.removeAgentAssignment(agentId, taskMgmt.id);
      }
    }
  }

  // Every dispatched role needs only the narrow status/receipt capability for
  // its current task. Creation, assignment, and broad listing stay planner-only.
  const taskStatusReceipt = skillRepo.getByName('task-status-receipt');
  if (taskStatusReceipt) {
    for (const agentId of BUILT_IN_TEAM_AGENT_IDS) {
      skillRepo.assignToAgent(agentId, taskStatusReceipt.id);
    }
  }

  const gitCollaboration = skillRepo.getByName('git-collaboration');
  if (gitCollaboration) {
    for (const agentId of BUILT_IN_TEAM_AGENT_IDS) {
      skillRepo.assignToAgent(agentId, gitCollaboration.id);
    }
  }

  // Browser verification is routed only for browser/Web E2E work. Binding it
  // makes the capability eligible; the execution profile decides per turn
  // whether its body is activated.
  const browserVerification = skillRepo.getByName('browser-verification');
  if (browserVerification) {
    for (const agentId of BUILT_IN_TEAM_AGENT_IDS) {
      skillRepo.assignToAgent(agentId, browserVerification.id);
    }
  }
}
