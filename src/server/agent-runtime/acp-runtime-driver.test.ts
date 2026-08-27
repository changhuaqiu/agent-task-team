import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AgentRun } from '../agent/types';
import type { AgentCatalogEntry } from '../agent/acp/catalog';
import type { WorkContract } from '../work-contract/types';
import { AcpRuntimeDriver } from './acp-runtime-driver';

const currentDir = dirname(fileURLToPath(import.meta.url));
const mockPath = join(currentDir, '../../test-helpers/acp/mockAcpAgent.ts');
const catalog: AgentCatalogEntry[] = [{
  id: 'claude', protocol: 'acp', delivery: 'native',
  launcher: { command: 'npx', args: ['tsx', mockPath] },
  verifiedCapabilities: ['session/new', 'session/load'],
}];

async function finish(run: AgentRun) {
  for await (const event of run.events) void event;
  return run.result;
}

function planningContract(): WorkContract {
  return {
    contractId: 'contract-plan', workId: 'work-plan', workEpoch: 1,
    attemptId: 'attempt-plan', fencingToken: 'fence-plan',
    projectId: 'project-mode', agentId: 'mario', goal: '拆解并分派',
    acceptanceCriteria: ['提交结构化计划'], role: { kind: 'coordinator' },
    permissions: { allowCodeChanges: false, executionProfile: { stage: 'plan' } },
    authoritativeRefs: [], authoritativeRevisions: {}, contextSnapshotRef: 'context-plan',
    allowedOutcomeTypes: ['propose_task_graph'], budget: {},
    correlationId: 'correlation-plan', causationId: 'causation-plan',
    createdAt: '2026-08-28T00:00:00.000Z',
  };
}

