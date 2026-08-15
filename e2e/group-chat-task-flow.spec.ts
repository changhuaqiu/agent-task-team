import { test, expect } from '@playwright/test';
import path from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { io as createSocket } from 'socket.io-client';
import { InvocationPlanner } from '@/server/invocation-pipeline/context-planner';
import { resolveConversationRuntimeProfile } from '@/server/invocation-pipeline/conversation-runtime';
import { getDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { observationSpanRepo } from '@/server/repositories/observation-span-repo';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';
import { capturePromptPayloads } from '@/server/observability/prompt-observation';
import { deleteAccount, writeAccount } from '@/server/accounts-file';
import { skillRepo } from '@/server/repositories/skill-repo';
import { RepositorySkillRuntime } from '@/server/skills/skill-runtime';
import { buildSkillPackageInput } from '@/test-helpers/skill-package';

/**
 * 群聊发任务全链路 E2E
 *
 * 覆盖链路：首页加载 → 选会话 → 发消息 → 任务出现 → 右面板联动。
 *
 * 选择器依据（实测确认可靠）：
 * - 聊天输入框：`textarea[placeholder="发送消息或 @智能体…"]`（GlobalChatRoom.tsx:405）
 * - 提示锚点文案："使用 #TASK-000 引用任务"（GlobalChatRoom.tsx:436）
 * - 任务 ID：/TASK-\d+/i（store addTask 生成 TASK-xxx）
 * - 右面板 tab：看板/地图/待办（ProjectRightPanel.tsx:132-138）
 *
 * 前置条件：dev server 跑着、数据库已有种子数据 + 已配 agent 账号。
 * 本测试依赖已存在的会话与任务（不造数据，只观测真实链路）。
 */

// 输入框的稳定锚点：placeholder 与标签
const INPUT_PLACEHOLDER = '发送消息或 @智能体…';

test.describe('群聊发任务全链路', () => {
  test.beforeEach(async ({ page }) => {
    // 拦截并记录关键 API，用于断言链路被触发（不 mock，仅观测）
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        break;
      } catch (error) {
        if (attempt === 2 || !String(error).includes('ERR_ABORTED')) throw error;
      }
    }
  });

  test('首页加载，聊天输入框与提示文案可见', async ({ page }) => {
    await expect(page).toHaveTitle(/智能体任务中心|Agent Task/i);

    // 聊天输入框（用 placeholder，避开侧栏搜索框误命中）
    const input = page.locator(`textarea[placeholder="${INPUT_PLACEHOLDER}"]`);
    await expect(input).toBeVisible();

    // 提示锚点文案（辅助确认这是聊天输入区，而非搜索框）
    await expect(page.getByText('使用 #TASK-000 引用任务')).toBeVisible();
  });

  test('已存在会话，能看到历史任务胶囊或任务 ID', async ({ page }) => {
    // 项目数据库已有真实会话和任务，应能观测到 TASK-xxx
    await expect(page.locator('text=/TASK-\\d+/i').first()).toBeVisible({ timeout: 20_000 });
  });

  test('发送消息触发后端 mutations 接口', async ({ page }) => {
    // 监听 mutations 写入
    const mutationPost = page.waitForResponse(
      (resp) => resp.url().includes('/api/mutations') && resp.request().method() === 'POST',
      { timeout: 20_000 },
    );

    const input = page.locator(`textarea[placeholder="${INPUT_PLACEHOLDER}"]`);
    await expect(input).toBeVisible();

    // 输入并发送（回车提交，对应 GlobalChatRoom handleKeyDown）
    await input.fill('E2E 探测消息：请忽略');
    await input.press('Enter');

    const resp = await mutationPost;
    expect(resp.ok()).toBeTruthy();
  });

  test('右面板可展开，看板/地图/待办 tab 可达', async ({ page }) => {
    // 右面板可能折叠（ProjectRightPanel.tsx:69 open 初值依 scoped task）
    // 先尝试点展开按钮（title="展开面板"），若已展开则无此按钮，忽略错误
    await page.locator('[title="展开面板"]').click().catch(() => {});

    // 至少能看到 看板 tab
    const boardTab = page.getByRole('tab', { name: '看板' });
    await expect(boardTab.first()).toBeVisible({ timeout: 10_000 });
  });

  test('切换右面板 tab：看板 → 地图，选中态保持', async ({ page }) => {
    await page.locator('[title="展开面板"]').click().catch(() => {});

    const boardTab = page.getByRole('tab', { name: '看板' }).first();
    const mapTab = page.getByRole('tab', { name: '地图' }).first();
    await expect(boardTab).toBeVisible({ timeout: 10_000 });

    // 切到地图 tab
    await mapTab.click();

    // 地图组件标题"任务地图"应出现（TaskGraphMap.tsx:106）
    await expect(page.getByText('任务地图').first()).toBeVisible({ timeout: 10_000 });

    // 切回看板，看板标题应回来（MiniKanban.tsx:265 "看板"）
    await boardTab.click();
    await expect(page.getByText('看板').first()).toBeVisible();
  });

  test('首次 A2A 经 daemon 共用采集边界在真实观测页面完整展示', async ({ page }) => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const conversationId = `e2e-first-a2a-${suffix}`;
    const accountId = `e2e-account-${suffix}`;
    const handoff = `E2E-FIRST-A2A-${suffix}：请执行首次质量评审`;
    const pack = teamPackRepo.getByName('default-team')!;
    const agentId = 'peach';
    const originalAccountIds = pack.roles.find((role) => role.id === agentId)?.accountIds ?? [];
    writeAccount({
      id: accountId,
      name: 'E2E OpenAI account',
      authMode: 'oauth',
      provider: 'openai',
      models: [],
      enabled: true,
      status: 'valid',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    teamPackRepo.updateRoleConfig(pack.id, agentId, { accountIds: [accountId] });
    conversationRepo.create({
      id: conversationId,
      title: 'E2E first A2A observability',
      team_pack_id: pack.id,
      project_path: process.cwd(),
    });

    let traceId: string | undefined;
    try {
      expect(resolveConversationRuntimeProfile(conversationId, agentId)?.profile).toBeTruthy();
      const resolution = await new InvocationPlanner().prepare({
        id: `trigger-${suffix}`,
        source: 'a2a',
        conversationId,
        agentId,
        fromAgentId: 'mario',
        prompt: handoff,
      });
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) return;
      expect(resolution.plan.contextScenario).toBe('init');
      expect(resolution.plan.systemPrompt).toBeTruthy();
      expect(resolution.plan.prompt).toContain(handoff);
      traceId = resolution.plan.traceId;

      const span = observationSpanRepo.start({
        traceId,
        name: 'agent.invoke',
        kind: 'agent',
        conversationId,
        agentId,
        chainId: `chain-${suffix}`,
        passId: `pass-${suffix}`,
        attributes: { 'ath.dispatch.source': 'a2a', 'ath.context.scenario': 'init' },
      });
      capturePromptPayloads({
        spanId: span.span_id,
        systemPrompt: resolution.plan.systemPrompt,
        assembledPrompt: resolution.plan.prompt,
      });
      observationSpanRepo.finish(span.span_id, 'ok');

      const drawer = page.getByRole('complementary', { name: 'Agent 调用详情' });
      await expect(async () => {
        await page.evaluate((detail) => {
          window.dispatchEvent(new CustomEvent('observability:open', { detail }));
        }, { conversationId, traceId });
        await expect(drawer).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 15_000 });
      await expect(drawer.getByText('System prompt', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(drawer.getByText('Assembled prompt', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(drawer.locator('pre').filter({ hasText: handoff })).toBeVisible();
    } finally {
      if (traceId) getDb().prepare('DELETE FROM observation_span WHERE trace_id = ?').run(traceId);
      conversationRepo.delete(conversationId);
      teamPackRepo.updateRoleConfig(pack.id, agentId, { accountIds: originalAccountIds });
      deleteAccount(accountId);
    }
  });

  test('browser socket dispatch fails closed through Harness and exposes the failed Skill decision', async ({ page }) => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const conversationId = `e2e-socket-skill-${suffix}`;
    const dispatchId = `dispatch-${suffix}`;
    const pack = teamPackRepo.getByName('default-team')!;
    const agentId = 'peach';
    const accountId = `e2e-socket-account-${suffix}`;
    const originalAccountIds = pack.roles.find((role) => role.id === agentId)?.accountIds ?? [];
    let skillId: string | undefined;
    let packagePath: string | undefined;
    const socket = createSocket(process.env.E2E_BASE_URL ?? 'http://localhost:3000', {
      path: '/api/socketio',
      transports: ['websocket'],
      forceNew: true,
      autoConnect: false,
    });

    try {
      writeAccount({
        id: accountId,
        name: 'E2E socket OpenAI account',
        authMode: 'oauth',
        provider: 'openai',
        models: [],
        enabled: true,
        status: 'valid',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      teamPackRepo.updateRoleConfig(pack.id, agentId, { accountIds: [accountId] });
      conversationRepo.create({
        id: conversationId,
        title: 'E2E socket Harness Skill failure',
        team_pack_id: pack.id,
        project_path: process.cwd(),
      });
      const revision = await new RepositorySkillRuntime().install(buildSkillPackageInput({
        name: `e2e-tampered-${suffix}`,
        description: 'Required Skill tamper guard',
        content: 'This package must remain immutable.',
        files: [],
      }));
      skillId = revision.skillId;
      packagePath = revision.packagePath;
      skillRepo.assignToAgent(agentId, skillId);
      writeFileSync(path.join(packagePath, 'SKILL.md'), 'tampered after install', 'utf8');

      await page.request.get('/api/socketio');
      const connected = new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });
      socket.connect();
      await connected;

      const terminalExit = new Promise<{ reasonCode?: string }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('terminal:exit timeout')), 15_000);
        socket.on('terminal:exit', (payload: { agentId?: string; reasonCode?: string }) => {
          if (payload.agentId !== agentId) return;
          clearTimeout(timeout);
          resolve(payload);
        });
      });
      socket.emit('terminal:start', {
        dispatchId,
        conversationId,
        agentId,
        prompt: `Review the tampered Skill package ${suffix}`,
        dispatchSource: 'a2a',
        fromAgentId: 'mario',
      });
      await expect(terminalExit).resolves.toMatchObject({ reasonCode: 'skill_manifest_invalid' });

      await expect.poll(async () => {
        const response = await page.request.get(`/api/observability?conversationId=${encodeURIComponent(conversationId)}`);
        const projection = await response.json() as {
          traces?: Array<{
            status?: string;
            context?: { skillDecisions?: Array<{ skillId?: string; outcome?: string; reasonCode?: string }> };
          }>;
        };
        return projection.traces?.some((trace) => trace.status === 'error'
          && trace.context?.skillDecisions?.some((decision) => decision.skillId === skillId
            && decision.outcome === 'failed'
            && decision.reasonCode === 'skill_manifest_invalid')) ?? false;
      }, { timeout: 15_000 }).toBe(true);
    } finally {
      socket.disconnect();
      if (skillId) {
        skillRepo.removeAgentAssignment(agentId, skillId);
        skillRepo.delete(skillId);
      }
      if (packagePath) rmSync(packagePath, { recursive: true, force: true });
      conversationRepo.delete(conversationId);
      teamPackRepo.updateRoleConfig(pack.id, agentId, { accountIds: originalAccountIds });
      deleteAccount(accountId);
    }
  });

  test('required Context failure is visible in the real Web UI debug projection', async ({ page }) => {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const conversationId = `e2e-required-context-${suffix}`;
    const title = `E2E required context ${suffix}`;
    const accountId = `e2e-required-context-account-${suffix}`;
    const pack = teamPackRepo.getByName('default-team')!;
    const agentId = 'luigi';
    const originalAccountIds = pack.roles.find((role) => role.id === agentId)?.accountIds ?? [];

    try {
      writeAccount({
        id: accountId,
        name: 'E2E required context account',
        authMode: 'oauth',
        provider: 'openai',
        models: [],
        enabled: true,
        status: 'valid',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      teamPackRepo.updateRoleConfig(pack.id, agentId, { accountIds: [accountId] });
      conversationRepo.create({
        id: conversationId,
        title,
        team_pack_id: pack.id,
        project_path: process.cwd(),
      });

      const resolution = await new InvocationPlanner().prepare({
        id: `required-context-${suffix}`,
        source: 'workflow',
        conversationId,
        agentId,
        prompt: 'Continue the delivery loop',
        deliveryRunId: `missing-delivery-${suffix}`,
        contextScenario: 'execution',
      });
      expect(resolution).toMatchObject({
        ok: false,
        outcome: { status: 'failed', reasonCode: 'required_context_missing' },
      });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: title, exact: true }).click();
      await page.locator('[title="展开面板"]').click().catch(() => {});
      await page.getByRole('tab', { name: '调试', exact: true }).click();
      await expect(page.getByText('Agent 调试', { exact: true })).toBeVisible();

      const trace = page.locator('article').filter({ hasText: agentId });
      await expect(trace).toHaveCount(1);
      await trace.getByRole('button').click();
      await expect(trace.getByText('必需缺失 1', { exact: true })).toBeVisible();
      await expect(trace.getByText('省略 1', { exact: true })).toBeVisible();
      await expect(trace.getByText(/Snapshot ctx_failed_/)).toBeVisible();
    } finally {
      getDb().prepare('DELETE FROM observation_span WHERE conversation_id = ?').run(conversationId);
      conversationRepo.delete(conversationId);
      teamPackRepo.updateRoleConfig(pack.id, agentId, { accountIds: originalAccountIds });
      deleteAccount(accountId);
    }
  });
});
