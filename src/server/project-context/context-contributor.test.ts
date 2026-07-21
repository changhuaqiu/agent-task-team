import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import type { ContextQuery } from '@/lib/agent-context/ContextManager';
import { ProjectContextContributor } from './context-contributor';

let root: string;

function query(conversationId: string, requestText = 'implement auth'): ContextQuery {
  return {
    scenario: 'execution',
    trigger: 'resume',
    conversationId,
    agentId: 'luigi',
    archetype: 'worker',
    requestText,
    budgetTokens: 20_000,
    requiredContributorIds: [],
    now: '2026-07-20T02:00:00.000Z',
  };
}

beforeEach(() => {
  setTestDb(createTestDb());
  root = mkdtempSync(path.join(tmpdir(), 'project-context-contributor-'));
  mkdirSync(path.join(root, 'src'), { recursive: true });
  writeFileSync(path.join(root, 'package.json'), '{"name":"contributor-fixture"}', 'utf8');
  writeFileSync(path.join(root, 'src/index.ts'), 'export const main = true;', 'utf8');
});

afterEach(() => {
  resetDb();
  rmSync(root, { recursive: true, force: true });
});

describe('ProjectContextContributor', () => {
  it('reuses one shared revision while changing the current workstream projection', async () => {
    conversationRepo.create({
      id: 'conv-a',
      title: 'Auth project',
      goal: 'Implement auth',
      project_path: root,
    });
    conversationRepo.create({
      id: 'conv-b',
      title: 'Billing project',
      goal: 'Implement billing',
      project_path: root,
    });
    const contributor = new ProjectContextContributor();

    const [fragmentA] = await contributor.contribute(query('conv-a', 'auth'));
    const [fragmentB] = await contributor.contribute(query('conv-b', 'billing'));

    expect(fragmentA.required).toBe(true);
    expect(fragmentA.version.split(':').slice(0, 2)).toEqual(
      fragmentB.version.split(':').slice(0, 2),
    );
    expect(fragmentA.content).toContain('当前工作项目');
    expect(fragmentA.content).toContain('Auth project');
    expect(fragmentA.content).toContain('Billing project');
    expect(fragmentB.content).toContain('Billing project');
    expect(fragmentB.evidenceRefs).toEqual(expect.arrayContaining([
      expect.stringContaining('.ath'),
      expect.stringContaining('topology.json'),
    ]));
  });

  it('returns a required no-host-scan constraint when no project path is bound', async () => {
    conversationRepo.create({ id: 'conv-unbound', title: 'Unbound project' });
    const [fragment] = await new ProjectContextContributor().contribute(query('conv-unbound'));

    expect(fragment).toMatchObject({
      producer: 'project-context',
      required: true,
      kind: 'project.context.unbound',
    });
    expect(fragment.content).toContain('不得把平台进程 cwd');
  });
});
