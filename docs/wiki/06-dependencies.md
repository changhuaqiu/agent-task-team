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
- `socket.io`
  - 用于 Next 应用内的默认 daemon 与浏览器实时事件连接

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

src/pages/api/skills/*
  ├─ src/server/repositories/skill-repo.ts
  └─ src/server/db/*

src/lib/agent-context/layers/skillLayer.ts
  ├─ src/server/repositories/skill-repo.ts (via getSkillsForAgent)
  └─ src/lib/agent-context/PromptComposer.ts

src/server/daemon.ts
  ├─ src/server/agent/acp/catalog.ts (loadCatalog + createBackend)
  ├─ src/server/agent/acp/acpBackend.ts (唯一 AgentBackend 实现)
  ├─ src/server/repositories/*
  └─ child_process (ACP stdio JSON-RPC)

src/lib/agent-context/PromptComposer.ts
  ├─ src/lib/agent-context/layers/roleLayer.ts
  ├─ src/lib/agent-context/layers/skillLayer.ts
  ├─ src/lib/agent-context/layers/projectLayer.ts
  ├─ src/lib/agent-context/layers/teamLayer.ts
  ├─ src/lib/agent-context/layers/historyLayer.ts
  ├─ src/lib/agent-context/layers/taskContextLayer.ts
  ├─ src/lib/agent-context/layers/userMessageLayer.ts
  └─ src/lib/agent-context/layers/behaviorLayer.ts
```

## 6.4 外部集成点（真正的“系统边界”）

> 更新（ACP 迁移）：agent 执行为单一 ACP 通路（见 [`architecture/cli-integration.md`](../../architecture/cli-integration.md)）。历史上 daemon 曾直接调用 `opencode run --format json` 并支持 Bridge（默认端口 `8787`）转发到本机 opencode；这些 per-engine CLI 直接调用与 Bridge 执行路径已在 ACP 迁移中移除（spec §7 / §8）。

- Agent 运行时（经 ACP 接入，daemon 唯一 backend 通路，与 6.3 的依赖树一致）
  - `opencode`（原生 ACP）：daemon 启动 `opencode acp`
  - `claude`（ACP 组织适配器）：daemon 启动 `npx -y @agentclientprotocol/claude-agent-acp`
  - `codex`（ACP 组织适配器）：daemon 启动 `npx -y @agentclientprotocol/codex-acp`
- 网络端口
  - Next.js：默认 `3000`（同时承载 UI + daemon）
- 数据库
  - SQLite：本地文件数据库，无需额外服务
