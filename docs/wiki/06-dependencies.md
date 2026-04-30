# 06 — 依赖与集成点

依赖清单来自 [`package.json`](../../package.json)。

## 6.1 运行时依赖（dependencies）

- `next` / `react` / `react-dom`
  - Next.js App Router 前端框架与渲染运行时
- `zustand`
  - 全局状态：任务、聊天、终端日志、弹窗状态、Socket 事件落库
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
- `express` + `socket.io`
  - 后端守护进程（`backend/server.js`）

## 6.2 开发依赖（devDependencies）

- `typescript` + `@types/*`
  - TypeScript 编译与类型支持
- `eslint` + `eslint-config-next`
  - Lint，配置入口为 [`eslint.config.mjs`](../../eslint.config.mjs)
- `@tailwindcss/postcss`
  - Tailwind v4 的 postcss 集成

## 6.3 内部模块依赖关系（简图）

```
src/app/page.tsx
  ├─ src/components/task-hub/*
  │    ├─ src/store/taskHubStore.ts
  │    └─ src/lib/utils.ts
  └─ src/store/taskHubStore.ts

src/store/taskHubStore.ts
  └─ socket.io-client  →  backend/server.js (socket.io)

backend/server.js
  ├─ socket.io
  └─ child_process.spawn('opencode', ['attach', 'http://localhost:4096'])
```

## 6.4 外部集成点（真正的“系统边界”）

- `opencode` CLI
  - 当前后端实现依赖该二进制存在于 PATH
  - 通过 `opencode attach http://localhost:4096` 接入一个外部会话
- 网络端口
  - `3000`（前端）、`4000`（后端）、`4096`（opencode 会话）
