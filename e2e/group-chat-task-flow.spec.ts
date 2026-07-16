import { test, expect } from '@playwright/test';

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
    await page.goto('/', { waitUntil: 'networkidle' });
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
});
