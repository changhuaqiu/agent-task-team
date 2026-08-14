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

## 第九轮：删除平行 Drizzle schema

数据库真实建库、升级与查询长期由 `better-sqlite3`、`src/server/db/migrate.ts` 和 repositories 承担，但仓库仍维护一份没有任何 import、生成脚本或运行入口的 1436 行 `schema.ts`，并为它保留 `drizzle-orm` 与无配置入口的 `drizzle-kit`。第九轮删除这套平行事实源及依赖，只保留真实 SQLite 链路；同时删除 Chokidar 5 已自带声明后遗留的 `@types/chokidar`。

## 第十轮：收敛评估公开 interface

评估手动提交已经由 `POST /api/eval/runs` 承担，但仍保留无消费者、仅转发同一 handler 的 `/api/eval/triggers`；pairwise 在统一身份与可信隔离尚未完成时也暴露一条永远返回 409 的假公开 route。第十轮删除这两个浅 interface，保留真实 runs 提交入口、内部 pairwise 算法和未来开放条件。

## 第十一轮：删除前端假控制面

独立 `/settings/integrations` 页面重复汇总设置抽屉已有的账号、角色、技能和团队信息，并维护 Provider Profile、Channel、Routing Policy 三类只在页面和 localStorage 中自循环、运行时从不读取的配置。第十一轮删除整页、假配置状态和专属测试，设置抽屉成为唯一用户入口；持久化升级到 v7 并清除旧僵尸键；`terminal:start` 同时删除 provider、channel、auth context 和账号候选数组等服务端从不消费的协议尾巴，只保留真实执行参数。

## 第十二轮：删除前端 Mock Runner 兼容层

浏览器 store 仍保留空的 `refreshRuntimeCatalog()`、无调用方的 `getAvailableRuntime()` 和没有用户入口的 `enableMockRunner`；两条 `terminal:start` 还发送 daemon 从不读取的 `allowMockRunner`。生产 engine/runtime map 甚至继续声明 `mock-runtime`，并指向已经删除的 `backend/mock-opencode.js`。正式运行时可用性已经由 daemon 推送，执行统一通过 ACP Catalog。第十二轮删除这些空 seam、状态、UI 旁路、协议字段和不可执行的生产 mock runtime 身份，持久化升级到 v8 并清除旧键；自动化测试内部的 mock ACP agent 继续保留。

## 第十三轮：删除 tmux 平行执行链

daemon 的 `ATH_TMUX_ENABLED` 分支被文档描述为 ACP 的可选观察模式，实际却在 backend 构造前直接拼接厂商私有 CLI 参数、送入 tmux pane 后提前返回，绕过统一 ACP 事件、session 确认和 Invocation 终结。`TmuxGateway`、`AgentPaneRegistry` 与 OpenCode legacy 参数模块没有其他生产消费者。第十三轮删除整条平行执行链，runtime context transport 收窄为 `acp`；终端 UI 继续消费 Runtime/ACP 投影，不依赖 tmux。

## 第十四轮：删除假 Gemini Agent runtime

Google/Gemini API Key 账号能够由 OpenCode provider 配置消费，原生 Gemini CLI 也能独立验证 API Key 连接；但浏览器 store 与 Team Runtime 曾把 Google 映射到 Catalog 不存在的 `gemini` engine，形成“配置成功、派发必失败”的假能力。第十四轮保留用户账号、模型建议和真实连接验证，将 Google API Key 的正式 Agent 执行统一映射为 `opencode`，并为每次执行显式生成 Google provider、选中模型与密钥环境；无法桥接到 OpenCode 的 Google OAuth 不再允许创建或进入执行解析。生产 engine 类型、daemon runtime map 与 Invocation Planner 不再声明 `gemini` / `gemini-cli`。历史浏览器对象和不可变评估快照只在读取边界迁移到 OpenCode；daemon 对其他未知或不匹配的显式 engine/runtime 失败关闭，不恢复第四条 backend。

## 第十五轮：删除账号验证旁路与 OAuth 假可达

账号“测试连接”曾与正式 backend 分叉：Google/Kimi 分别运行厂商 CLI，OpenCode 运行主机默认配置，Other 更只执行 `echo "ok"`；同时 Kimi、OpenCode、Other OAuth 没有任何可注入 OpenCode 的身份，却仍可创建并被 Runtime 选择。第十五轮将 provider-to-engine、认证模式、Base URL 与 execution readiness 收口到共享账号规则；所有映射到 OpenCode 的 provider 只接受已验证、密钥和模型完整的 API Key 账号，并使用与 daemon 同构的临时 OpenCode provider/model/env 配置执行连接测试。连接字段变化会撤销既有验证，浏览器、服务端规划、评估快照恢复与 daemon 启动前均失败关闭。Gemini/Kimi/Other probe command 与只被自身测试调用的 `probeCli` wrapper 删除；Anthropic/OpenAI OAuth 仅因其 ACP Adapter 明确复用主机登录态而保留。
