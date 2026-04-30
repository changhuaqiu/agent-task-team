# 05 — 运行与开发

## 5.1 环境要求（建议）

- Node.js：建议 20.x（至少需要满足 Next.js 16 的运行要求）
- 包管理器：推荐 pnpm（仓库同时存在 `pnpm-lock.yaml` 与 `package-lock.json`）

## 5.2 安装依赖

```bash
pnpm install
```

## 5.3 启动（开发模式）

本项目通常需要两个进程：

### A) 启动后端守护进程（Socket.io + opencode 桥接）

```bash
node backend/server.js
```

默认监听：`http://localhost:4000`

### B) 启动前端开发服务器（Next.js）

```bash
pnpm dev
```

默认访问：`http://localhost:3000`

## 5.4 “Run Opencode” 的先决条件

如果你希望在 UI 里点击 “Run Opencode” 能真正跑起来，需要满足：

- 本机存在 `opencode` 可执行文件（后端通过 `spawn('opencode', ...)` 调用）
- 有一个可 attach 的 opencode 会话在运行，并可通过 `http://localhost:4096` attach

否则：

- 前端 UI 仍可正常浏览（任务/聊天/状态流转在内存中）
- “Run Opencode” 会在终端区域显示失败输出（由后端子进程返回）

## 5.5 生产构建与运行

```bash
pnpm build
pnpm start
```

注意：`pnpm start` 只会启动 Next.js 服务；`backend/server.js` 仍需要单独部署/启动（除非你额外做进程编排）。

## 5.6 Lint

```bash
pnpm lint
```

## 5.7 常见问题排查

- 前端无法连接后端：检查 `src/store/taskHubStore.ts` 中 Socket 地址固定为 `http://localhost:4000`
- 终端无输出：检查后端是否在运行、以及 `opencode attach` 是否能成功连接 `http://localhost:4096`
