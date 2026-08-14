# 05 — 运行与开发

## 5.1 环境要求（建议）

- Node.js：建议 20.x（至少满足 Next.js 16 的运行要求）
- 包管理器：pnpm 10.33.2；`pnpm-lock.yaml` 是唯一依赖锁定事实源
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

## 5.5 连接 Agent 运行时（ACP）

Agent 执行经 **ACP（Agent Client Protocol）单一通路**驱动（见 [`architecture/cli-integration.md`](../../architecture/cli-integration.md)）。daemon 通过 Agent Catalog 查表启动对应运行时，无需手工配置执行链路；需要在本机/运行环境准备的是各运行时自身的认证：

- **opencode**（原生 ACP）：本机安装 `opencode`，daemon 启动 `opencode acp`。
- **claude**（ACP 适配器）：主机完成 Claude Code OAuth 登录（`~/.claude/`）或设置 `ANTHROPIC_API_KEY`；daemon 启动 `npx -y @agentclientprotocol/claude-agent-acp`。
- **codex**（ACP 适配器）：主机完成 ChatGPT OAuth 登录（`~/.codex/auth.json`）；daemon 启动 `npx -y @agentclientprotocol/codex-acp`。

>
> TODO：若需“远程 Web → 本机运行时”的执行能力，需基于 ACP runtime 重新设计远程编排方案（当前未定，不在本期范围）。

### 默认用户路径

当前默认用户路径仍是：在「设置 → 模型账号」添加并验证账号，必要时在「角色卡」中完成账号绑定，然后在项目中创建任务并执行。

## 5.6 SQLite / 本地数据

当前项目使用 SQLite 作为默认持久化层。

开发时需要注意：

- 页面首次加载会调用 `/api/state`
- mutation 会写入 SQLite
- session / invocation / event 也会持续写入数据库
- 首次初始化时（migration v2），4 个预设 skill（code-review、tdd、debugging、brainstorm）会被自动种子到数据库；migration v5 后 task-management skill 也会被种子并自动分配给 Mario
- dispatch 持久化：服务端 `agent_inbox_item` 保存待执行 Command，进程崩溃后由
  Inbox Scheduler 恢复；浏览器 `pendingDispatches` 只是项目展示投影
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

## 5.7 生产构建与运行

```bash
pnpm build
pnpm start
```

## 5.8 代码检查与测试

```bash
pnpm lint
pnpm test
pnpm build
```

## 5.9 常见问题排查

- 页面卡在初始化：优先检查 `/api/state` 是否报错，以及本地 SQLite / repo 初始化是否正常
- 终端无输出：检查 daemon 是否连接成功、账号是否可用、执行链路是否选择到正确 engine
- 运行时无输出：确认对应 runtime（opencode / claude / codex）已在本机安装并通过认证（OAuth / API Key）；daemon 经 ACP 启动子进程，认证缺失或 runtime 未安装会直接报错（不再经 Bridge 转发）
- 某个 agent 一直 busy：检查是否存在旧 invocation 未结束，或 daemon 超时后未正确回收
- Skill 导入失败：确认 Git 仓库 URL 可访问且包含 `skills/{name}/SKILL.md` 目录结构；检查目标仓库是否有 `..` 或绝对路径等非法路径
- Skill 未注入 systemPrompt：确认 agent 已通过 `/api/agents/{id}/skills` 绑定 skill，且首次唤醒时 `isFirstWake` 为 true
