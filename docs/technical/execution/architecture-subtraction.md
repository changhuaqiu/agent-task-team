# Architecture Subtraction

> Status: implemented
> Date: 2026-08-13

## Decision

仓库只保留正在产生运行价值的 Module、源文件和事实文档。依赖与构建产物由 lockfile、源码和构建命令恢复；未挂载 UI、只被自身测试调用的未来机制、以及已被当前事实 owner 替代的兼容 repository 不再作为“可能以后会用”的平行架构保留。

## Deleted Surfaces

- 七个未挂载 UI：`ChatHubView`、`WorkspaceRootRow`、`RoleCardBindingSelector`、`AgentTaskGroup`、`SummaryBar`、`FormField`、`QualityView`。
- 四个只有自身测试调用的孤立 Module：native child activity、native tool classifier、autonomous review receipt parser、evaluation runtime isolation helper。
- 两个只有测试调用且已被当前 owner 替代的 repository：`dispatchRepo`、`eventRepo`。
- 一个只有自身测试调用的旧 message router。
- `mcp-server/node_modules` 与 `mcp-server/dist` 共 3,972 个被错误跟踪的依赖/生成文件。

## Retained Boundaries

- Next.js 路由保留，即使没有静态 import；文件系统就是其运行入口。
- ACP mock 与测试 fixtures/helpers 保留；它们有明确测试 Adapter 职责。
- 未合入 `main` 的分支和 worktree 保留，不以“看起来旧”作为删除依据。
- 数据库中的历史表不在本轮破坏性删除；本轮只删除无生产消费者的访问 Module。

## Prevention

`.gitignore` 现在忽略任意层级 `node_modules/` 与 `dist/`。Git/Worktree 规范明确子包同样不得提交依赖或构建产物。
根 `pnpm build` 只构建当前 Next 应用；逐 Invocation MCP 工具属于 Next daemon 源码，不需要独立子包或预编译产物。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过，依赖可由 lockfile 与本地 store 恢复。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- 相关架构、routing、repository 测试：88/88 通过。
- `pnpm build`：通过。
- 全量测试：1496/1498 通过；ACP subprocess 超时用例单独重跑通过，`control-runtime` 的 human-resume 场景仍稳定复现基线失败，未被本轮改动触及。

## Filesystem Cleanup Note

历史 worktree 的 Git 注册与已合入分支已清理。Windows 拒绝递归删除部分已注销目录中的锁定或超长路径依赖文件，因此这些目录不再是 Git worktree、也不包含待保留提交，但仍可能存在纯磁盘残留；不得把它们误认为活动开发分支。

## Round 2: Runtime Reachability

第二轮从 Next.js 页面/API 与 daemon 入口反推静态 import 图，继续删除不可达功能：旧任务卡、独立项目选择器、workspace 标题 helper、War Room 时间线链、mention parser 和流式文本持久化器。后两者只有自身测试消费者；时间线链唯一外部引用是读取其源码文本的架构测试。此类测试不再作为保留生产死文件的理由。

## Round 3: One Evaluation Interface

评估 Pages API 只保留 `/api/eval/*`。原 `/api/evaluations/*` 与 `/api/eval/*` 暴露相同能力，后者却通过 13 个浅转发 Module 依赖前者，导致 UI、测试和文档长期混用两套公开 Interface。第三轮把实现迁入规范路径并直接删除兼容目录，不保留无退出条件的转发层。

## 第四轮：删除已退役的 OpenCode HTTP Bridge

Agent 执行已经统一到 ACP，但仓库仍保留一条没有生产消费者的 `opencodeBridgeUrl` 隐藏执行分支，以及对应 HTTP Bridge 服务、安装/启动脚本、package commands 和两个状态 API。第四轮整链删除这些资产；OpenCode 继续作为原生 ACP runtime 受支持，不删除其 launcher、probe、账号或配置能力。

## 第五轮：删除独立 daemon 与 standalone MCP 原型

仓库曾保留 `backend/` 独立 Socket.IO daemon 与 `mcp-server/` stdio 包，但前者仍私有解析 `opencode run`，后者默认端口和 Socket path 与前者不匹配，并硬编码旧 6-Agent 阵容、`default` 项目和 mock 旁路。当前正式路径是 Next daemon + Control Plane + ACP，以及 daemon 按 Invocation 注入的 loopback、短期授权 MCP 工具。第五轮删除这两个无消费者并行入口，同时去掉 workspace 子包、root 构建负担与仅由旧 daemon 使用的 `express` 直接依赖。

## 第六轮：删除无消费者的浅层 API transport

`/api/tokens/summary` 没有任何调用方；聊天 Token 展示直接消费消息段上的 `tokenUsage`。`/api/engineering-collaboration` 同样没有调用方且生产默认关闭，工程协作正式入口已经由受控 Skill 工具直接调用 `EngineeringCollaborationService`。第六轮只删除这两个浅层 Pages API transport，保留 Token UI、工程协作领域服务、GitHub verifier、消息投影和 AgentOutcome 的独立契约。

## 第七轮：收敛 ACP 真实运行探针

早期 `probe-acp-nosdk.mjs` 通过未锁版本的 `npx` 手写 initialize，`verify-daemon-acp-routing.ts` 则重复拼装 catalog、runtime setup、capability 与 done guarantee；两者均无 package、文档或 CI 入口。第七轮删除这两个孤立探针，保留文档化、使用 Catalog 锁定 launcher 且覆盖 session resume 的 `scripts/smoke-acp-runtime.ts`，模块行为继续由自动化测试保护。

## 第八轮：收敛包管理事实源

项目安装、workspace、README、setup 与冻结门禁均使用 pnpm，但根目录仍保留一份长期未更新、继续声明已删除 `express` 的 npm lockfile。第八轮删除 `package-lock.json`，只保留 `pnpm-lock.yaml`；同时去掉无直接引用的 `highlight.js` 直依赖（高亮能力仍由 `rehype-highlight` 传递提供），并将纯编译期的 `@types/cross-spawn` 归位到 devDependencies。
