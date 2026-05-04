# 06 — 依赖与集成点

依赖清单来自 [`package.json`](../../package.json)。

## 6.1 运行时依赖（dependencies）

- `next` / `react` / `react-dom`
  - Next.js App Router 前端框架与渲染运行时
- `zustand`
  - 全局状态、前端编排与 Socket 事件接入
- `tailwindcss`（通过 `@import "tailwindcss"` 在 `globals.css` 引入）
  - 以 utility class + CSS variables 的方式实现主题与组件样式
- `clsx` + `tailwind-merge`
  - 在 `src/lib/utils.ts` 组合为 `cn()`，用于合并条件 class
- `lucide-react`
  - 图标库（任务状态、按钮、UI 装饰）
- `@xterm/xterm` + `@xterm/addon-fit`
  - Web 终端（`TerminalView`）
- `socket.io-client`
  - 前端连接后端守护进程（`taskHubStore.ts`）
- `better-sqlite3`
  - SQLite 驱动，作为应用当前默认持久化方案
- `drizzle-orm`
  - 数据库访问与 schema 映射
- `express` + `socket.io`
  - `socket.io` 用于默认 daemon；`express` 主要保留给独立 daemon / 可选后端场景

## 6.2 开发依赖（devDependencies）

- `typescript` + `@types/*`
  - TypeScript 编译与类型支持
- `eslint` + `eslint-config-next`
  - Lint，配置入口为 [`eslint.config.mjs`](../../eslint.config.mjs)
- `@tailwindcss/postcss`
  - Tailwind v4 的 postcss 集成
- `drizzle-kit`
  - SQLite schema / migration 工具链
- `vitest`
  - 当前测试框架

## 6.3 内部模块依赖关系（简图）

```
src/app/ClientHome.tsx
  ├─ src/components/project/*
  ├─ src/components/task-hub/*
  └─ src/store/taskHubStore.ts

src/store/taskHubStore.ts
  ├─ fetch('/api/state')
  ├─ fetch('/api/mutations')
  └─ socket.io-client → /api/socketio → src/server/daemon.ts

src/pages/api/state.ts
  └─ src/server/repositories/*
      └─ src/server/db/*

src/server/daemon.ts
  ├─ src/server/agent/factory.ts
  ├─ src/server/repositories/*
  ├─ child_process / backend adapters
  └─ fetch('{bridge}/run')（Bridge 模式）
```

## 6.4 外部集成点（真正的“系统边界”）

- `opencode` CLI
  - 本地可执行：daemon 直接调用 `opencode run --format json`
  - Bridge：daemon 通过公网 URL 调用本机转发服务，将执行落到本机 opencode
  - attach（可选）：Bridge 可用 attach 模式连接本机已有实例
- 网络端口
  - Next.js：默认 `3000`（同时承载 UI + daemon）
  - Bridge：默认 `8787`（本机进程，可改）
- 数据库
  - SQLite：本地文件数据库，无需额外服务
