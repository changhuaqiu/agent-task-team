import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Agent Definition ownership', () => {
  it('keeps role materials out of the Settings and Agent product surfaces', () => {
    const settings = source('src/components/task-hub/SettingsDrawer.tsx');
    const editor = source('src/components/agent/AgentDefinitionDialog.tsx');
    const directory = source('src/components/agent/AgentsDirectory.tsx');
    const binding = source('src/components/task-hub/AgentBindingPanel.tsx');

    for (const contents of [settings, editor, directory, binding]) {
      expect(contents).not.toContain('角色素材');
      expect(contents).not.toContain('roleCardId');
    }
    expect(settings).not.toContain('RoleCard');
  });

  it('resolves runtime identity from Agent instructions and prevents Team mutation of Agent profiles', () => {
    const runtime = source('src/server/invocation-pipeline/conversation-runtime.ts');
    const planner = source('src/server/invocation-pipeline/context-planner.ts');
    const teams = source('src/server/repositories/team-pack-repo.ts');

    expect(runtime).not.toContain('loadAllRoleCards');
    expect(runtime).not.toContain('role_card_id');
    expect(planner).toContain('agentInstructions: profile.agent.instructions');
    expect(teams).not.toContain("UPDATE agents SET role_card_id");
    expect(teams).not.toContain("UPDATE agents SET account_ids");
    expect(teams).not.toContain("DELETE FROM agent_skill WHERE agent_id");
  });

  it('has no current capability side-channel outside Agent update commands', () => {
    const teamIndex = source('src/pages/api/team-packs/index.ts');
    const teamDetail = source('src/pages/api/team-packs/[packId].ts');
    const agentSkills = source('src/pages/api/agents/[agentId]/skills.ts');
    const agentStore = source('src/store/agentStore.ts');
    const teams = source('src/server/repositories/team-pack-repo.ts');
    const evaluation = source('src/server/evaluation/snapshot-builder.ts');
    const contextManager = source('src/lib/agent-context/ContextManager.ts');

    expect(teamIndex).not.toContain('teamPackRepo.create(');
    expect(teamDetail).not.toContain('teamPackRepo.update(');
    expect(teamDetail).not.toContain('teamPackRepo.delete(');
    expect(teamDetail).not.toContain('materializeRoleSnapshots');
    expect(agentSkills).not.toContain('setAgentSkills');
    expect(agentStore).not.toContain('setAgentAccountIds');
    expect(agentStore).not.toContain('agentAccountOverrides');
    expect(agentStore).not.toContain('assignSkillsToAgent');
    expect(teams).not.toContain('updateRoleConfig');
    expect(teams).not.toContain('materializeRoleSnapshots');
    expect(evaluation).not.toContain('role_card_snapshot');
    expect(evaluation).not.toContain('role.skill_ids');
    expect(evaluation).toContain('agentDefinitionRepo.get');
    expect(contextManager).not.toContain('RoleCard');
    expect(contextManager).not.toContain('getRoleCard');
    expect(contextManager).toContain('req.agentInstructions');
  });
});