describe('AcpRuntimeDriver', () => {
  it('routes sequential invocations through the supervised persistent worker pool', async () => {
    const driver = new AcpRuntimeDriver({ catalog, workerCount: 1 });
    const input = {
      agentId: 'builder', projectId: 'project-1', laneId: 'project-1',
      engine: 'claude' as const, cwd: process.cwd(),
      env: { MOCK_ACP_SCENARIO: 'prompt_echo' },
      systemPrompt: 'Follow the contract', timeoutMs: 30_000,
    };
    try {
      const firstTurn = await driver.prepareTurn(input);
      expect(firstTurn.entry.id).toBe('claude');
      expect(firstTurn.runtime).toMatchObject({ lifecycle: 'ready', acceptingWork: true });
      const first = await finish(firstTurn.backend.execute('first request', firstTurn.execOptions));
      expect(first).toMatchObject({ status: 'completed', sessionId: 'mock-1' });
      expect(first.output).toBe('Follow the contract\n\nfirst request');

      const secondTurn = await driver.prepareTurn(input);
      const second = await finish(secondTurn.backend.execute('second request', secondTurn.execOptions));
      expect(second).toMatchObject({ status: 'completed', sessionId: 'mock-2' });
      expect(secondTurn.runtime.generation).toBe(firstTurn.runtime.generation);
    } finally {
      await driver.shutdown();
    }
  }, 30_000);

  it('exposes the bounded session rotation policy through the runtime boundary', () => {
    expect(new AcpRuntimeDriver({ catalog }).sessionContextBudget()).toEqual({
      maxCumulativeInputTokens: 120_000,
      maxTerminatedInvocations: 12,
    });
  });

  it('maps a planning WorkContract to Claude ACP plan mode', async () => {
    const driver = new AcpRuntimeDriver({ catalog, workerCount: 1 });
    try {
      const prepared = await driver.prepareTurn({
        agentId: 'mario', projectId: 'project-mode', laneId: 'project-mode',
        engine: 'claude', cwd: process.cwd(),
        env: { MOCK_ACP_SCENARIO: 'session_mode_echo' }, timeoutMs: 30_000,
        workContract: planningContract(),
      });
      const result = await finish(prepared.backend.execute('开始处理', prepared.execOptions));
      expect(result.output).toBe('plan');
    } finally {
      await driver.shutdown();
    }
  }, 30_000);

  it('applies the Agent instance name pool to managed workers and keeps it on restart', async () => {
    const driver = new AcpRuntimeDriver({ catalog, workerCount: 1 });
    const input = {
      agentId: 'named-reviewer', projectId: 'project-named', laneId: 'project-named',
      engine: 'claude' as const, cwd: process.cwd(),
      env: { MOCK_ACP_SCENARIO: 'prompt_echo' }, timeoutMs: 30_000,
      workerCount: 2, workerNames: ['Birch', 'Compass'],
    };
    try {
      const prepared = await driver.prepareTurn(input);
      prepared.cleanup();
      expect(prepared.runtime).toMatchObject({
        readyWorkers: 2, totalWorkers: 2, workerNames: ['Birch', 'Compass'],
      });
      const [restarted] = await driver.restartAgent(input.agentId, input.projectId);
      expect(restarted).toMatchObject({
        readyWorkers: 2, totalWorkers: 2, workerNames: ['Birch', 'Compass'],
      });
    } finally {
      await driver.shutdown();
    }
  }, 30_000);

  it('lists, stops and restarts the persistent runtime through the Agent control boundary', async () => {
    const driver = new AcpRuntimeDriver({ catalog, workerCount: 1 });
    const input = {
      agentId: 'builder', projectId: 'project-control', laneId: 'project-control',
      engine: 'claude' as const, cwd: process.cwd(),
      env: { MOCK_ACP_SCENARIO: 'prompt_echo' }, timeoutMs: 30_000,
    };
    try {
      const prepared = await driver.prepareTurn(input);
      prepared.cleanup();
      const initial = driver.listRuntimes('builder');
      expect(initial).toHaveLength(1);
      expect(initial[0]).toMatchObject({ lifecycle: 'ready', acceptingWork: true });

      const stopped = await driver.stopAgent('builder');
      expect(stopped).toHaveLength(1);
      expect(stopped[0]).toMatchObject({ lifecycle: 'stopped', acceptingWork: false });

      const restarted = await driver.restartAgent('builder');
      expect(restarted).toHaveLength(1);
      expect(restarted[0]).toMatchObject({ lifecycle: 'ready', acceptingWork: true });
      expect(restarted[0].generation).toBeGreaterThan(initial[0].generation);
    } finally {
      await driver.shutdown();
    }
  }, 30_000);

  it('re-prepares temporary runtime authentication state on restart', async () => {
    const codexCatalog: AgentCatalogEntry[] = [{ ...catalog[0], id: 'codex' }];
    const driver = new AcpRuntimeDriver({ catalog: codexCatalog, workerCount: 1 });
    const input = {
      agentId: 'builder', projectId: 'project-restart-config', laneId: 'project-restart-config',
      engine: 'codex' as const, cwd: process.cwd(),
      env: { MOCK_ACP_SCENARIO: 'prompt_echo' }, timeoutMs: 30_000,
    };
    try {
      const prepared = await driver.prepareTurn(input);
      prepared.cleanup();
      const firstHome = prepared.env.CODEX_HOME;
      expect(firstHome).toBeTruthy();
      expect(existsSync(firstHome)).toBe(true);

      await driver.stopAgent('builder');
      expect(existsSync(firstHome)).toBe(false);
      await driver.restartAgent('builder');

      const restarted = await driver.prepareTurn(input);
      restarted.cleanup();
      expect(restarted.env.CODEX_HOME).toBeTruthy();
      expect(restarted.env.CODEX_HOME).not.toBe(firstHome);
      expect(existsSync(restarted.env.CODEX_HOME)).toBe(true);
    } finally {
      await driver.shutdown();
    }
  }, 30_000);

  it('fences cleaned authentication state before concurrent stop and prepare', async () => {
    const codexCatalog: AgentCatalogEntry[] = [{ ...catalog[0], id: 'codex' }];
    const driver = new AcpRuntimeDriver({ catalog: codexCatalog, workerCount: 1 });
    const input = {
      agentId: 'builder', projectId: 'project-stop-race', laneId: 'project-stop-race',
      engine: 'codex' as const, cwd: process.cwd(),
      env: { MOCK_ACP_SCENARIO: 'prompt_echo' }, timeoutMs: 30_000,
    };
    try {
      const first = await driver.prepareTurn(input);
      first.cleanup();
      const firstHome = first.env.CODEX_HOME;
      expect(existsSync(firstHome)).toBe(true);

      const stopping = driver.stopAgent('builder', input.projectId);
      const preparing = driver.prepareTurn(input);
      const [, next] = await Promise.all([stopping, preparing]);
      next.cleanup();

      expect(next.env.CODEX_HOME).not.toBe(firstHome);
      expect(existsSync(next.env.CODEX_HOME)).toBe(true);
    } finally {
      await driver.shutdown();
    }
  }, 30_000);

  it('stops and forgets every registration when its Catalog runtime changes', async () => {
    const driver = new AcpRuntimeDriver({ catalog, workerCount: 1 });
    try {
      const prepared = await driver.prepareTurn({
        agentId: 'builder', projectId: 'project-invalidate', laneId: 'project-invalidate',
        engine: 'claude', cwd: process.cwd(),
        env: { MOCK_ACP_SCENARIO: 'prompt_echo' }, timeoutMs: 30_000,
      });
      prepared.cleanup();

      expect(driver.listRuntimes('builder')).toHaveLength(1);
      await expect(driver.invalidateRuntime('claude')).resolves.toBe(1);
      expect(driver.listRuntimes('builder')).toEqual([]);
      await expect(driver.restartAgent('builder')).resolves.toEqual([]);
    } finally {
      await driver.shutdown();
    }
  }, 30_000);
});
