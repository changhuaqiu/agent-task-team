// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { AutonomousDeliveryPanel } from './AutonomousDeliveryPanel';
import type {
  DeliveryRunSnapshot,
  GoalContract,
} from '@/server/autonomous-delivery/types';

const contract: GoalContract = {
  idempotencyKey: 'delivery-panel-test',
  goal: '交付首页',
  acceptanceCriteria: ['首页可打开'],
  scope: { conversationId: 'conv-ui' },
  authorization: {
    allowCodeChanges: true,
    allowPush: false,
    allowPullRequest: false,
    allowAutoMerge: false,
  },
  recoveryPolicy: {
    maxAttemptsPerAction: 3,
    maxRepairCycles: 2,
    stallTimeoutMs: 60_000,
  },
  deliveryPolicy: {
    requireReview: true,
    requireWebE2E: true,
    requireMerge: false,
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AutonomousDeliveryPanel', () => {
  it('主界面只呈现用户可理解的自主交付阶段', async () => {
    const snapshot = {
      run: {
        id: 'delivery-1',
        conversation_id: contract.scope.conversationId,
        start_idempotency_key: contract.idempotencyKey,
        root_task_id: 'task-1',
        status: 'active',
        current_stage: 'executing',
        goal_contract_json: JSON.stringify(contract),
        repair_cycle: 0,
        revision: 0,
        escalation_code: null,
        escalation_detail: null,
        delivery_bundle_json: null,
        created_at: '2026-07-19T00:00:00.000Z',
        updated_at: '2026-07-19T00:00:00.000Z',
        completed_at: null,
      },
      contract,
      receipts: [],
    } satisfies DeliveryRunSnapshot;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => snapshot,
      }),
    );

    render(
      <AutonomousDeliveryPanel
        conversationId={contract.scope.conversationId}
      />,
    );

    expect(await screen.findByText('团队执行中')).toBeDefined();
    expect(screen.getByText('你可以离开，完成后会在这里交付')).toBeDefined();
    expect(screen.queryByText(/receipt|runtime|lease|session/i)).toBeNull();
  });

  it('完成后展示验收结果而不是内部执行过程', async () => {
    const snapshot = {
      run: {
        id: 'delivery-1',
        conversation_id: contract.scope.conversationId,
        start_idempotency_key: contract.idempotencyKey,
        root_task_id: 'task-1',
        status: 'completed',
        current_stage: 'delivering',
        goal_contract_json: JSON.stringify(contract),
        repair_cycle: 0,
        revision: 0,
        escalation_code: null,
        escalation_detail: null,
        delivery_bundle_json: '{}',
        created_at: '2026-07-19T00:00:00.000Z',
        updated_at: '2026-07-19T00:00:00.000Z',
        completed_at: '2026-07-19T00:10:00.000Z',
      },
      contract,
      receipts: [],
      bundle: {
        summary: '首页已交付',
        acceptanceResults: [
          {
            criterion: '首页可打开',
            status: 'passed',
            evidenceRefs: ['evidence-1'],
          },
        ],
        changeRefs: [],
        verificationRefs: [
          'playwright-report/index.html',
          'e2e/homepage.spec.ts',
          'evidence:screenshot/homepage.png',
        ],
        verification: {
          method: 'web_ui_e2e',
          verifierAgentId: 'peach',
          tool: 'Playwright',
          reportRef: 'playwright-report/index.html',
          specRefs: ['e2e/homepage.spec.ts'],
          codeRevision: 'abc123',
        },
        review: {
          reviewerAgentId: 'peach',
          summary: '代码质量、安全与回归风险检查通过',
          evidenceRefs: ['review/report.md'],
          codeRevision: 'abc123',
        },
        providerRefs: [],
        knownLimitations: [],
        completedAt: '2026-07-19T00:10:00.000Z',
      },
    } satisfies DeliveryRunSnapshot;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => snapshot,
      }),
    );

    render(
      <AutonomousDeliveryPanel
        conversationId={contract.scope.conversationId}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('autonomous-delivery-completed')).toBeDefined(),
    );
    expect(screen.getByText('首页已交付')).toBeDefined();
    expect(screen.getByText('首页可打开')).toBeDefined();
    expect(screen.getByText('验收证据')).toBeDefined();
    expect(screen.getByText('evidence-1')).toBeDefined();
    expect(screen.getByText('Web UI 端到端验收')).toBeDefined();
    expect(screen.getByText(/Playwright/)).toBeDefined();
    expect(screen.getByText('验证报告')).toBeDefined();
    expect(screen.getByText('playwright-report/index.html')).toBeDefined();
    expect(screen.getByText('测试用例')).toBeDefined();
    expect(screen.getByText('e2e/homepage.spec.ts')).toBeDefined();
    expect(screen.getByText('独立质量评审')).toBeDefined();
    expect(screen.getAllByText(/peach/)).toHaveLength(2);
    expect(screen.getByText('代码质量、安全与回归风险检查通过')).toBeDefined();
    expect(screen.getByText('评审证据')).toBeDefined();
    expect(screen.getByText('review/report.md')).toBeDefined();
    expect(screen.queryByText(/receipt|runtime|lease|session/i)).toBeNull();
  });

  it('人工等待只通过用户在 WebUI 发出的继续命令恢复', async () => {
    const waiting = {
      run: {
        id: 'delivery-waiting',
        conversation_id: contract.scope.conversationId,
        start_idempotency_key: contract.idempotencyKey,
        root_task_id: null,
        status: 'waiting_human',
        current_stage: 'planning',
        goal_contract_json: JSON.stringify(contract),
        repair_cycle: 0,
        revision: 1,
        escalation_code: 'runtime_profile_missing',
        escalation_detail: '请先补齐运行配置',
        delivery_bundle_json: null,
        created_at: '2026-07-19T00:00:00.000Z',
        updated_at: '2026-07-19T00:00:00.000Z',
        completed_at: null,
      },
      contract,
      receipts: [],
    } satisfies DeliveryRunSnapshot;
    const resumed = {
      ...waiting,
      run: {
        ...waiting.run,
        status: 'active',
        revision: 2,
        escalation_code: null,
        escalation_detail: null,
      },
    } satisfies DeliveryRunSnapshot;
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_url: string, init?: RequestInit) => ({
        ok: true,
        status: 200,
        json: async () =>
          init?.method === 'POST'
            ? { disposition: 'waiting', snapshot: resumed }
            : waiting,
      }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AutonomousDeliveryPanel
        conversationId={contract.scope.conversationId}
      />,
    );
    expect(await screen.findByText('请先补齐运行配置')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '我已处理，继续' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/autonomous-delivery',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"idempotencyKey":'),
        }),
      ),
    );
    expect(
      await screen.findByTestId('autonomous-delivery-running'),
    ).toBeDefined();
  });
});
