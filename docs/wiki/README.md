# Agent Task Hub — Code Wiki

本 Wiki 以“代码事实”为主线，描述 Agent Task Hub 的整体架构、主要模块职责、关键数据结构/函数、依赖关系与运行方式，便于快速上手与二次开发。

## 导航

- [01-整体架构](./01-architecture.md)
- [02-前端（Next.js App Router）](./02-frontend.md)
- [03-领域模型与状态仓库（Zustand）](./03-store-model.md)
- [04-后端守护进程（Express + Socket.io）](./04-backend-daemon.md)
- [05-运行与开发](./05-run-and-dev.md)
- [06-依赖与集成点](./06-dependencies.md)

## 快速定位入口

- 前端页面入口：[`src/app/page.tsx`](../../src/app/page.tsx)
- 全局状态与 Socket 事件中枢：[`src/store/taskHubStore.ts`](../../src/store/taskHubStore.ts)
- 后端 Socket/进程守护：[`backend/server.js`](../../backend/server.js)
