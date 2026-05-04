# 05 — 运行与开发

## 5.1 环境要求（建议）

- Node.js：建议 20.x（至少满足 Next.js 16 的运行要求）
- 包管理器：推荐 pnpm（仓库同时存在 `pnpm-lock.yaml` 与 `package-lock.json`）
- SQLite：默认由应用自动初始化，无需单独启动数据库服务

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

## 5.4 当前推荐上手流程

1. 启动 `pnpm dev`
2. 打开 `http://localhost:3000`
3. 创建一个项目
4. 打开设置进入 `模型账号`
5. 添加并验证账号，必要时在 `角色卡` 中完成账号绑定
6. 在项目中创建任务并打开任务详情执行 CLI

## 5.5 连接 Opencode（真实执行）

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

### C) 接入说明

1. 将 `http://localhost:8787` 暴露成公网可访问 URL（推荐 https）
2. 将该 URL 作为 daemon 或本地调试链路的一部分注入执行环境

说明：

- 当前前端没有完整的 Bridge 管理界面
- Bridge 仍可用于开发链路或定制集成
- 当前默认用户路径仍是“模型账号 / 角色卡”

## 5.6 SQLite / 本地数据

当前项目使用 SQLite 作为默认持久化层。

开发时需要注意：

- 页面首次加载会调用 `/api/state`
- mutation 会写入 SQLite
- session / invocation / event 也会持续写入数据库
- 首次初始化时（migration v2），4 个预设 skill（code-review、tdd、debugging、brainstorm）会被自动种子到数据库；migration v5 后 task-management skill 也会被种子并自动分配给 Mario
- dispatch 持久化：`pendingDispatches` 现在同步写入 SQLite invocation 表，进程崩溃后可恢复
- dispatch 去重：同 agent+task 的追加指令会自动合并，不会创建重复 dispatch

文件系统结构（新增）：

```
.ath/
  *.db                          ← SQLite 数据库
  workspaces/                   ← Workdir 隔离根目录（ATH_WORKSPACES_ROOT 可覆盖）
    {projectId}/
      {agentId}/
        base/                   ← 跨 task 共享基础环境（node_modules 等）
        task-{taskId}/
          workdir/              ← agent 执行 cwd
          .session.json         ← session 续接信息
          .gc_meta.json         ← GC 元数据（完成后写入）
```

如果你遇到“页面状态和预期不一致”，优先排查：

- 旧 SQLite 数据是否残留
- 当前项目上下文是否切换到正确 conversation
- 账号与 runtime 状态是否可用

## 5.7 可选：独立 daemon（非默认）

仓库仍保留 `backend/server.js` 作为“独立 daemon”的可选实现，但当前默认链路并不依赖它。

## 5.8 生产构建与运行

```bash
pnpm build
pnpm start
```

注意：当前默认 daemon 内置在 Next.js 中；如你改用独立 daemon，需要自行编排与对齐 Socket 地址。

## 5.9 代码检查与测试

```bash
pnpm lint
pnpm test
pnpm build
```

## 5.10 常见问题排查

- 页面卡在初始化：优先检查 `/api/state` 是否报错，以及本地 SQLite / repo 初始化是否正常
- 终端无输出：检查 daemon 是否连接成功、账号是否可用、执行链路是否选择到正确 engine
- Bridge 不可用：确认公网 URL 可访问，且 `GET {url}/health` 返回 200
- 某个 agent 一直 busy：检查是否存在旧 invocation 未结束，或 daemon 超时后未正确回收
- Skill 导入失败：确认 Git 仓库 URL 可访问且包含 `skills/{name}/SKILL.md` 目录结构；检查目标仓库是否有 `..` 或绝对路径等非法路径
- Skill 未注入 systemPrompt：确认 agent 已通过 `/api/agents/{id}/skills` 绑定 skill，且首次唤醒时 `isFirstWake` 为 true
