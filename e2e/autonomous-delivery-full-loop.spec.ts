import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { ChildProcessByStdio } from 'node:child_process';
import { spawn } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type { Readable } from 'node:stream';
import treeKill from 'tree-kill';

const workspace = process.cwd();
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3327';
const port = new URL(baseURL).port || '3327';
const tempRoot = mkdtempSync(join(tmpdir(), 'agent-task-hub-full-e2e-'));
const serverCwd = join(tempRoot, 'app');
const dataDir = join(tempRoot, 'data');
interface DriverHistoryEntry {
  scenario: string;
  snapshotId?: string;
  hasContextSnapshot: boolean;
}

interface DriverStatus {
  pending?: {
    runId: string;
    attempt: number;
    scenario: string;
  };
  history: DriverHistoryEntry[];
}

interface DeliverySnapshot {
  run: {
    status: string;
    repair_cycle: number;
  };
  actions: Array<{
    id: string;
    kind: string;
  }>;
  attempts: Array<{
    action_id: string;
    status: string;
  }>;
  receipts: Array<{
    kind: string;
    status: string;
  }>;
}

let server: ChildProcessByStdio<null, Readable, Readable> | undefined;
let serverLog = '';

function prepareServerCopy(): void {
  const excludedRoots = new Set([
    '.ath',
    '.git',
    '.next',
    'node_modules',
    'playwright-report',
    'playwright-report-autonomous',
    'test-results',
  ]);
  cpSync(workspace, serverCwd, {
    recursive: true,
    filter(source) {
      const rel = relative(workspace, source);
      if (!rel) return true;
      return !rel.split(/[\\/]/).some((segment) => excludedRoots.has(segment));
    },
  });
  symlinkSync(join(workspace, 'node_modules'), join(serverCwd, 'node_modules'), 'junction');
  mkdirSync(dataDir, { recursive: true });
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) {
      throw new Error(`E2E server exited early (${server?.exitCode})\n${serverLog}`);
    }
    try {
      const response = await fetch(`${baseURL}/api/daemon/init`);
      if (response.ok) return;
    } catch {
      // The dev server is still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for E2E server\n${serverLog}`);
}

