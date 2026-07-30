import { expect, test } from '@playwright/test';

test('keeps the composer visible with expanded delivery evidence', async ({ page }) => {
  const acceptanceResults = Array.from({ length: 40 }, (_, index) => ({
    criterion: `Acceptance criterion ${index + 1}`,
    status: 'passed',
    evidenceRefs: [`reports/acceptance-${index + 1}.md`],
  }));

  await page.route('**/api/state', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        conversations: [{
          id: 'layout-conversation',
          title: 'Layout regression fixture',
          goal: 'Keep the chat composer visible',
          status: 'completed',
          priority: 'p1',
          project_path: 'C:/fixture',
          breakdown_status: 'none',
          autonomous: true,
          created_at: '2026-07-26T00:00:00.000Z',
          updated_at: '2026-07-26T00:10:00.000Z',
        }],
        tasks: [],
        recentMessages: {},
        activeSessions: [],
        recentInvocations: [],
        skills: [],
        agentSkillIds: {},
      }),
    });
  });

  await page.route('**/api/autonomous-delivery?**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        run: {
          id: 'layout-run',
          conversation_id: 'layout-conversation',
          root_task_id: 'layout-task',
          status: 'completed',
          current_stage: 'completed',
          goal_contract_json: '{}',
          repair_cycle: 0,
          revision: 0,
          escalation_code: null,
          escalation_detail: null,
          delivery_bundle_json: '{}',
          created_at: '2026-07-26T00:00:00.000Z',
          updated_at: '2026-07-26T00:00:00.000Z',
          completed_at: '2026-07-26T00:10:00.000Z',
        },
        contract: {
          goal: 'Verify the bounded delivery panel',
          acceptanceCriteria: acceptanceResults.map((item) => item.criterion),
          scope: { conversationId: 'layout-conversation' },
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
        },
        actions: [],
        attempts: [],
        receipts: [],
        bundle: {
          summary: 'A deliberately long completed delivery result',
          acceptanceResults,
          changeRefs: [],
          verificationRefs: [],
          providerRefs: [],
          knownLimitations: [],
          completedAt: '2026-07-26T00:10:00.000Z',
        },
      }),
    });
  });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const deliveryViewport = page.getByTestId('autonomous-delivery-viewport');
  const input = page.locator('#chat-input');
  await expect(deliveryViewport).toBeVisible();
  await expect(input).toBeVisible();
  await page.getByRole('button', { name: '查看验收详情' }).click();

  const geometry = await page.evaluate(() => {
    const delivery = document.querySelector<HTMLElement>(
      '[data-testid="autonomous-delivery-viewport"]',
    );
    const composer = document.querySelector<HTMLElement>('#chat-input');
    if (!delivery || !composer) return null;
    const deliveryRect = delivery.getBoundingClientRect();
    const composerRect = composer.getBoundingClientRect();
    return {
      deliveryHeight: deliveryRect.height,
      deliveryScrollHeight: delivery.scrollHeight,
      composerBottom: composerRect.bottom,
      viewportHeight: window.innerHeight,
    };
  });

  expect(geometry).not.toBeNull();
  expect(geometry!.deliveryScrollHeight).toBeGreaterThan(geometry!.deliveryHeight);
  expect(geometry!.composerBottom).toBeLessThanOrEqual(geometry!.viewportHeight);
});
