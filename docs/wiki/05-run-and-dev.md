# 05 — 运行与开发

## 5.1 环境要求（建议）

- Node.js：建议 20.x（至少满足 Next.js 16 的运行要求）
- 包管理器：推荐 pnpm（仓库同时存在 `pnpm-lock.yaml` 与 `package-lock.json`）

## 5.2 安装依赖

```bash
pnpm install
```

## 5.3 启动（开发模式）

默认情况下，只需要启动一个 Next.js 进程（内置 daemon）：

```bash
pnpm dev
```

启动后访问：`http://localhost:3000`

> 如果端口被占用，Next 会自动选择其它端口；以终端输出为准。

## 5.4 连接 Opencode（真实执行）

如果你的 Web 跑在远程环境/容器中，无法直接调用你本机安装的 `opencode`，推荐使用 **Opencode Bridge（本机转发）**。

### A) macOS / Linux：安装检查与启动 Bridge

安装检查（可选自动安装 opencode）：

```bash
bash scripts/opencode-bridge-install.sh
# 或自动安装：
# bash scripts/opencode-bridge-install.sh --install-opencode
```

启动（run 模式）：

```bash
bash scripts/opencode-bridge-start.sh --port=8787 --mode=run
```

启动（attach 模式，可连接本机已有实例）：

```bash
bash scripts/opencode-bridge-start.sh --port=8787 --mode=attach --attach-url=http://localhost:4096
```

### B) Windows：安装检查与启动 Bridge

安装检查（可选自动安装 opencode）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\opencode-bridge-install.ps1
# 或自动安装（示例）：
# powershell -ExecutionPolicy Bypass -File .\scripts\opencode-bridge-install.ps1 -InstallOpencode -Method scoop
```

启动：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\opencode-bridge-start.ps1 -Port 8787 -Mode run
```

### C) Web：设置页配置

1. 将 `http://localhost:8787` 暴露成公网可访问 URL（推荐 https）
2. 打开 Web → 右上角「设置」→「Opencode Bridge（本机转发）」：
   - 粘贴 URL
   - 点「检测」
   - 点「启用」

完成后，任务详情中会出现“运行 Opencode”（当本地 opencode 或 Bridge 可用时）。

## 5.5 可选：独立 daemon（非默认）

仓库保留了 `backend/server.js` 作为“独立 daemon”的可选实现，用于你希望将 daemon 独立部署/运行的场景。默认路径不需要它，且文档应避免把它作为唯一启动方式。

## 5.5 生产构建与运行

```bash
pnpm build
pnpm start
```

注意：当前默认 daemon 内置在 Next.js 中；如你改用独立 daemon，需要自行编排与对齐 Socket 地址。

## 5.6 Lint

```bash
pnpm lint
```

## 5.7 常见问题排查

- 终端无输出：检查 daemon 是否连接成功（设置页显示 Daemon 状态），以及 Bridge 是否检测通过并启用
- Bridge 不可用：确认公网 URL 可访问，且 `GET {url}/health` 返回 200
