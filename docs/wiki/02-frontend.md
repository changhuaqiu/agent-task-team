# 02 — 前端（Next.js App Router）

## 2.1 目录结构

- `src/app/`
  - `layout.tsx`：RootLayout、字体、全局样式引入
  - `page.tsx`：主界面（看板 + 聊天室 + 弹窗/抽屉）
  - `globals.css`：设计系统（CSS Variables）+ Tailwind v4 导入
- `src/components/task-hub/`：Task Hub 相关 UI 组件集合（以展示与交互为主）
- `src/store/`：Zustand 全局状态与 Socket 监听
- `src/lib/utils.ts`：`cn()`（clsx + tailwind-merge）

## 2.2 页面入口：Home

主页面为 [`src/app/page.tsx`](../../src/app/page.tsx)，整体布局是“三段式”：

- Header：标题 + New Task 按钮（打开 `NewTaskDialog`）
- SummaryBar：按 `TaskStatus` 汇总数量
- Main：两列布局
  - 左侧：任务看板（按 active agents 渲染多列 `AgentTaskGroup`）
  - 右侧：全局聊天室（`GlobalChatRoom`，仅在大屏 `lg` 展示）
- Overlay：任务详情抽屉（`TaskDetailPanel`）+ 新建任务弹窗 + Agent roster 弹窗

页面层的状态依赖来自 store：

- `activeAgents = useTaskHubStore(selectActiveAgents)`
- `selectedTaskId = useTaskHubStore((s) => s.selectedTaskId)`

## 2.3 UI 组件职责（task-hub）

### 看板与任务

- [`AgentTaskGroup.tsx`](../../src/components/task-hub/AgentTaskGroup.tsx)
  - 展示某个 agent 的任务列
  - 对任务按 `STATUS_ORDER` 排序
  - done 任务单独折叠展示
  - dismiss agent 时做了“如果仍有任务则阻止”的前端校验
- [`TaskCard.tsx`](../../src/components/task-hub/TaskCard.tsx)
  - 单任务摘要卡片（状态、描述、deps/artifacts 数量）
  - 点击后 `setSelectedTaskId(task.id)` 打开详情抽屉
- [`TaskDetailPanel.tsx`](../../src/components/task-hub/TaskDetailPanel.tsx)
  - 任务详情抽屉：展示 assignee、依赖、artifacts、review note、时间戳
  - 状态流转按钮：调用 `updateTaskStatus(task.id, targetStatus)`
  - 当任务处于 `in_progress` 时提供 “Run Opencode”
  - 内置终端区域：使用 `TerminalView` 渲染 `terminalLogs[agentId]`

### 聊天室

- [`GlobalChatRoom.tsx`](../../src/components/task-hub/GlobalChatRoom.tsx)
  - 展示 `chatMessages`
  - 发送消息：调用 `addChatMessage({ agentId:'human', content, referencedTaskId? })`
  - 支持 `#TASK-xxx` 引用（正则 `/#TASK-\d{3}/i`）
- [`ChatMessageItem.tsx`](../../src/components/task-hub/ChatMessageItem.tsx)
  - 单条消息渲染：avatar、时间、intent badge、@mention 高亮、引用任务跳转
  - 支持 approval request：`updateChatMessageStatus(msgId, approved|rejected)`

### Agent roster 与状态展示

- [`AgentRosterModal.tsx`](../../src/components/task-hub/AgentRosterModal.tsx)
  - 展示可招募的 agents（`selectAvailableRoster`）
  - 招募：`inviteAgent(agentId)` 并发一条 agent 入群消息
- [`StatusBadge.tsx`](../../src/components/task-hub/StatusBadge.tsx)
  - 统一渲染任务状态（颜色/图标/label 来自 `taskHubStore.ts`）
- [`PixelAvatar.tsx`](../../src/components/task-hub/PixelAvatar.tsx)
  - 以 8x8 inline SVG 的像素头像实现 agent theme 风格

### Web 终端

- [`TerminalView.tsx`](../../src/components/task-hub/TerminalView.tsx)
  - 基于 `@xterm/xterm` + `@xterm/addon-fit`
  - 监听 `terminalLogs[agentId]` 变化，清屏并重放日志（简化同步）

## 2.4 样式与设计系统

全局样式位于 [`src/app/globals.css`](../../src/app/globals.css)：

- Tailwind v4：`@import "tailwindcss";`
- 主题变量：`--bg-* / --text-* / --agent-* / --status-* / --accent-*` 等
- 提供 light/dark 两套变量（跟随 `prefers-color-scheme`）
- 组件通过 `bg-[hsl(var(--...))]` 使用变量，从而在 Tailwind 中实现主题化
