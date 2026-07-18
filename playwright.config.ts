import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const webServerCommand = process.env.E2E_WEB_SERVER_COMMAND ?? 'npm run dev';

/**
 * Playwright E2E 配置
 *
 * 说明：
 * - 使用系统 Chrome（channel: 'chrome'），避免在 CI/本地额外下载 chromium headless shell。
 * - 默认 webServer 指向已在运行的 dev server（reuseExistingServer）。
 *   若本地未起 `npm run dev`，`webServer` 会自动拉起一个；端口 3000。
 * - 真实浏览器 E2E，非 jsdom 组件测试（那是 vitest 的职责）。
 *
 * 手动运行：
 *   npm run dev            # 另起一个终端跑 dev server
 *   npx playwright test    # 跑 E2E
 *   npx playwright test --headed   # 可见窗口调试
 *   npx playwright show-report     # 看报告
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // 群聊链路有 socket/会话状态，串行更稳定
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // 单 worker：共享 dev server + sqlite，避免并发写冲突
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL,
    channel: 'chrome', // 用系统 Chrome
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // video 关闭：避免依赖 ffmpeg 二进制；失败定位用 trace + screenshot 足够
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  // dev server：已运行则复用，未运行则自动起（next dev --webpack）
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },

  projects: [
    {
      name: 'chromium',
      // 显式 channel:'chrome'，用系统 Chrome，不依赖下载的 chromium
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});
