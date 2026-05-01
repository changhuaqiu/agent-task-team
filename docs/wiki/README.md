# Agent Task Hub — Code Wiki

本 Wiki 以“代码事实”为主线，描述 Agent Task Hub 的整体架构、主要模块职责、关键数据结构/函数、依赖关系与运行方式，便于快速上手与二次开发。

## 导航

- [01-整体架构](./01-architecture.md)
- [02-前端（Next.js App Router）](./02-frontend.md)
- [03-领域模型与状态仓库（Zustand）](./03-store-model.md)
- [04-Daemon（Socket.io + Opencode 执行桥接）](./04-backend-daemon.md)
- [05-运行与开发](./05-run-and-dev.md)
- [06-依赖与集成点](./06-dependencies.md)

## 最短上手路径（从 0 到可执行）

1. 启动：`pnpm dev`
2. 打开 Web：`http://localhost:3000`
3. 右上角「设置」：
   - 配置 Opencode Bridge（本机转发）：填公网 URL → 检测 → 启用
   - 确认 Daemon 已连接
4. 创建会话/任务后，在任务详情中运行 Opencode 观察终端输出

## 快速定位入口

- 前端页面入口：[`src/app/page.tsx`](../../src/app/page.tsx)
- 全局状态与 Socket 事件中枢：[`src/store/taskHubStore.ts`](../../src/store/taskHubStore.ts)
- Daemon 实现：[`src/server/daemon.ts`](../../src/server/daemon.ts)
- 设置页（配置入口）：[`src/components/task-hub/SettingsDrawer.tsx`](../../src/components/task-hub/SettingsDrawer.tsx)
