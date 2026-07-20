# E2E 测试（Playwright · 真实浏览器）

本目录是**真实浏览器**端到端测试，与 `src/__tests__/`（Vitest + jsdom 组件测试）职责区分：

| 层级 | 工具 | 跑在哪 | 适合测什么 |
| --- | --- | --- | --- |
| 组件测试 | Vitest + Testing Library | jsdom（无浏览器） | 组件渲染、交互、store 状态 |
| **E2E（本目录）** | **Playwright** | **真实 Chrome** | 完整页面、跨组件链路、socket 实时更新 |

## 运行

```bash
# 前置：dev server 需在 localhost:3000 运行
npm run dev          # 另起终端跑 dev server

# 跑全部 E2E（无头）
npm run e2e

# 可见窗口调试（会弹出 Chrome 窗口）
npm run e2e:headed

# 看上次运行的 HTML 报告
npm run e2e:report

# 自主交付完整闭环：独立服务、失败修复、进程重启恢复
pnpm e2e:autonomous
```

> 若本地未起 `npm run dev`，`playwright.config.ts` 的 `webServer` 会自动拉起一个。

如果 3000 端口已经运行了其他版本，使用独立端口验证当前工作树：

```powershell
$env:E2E_BASE_URL='http://127.0.0.1:3100'
$env:E2E_WEB_SERVER_COMMAND='pnpm exec next dev --webpack -p 3100'
pnpm e2e
```

## 配置要点（`playwright.config.ts`）

- **`channel: 'chrome'`**：用系统已装的 Chrome，不额外下载 chromium headless shell。
- **`workers: 1` + `fullyParallel: false`**：dev server + sqlite 共享，串行避免并发写冲突。
- **video 关闭**：避免依赖 ffmpeg 二进制；失败定位用 `trace` + `screenshot`（已开启）。
- **`reuseExistingServer`**：复用已在跑的 dev server，不重复起。

## 选择器约定

本目录测试使用**稳定锚点**而非易变 class，依据组件源码：

| 元素 | 选择器 | 来源 |
| --- | --- | --- |
| 聊天输入框 | `textarea[placeholder="发送消息或 @智能体…"]` | `GlobalChatRoom.tsx:405` |
| 输入区提示 | 文案 `使用 #TASK-000 引用任务` | `GlobalChatRoom.tsx:436` |
| 任务 ID | 正则 `TASK-\d+` | store `addTask` |
| 右面板 tab | role=tab + 文案 `看板/地图/待办` | `ProjectRightPanel.tsx:132` |
| 右面板展开 | `[title="展开面板"]` | `ProjectRightPanel.tsx:155` |

## 已覆盖链路

`group-chat-task-flow.spec.ts`：群聊发任务全链路
- 首页加载与聊天输入框可见
- 历史会话与任务胶囊可见
- 发消息触发 `POST /api/mutations`
- 右面板展开与 tab 可达
- 看板 ↔ 地图 tab 切换
- 现场创建无 active session 的会话，经真实 Harness planner 生成首次 A2A，通过 daemon 共用的 prompt capture 边界采集，并按精确 conversation/trace 在观测抽屉验证 System 与 Assembled prompt；用例结束后清理自己的数据

`autonomous-delivery-full-loop.spec.ts`：自主交付发布级黑盒闭环

- 只通过 Web UI 创建项目、目标和验收标准，不直接写 Conversation/Run/Task/Receipt
- 真实经过 RepositoryHarnessPlanner、Context Manager、Harness Coordinator 与 Task Tool
- 第一次 Browser/Playwright 验收提交失败回执，触发有界 `repair_verification`
- repair 执行中终止独立 dev server，等待 lease 过期后重启
- startup reconcile 回收 abandoned Attempt，复用同一 repair Action 并继续验证
- 第二次 Web UI 验收通过后，由 Closure Invariant 生成 DeliveryBundle 并在完成卡片展示
- 外部 LLM/ACP 仅在 HarnessRuntimePort 使用确定性测试适配器；该能力在生产环境始终返回 404
- 服务源码、SQLite 数据、被验收项目和 Web E2E 报告全部位于同一临时根目录，不向开发者
  原工作区写入 `.ath` 或验收证据

## 已知边界

- E2E 依赖 dev server + 数据库现有数据（种子 agent + 已配账号）。
- 涉及 OAuth/外部登录的流程不在本目录覆盖范围（沙箱网络隔离）。
- 不 mock 后端，观测真实链路；首次 A2A 用例不搜索历史 trace，但仍需要默认团队至少一个成员已绑定有效账号。
