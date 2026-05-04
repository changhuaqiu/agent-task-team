# Agent Task Hub — Code Wiki

本 Wiki 以“当前代码事实”为主线，描述项目在本轮重构后的真实形态：项目工作台、SQLite 持久化、Agent Backend 抽象、账号配置与多运行时执行链路。

## 导航

- [01-整体架构](./01-architecture.md)
- [02-前端（项目工作台）](./02-frontend.md)
- [03-领域模型与状态仓库（Zustand + API Rehydrate）](./03-store-model.md)
- [04-后端执行链路（API + SQLite + Daemon + Agent Backend）](./04-backend-daemon.md)
- [05-运行与开发](./05-run-and-dev.md)
- [06-依赖与集成点](./06-dependencies.md)
- [07-架构图（基于当前代码）](./07-architecture-diagrams.md)

## 最短上手路径（从 0 到可运行）

1. 启动：`pnpm install && pnpm dev`
2. 打开 Web：`http://localhost:3000`
3. 创建项目：
   - 左侧项目栏点击 `+`
   - 选择一个项目进入当前上下文
4. 配置运行账号：
   - 右上角「设置」
   - 在 `模型账号` 分区添加并验证账号
   - 如需要，再为角色卡绑定账号
5. 在中间作战指挥室推进任务：
   - 发起对话
   - 查看拆解状态
   - 打开任务详情执行 CLI

## 快速定位入口

- 前端主入口：[`src/app/ClientHome.tsx`](../../src/app/ClientHome.tsx)
- 项目工作台：[`src/components/project/ProjectWorkspace.tsx`](../../src/components/project/ProjectWorkspace.tsx)
- 状态与前端编排：[`src/store/taskHubStore.ts`](../../src/store/taskHubStore.ts)
- 状态加载 API：[`src/pages/api/state.ts`](../../src/pages/api/state.ts)
- 持久化 mutation API：[`src/pages/api/mutations.ts`](../../src/pages/api/mutations.ts)
- Daemon 实现：[`src/server/daemon.ts`](../../src/server/daemon.ts)
- SQLite / Drizzle：[`src/server/db`](../../src/server/db)
- Repo 层：[`src/server/repositories`](../../src/server/repositories)
- 设置与账号入口：[`src/components/task-hub/SettingsDrawer.tsx`](../../src/components/task-hub/SettingsDrawer.tsx)