async function startServer(): Promise<void> {
  serverLog = '';
  const started = spawn(
    process.execPath,
    [join(serverCwd, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--webpack', '-p', port],
    {
      cwd: serverCwd,
      env: {
        ...process.env,
        ATH_DATA_DIR: dataDir,
        AUTONOMOUS_DELIVERY_E2E_DRIVER: '1',
        AUTONOMOUS_DELIVERY_LEASE_MS: '5000',
        AUTONOMOUS_DELIVERY_RECONCILE_MS: '300',
        AUTONOMY_GUARD_INTERVAL_MS: '600000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  server = started;
  started.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  started.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });
  await waitForServer();
}

async function stopServer(): Promise<void> {
  const current = server;
  server = undefined;
  if (!current || current.exitCode !== null || !current.pid) return;
  await new Promise<void>((resolve) => {
    treeKill(current.pid!, 'SIGTERM', () => resolve());
  });
}

async function driverStatus(runId?: string): Promise<DriverStatus> {
  const suffix = runId ? `?runId=${encodeURIComponent(runId)}` : '';
  const response = await fetch(`${baseURL}/api/e2e/autonomous-delivery-driver${suffix}`);
  if (!response.ok) throw new Error(`Driver status failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function waitForPending(
  attempt: number,
  runId?: string,
): Promise<DriverStatus & { pending: NonNullable<DriverStatus['pending']> }> {
  const deadline = Date.now() + 45_000;
  let latest: DriverStatus | undefined;
  while (Date.now() < deadline) {
    const status = await driverStatus(runId);
    latest = status;
    if (status.pending?.attempt === attempt) {
      return status as DriverStatus & { pending: NonNullable<DriverStatus['pending']> };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const snapshot = runId
    ? await fetch(`${baseURL}/api/autonomous-delivery?runId=${encodeURIComponent(runId)}`)
      .then(async (response) => response.ok ? response.json() : { status: response.status })
      .catch((error) => ({ error: String(error) }))
    : undefined;
  throw new Error(
    `Timed out waiting for browser verification attempt ${attempt}\n`
    + `driver=${JSON.stringify(latest)}\n`
    + `snapshot=${JSON.stringify(snapshot)}\n`
    + `server=${serverLog.slice(-8_000)}`,
  );
}

async function attest(input: {
  runId: string;
  status: 'passed' | 'failed';
  pageUrl: string;
  assertions: string[];
  evidenceRefs: string[];
}): Promise<void> {
  const response = await fetch(`${baseURL}/api/e2e/autonomous-delivery-driver`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'attest', attestation: input }),
  });
  if (!response.ok) throw new Error(`Browser attestation failed: ${response.status} ${await response.text()}`);
}

async function gotoApp(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      return;
    } catch (error) {
      if (attempt === 2 || !String(error).includes('ERR_ABORTED')) throw error;
    }
  }
}

async function selectIsolatedProjectDirectory(page: Page): Promise<void> {
  const parentFromHome = relative(homedir(), dirname(serverCwd));
  if (!parentFromHome || parentFromHome.startsWith('..')) {
    throw new Error(`E2E project directory must be reachable from the folder picker home: ${serverCwd}`);
  }
  for (const segment of parentFromHome.split(/[\\/]/).filter(Boolean)) {
    const row = page.getByText(segment, { exact: true }).locator('..');
    await row.getByRole('button').click();
  }
  await page.getByText(basename(serverCwd), { exact: true }).click();
}

test.beforeAll(async () => {
  prepareServerCopy();
  await startServer();
});

test.afterAll(async () => {
  await stopServer();
  if (
    dirname(tempRoot) === tmpdir()
    && basename(tempRoot).startsWith('agent-task-hub-full-e2e-')
  ) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('UI 创建到失败修复、进程重启恢复和 DeliveryBundle 的完整闭环', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const title = `自主交付全链路 ${suffix}`;
  const goal = '验证 Team Harness 可跨失败和服务重启完成自主交付';
  const criterion = '用户可在 Web UI 查看跨失败与重启恢复后的最终交付证据';
  let startRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/autonomous-delivery')) {
      startRequests += 1;
    }
  });

  const configure = await fetch(`${baseURL}/api/e2e/autonomous-delivery-driver`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'configure' }),
  });
  expect(configure.ok).toBe(true);

  await gotoApp(page);
  await page.getByTitle('新建项目').first().click();
  await page.getByPlaceholder('例如：支付链路重构').fill(title);

  await selectIsolatedProjectDirectory(page);

  await page.getByPlaceholder('简单描述你想做什么，细节可以稍后在对话中补充。').fill(goal);
  await page.getByTestId('autonomous-acceptance-criteria').fill(criterion);
  await page.getByRole('button', { name: '创建项目', exact: true }).click();

  await expect(page.getByRole('button', { name: new RegExp(title) }).first()).toBeVisible();
  const running = page.getByTestId('autonomous-delivery-running');
  await expect(running).toBeVisible();
  await expect(running.getByText(goal)).toBeVisible();

  const firstPending = await waitForPending(1);
  const runId = firstPending.pending.runId as string;
  expect(firstPending.history.map((item) => item.scenario)).toEqual(
    expect.arrayContaining(['execution', 'code_review', 'verification']),
  );
  expect(firstPending.history.every((item) => item.hasContextSnapshot)).toBe(true);
  expect(firstPending.history.every((item) => Boolean(item.snapshotId))).toBe(true);

  await attest({
    runId,
    status: 'failed',
    pageUrl: page.url(),
    assertions: [
      '项目由 Web UI 创建',
      '自主交付运行状态与目标可见',
      '故障注入：首次验收作为失败基线',
    ],
    evidenceRefs: [`browser:${runId}:attempt-1:running-panel`],
  });

  const repairPending = await waitForPending(2, runId);
  expect(repairPending.pending.scenario).toBe('recovery');
  expect(repairPending.history.map((item) => item.scenario)).toContain('recovery');

  await stopServer();
  await new Promise((resolve) => setTimeout(resolve, 5_500));
  await startServer();

  const recoveredPending = await waitForPending(2, runId);
  expect(recoveredPending.pending.scenario).toBe('recovery');

  await gotoApp(page);
  await page.getByRole('button', { name: new RegExp(title) }).first().click();
  await expect(page.getByTestId('autonomous-delivery-running')).toBeVisible();
  await expect(page.getByTestId('autonomous-delivery-running').getByText(goal)).toBeVisible();

  await attest({
    runId,
    status: 'passed',
    pageUrl: page.url(),
    assertions: [
      '服务重启后项目仍可从 Web UI 打开',
      'repair verification 已由 startup reconcile 恢复',
      '自主交付目标仍可见',
    ],
    evidenceRefs: [`browser:${runId}:attempt-2:recovered-running-panel`],
  });

  const completed = page.getByTestId('autonomous-delivery-completed');
  await expect(completed).toBeVisible({ timeout: 45_000 });
  await expect(completed.getByText(/\d+\/\d+ 项验收通过/)).toBeVisible();
  await completed.getByRole('button', { name: '查看验收详情' }).click();
  await expect(completed.getByText(criterion)).toBeVisible();
  await expect(completed.getByText(`browser:${runId}:attempt-2:recovered-running-panel`)).toBeVisible();
  await expect(completed.getByText('Web UI 端到端验收')).toBeVisible();
  await expect(completed.getByText(/Playwright/)).toBeVisible();
  await expect(completed.getByText(new RegExp(`attempt-2\\.json`))).toBeVisible();
  await expect(completed.getByText(/^独立质量评审/)).toBeVisible();
  await expect(completed.getByText(/peach/)).toHaveCount(2);
  await expect(completed.getByText(/receipt|runtime|lease|session/i)).toHaveCount(0);
  expect(startRequests).toBe(1);

  const snapshotResponse = await fetch(`${baseURL}/api/autonomous-delivery?runId=${encodeURIComponent(runId)}`);
  expect(snapshotResponse.ok).toBe(true);
  const snapshot = await snapshotResponse.json() as DeliverySnapshot;
  expect(snapshot.run.status).toBe('completed');
  expect(snapshot.run.repair_cycle).toBe(1);
  const repairActions = snapshot.actions.filter((action) => action.kind === 'repair_verification');
  expect(repairActions).toHaveLength(1);
  const repairAttempts = snapshot.attempts.filter((attempt) =>
    attempt.action_id === repairActions[0].id
  );
  expect(repairAttempts.map((attempt) => attempt.status)).toEqual(
    expect.arrayContaining(['abandoned', 'succeeded']),
  );
  expect(snapshot.receipts.some((receipt) =>
    receipt.kind === 'delivery.published' && receipt.status === 'succeeded'
  )).toBe(true);
});
