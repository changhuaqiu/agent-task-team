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

## 第十六轮：删除未接线的 scopeGuard 伪门面

旧 `scopeGuard.ts` 同时暴露项目断言、兼容过滤与 private 可见性断言，但四个 guard 接口均无生产调用，只由同名测试直接证明自己存在；唯一生产 import 是 history layer 对一行数组过滤的浅包装。它依赖的 `ContextRecord/filterVisible` 同样只有自己的测试消费者，是第二套未接线可见性模型。真实组装链早已在 `ContextManager` intake 拒绝错项目/缺项目输入，并由 Context Registry 统一过滤 project/global scope 与 agent/role/team visibility。第十六轮将 history 过滤内联，删除两套兼容模块及其自嗨测试，并同步活动 ContextManager 规格、长期文档与架构图，只保留真实生产 owner。

## 第十七轮：删除 ACP-only 链中的恒等 CapabilityRouter

三种正式 runtime 已全部收敛到唯一 `AcpBackend`，但 daemon 前仍保留一套来自 bespoke CLI 时代的手工 `CapabilitySet` 与降级 router。当前唯一 backend 对 resume/system prompt/PTY 的声明完全相同，daemon 也不提交 maxTurns，因此 router 的唯一生产调用是恒等变换；其测试仅构造生产不可达的旧 CLI 合成能力矩阵。第十七轮删除该 router、手工能力矩阵和自嗨测试，把能力事实留给 Catalog、ACP initialize 握手与真实兼容测试，并让 daemon 的单一 `ExecOptions` 直接进入 `AcpBackend`。

## 第十八轮：收回浏览器对 Session 与 Invocation 生命周期的旧写入口

`/api/mutations` 曾同时承担 UI 数据写入和 Runtime 生命周期写入。随着 Task Graph、Session identity 与 Invocation Pipeline 成为唯一领域 owner，`task.delete` 别名以及 session create/bind/seal、invocation create/transition 七个动作已无任何生产调用，只剩 endpoint 自测；继续保留会让浏览器绕过版本、profile、runtime event 与 fencing 边界。第十八轮删除这些公开 case 及其自测：Task 取消只走 Task Graph `cancelTask`，Session 与 Invocation 只由服务端 owner 推进，浏览器保留投影读取而不写 Runtime 事实。

## 第十九轮：收敛 Phase 持久化 interface

`/api/phases` 已经实现阶段读取与写入，但 WebUI 的唯一写调用方仍通过通用 `/api/mutations` 的 `phase.upsert` / `phase.delete` 两个转发 case 持久化，形成两个公开 transport owner。`/api/state` 不包含 phases，因此独立 route 的 GET 仍承担真实启动水合；本轮把 store 写入迁到同一 route，删除 mutation 中的重复类型与 case，使 Phase CRUD 只保留 `/api/phases`，通用 mutation 从 14 种命令收敛到 12 种。

## 第二十轮：删除浏览器 Agent Tool 执行旁路

`/api/mutations` 的 `tool.invoke` 没有生产调用方，却复制了 task list/create/update/assign 的持久化、状态门禁和文件投影实现，并允许普通浏览器 payload 绕过 invocation grant、tool allowlist、task scope、rate limit 与 proof。正式工具链已经由 daemon 按 Invocation 注册短期 loopback bearer，通过 `/api/acp-tools` 与 `acp-skill-mcp` 进入唯一 `skill-tool-executor`。第二十轮删除旧 mutation case 及其自证测试，并把 `skill-tool-router` 从无消费者的 handler URL/mutation 映射收窄为真实工具名 allowlist；通用 mutation 从 12 种命令收敛到 11 种。

## 第二十一轮：删除无身份支撑的人工标注假能力

`/api/eval/annotations` 没有 UI、脚本或运行时调用方，唯一消费者是 endpoint 自测；它调用的 annotation 写入、一致性统计与 weighted kappa 也只由该 route 和同模块自测消费。更重要的是，旧接口把自由文本 `reviewerName` 变成 `local-reviewer:*`，平台没有可信身份事实源，无法证明两名独立审核者或形成可信校准。第二十一轮删除这条公开 route 与自循环 lab 逻辑，不把“未挂载且不可采信”包装成现有能力。历史 `eval_annotation` 表继续保留，retention 仍用它保护有关联的旧 run；未来只有在统一身份、独立审核流程和真实 UI 同时存在时才允许重新引入人工校准。

## 第二十二轮：删除浏览器平行 Task 生命周期

Task Authority 已使用 `proposed/ready/in_progress/blocked/in_review/done/cancelled` 正式状态，但浏览器仍维护 `pending/in_progress/in_review/done/rejected/blocked` 第二套 vocabulary，并在 `/api/state`、store hydration、socket sync 和 Kanban 多次降级转换。结果是 `proposed/ready/cancelled` 语义丢失，“拒绝”按钮提交服务端不存在的 `rejected`，新建任务还询问一个 `task.create` 完全忽略的初始状态。第二十二轮将纯 TaskStatus vocabulary 与合法迁移下沉到共享 interface，服务端 repository 与浏览器共同消费；删除 legacy projection、无效状态选择和重复迁移表。外部 TASKS.md 历史文本仍在服务端 intake 归一化，不把兼容复杂度泄漏回 UI。

## 第二十三轮：删除 Context Legacy Tier 往返

ContextManager 已以 Fragment/Artifact Registry 作为唯一结构化入口，但现有 Tier 内容仍先生成旧 BudgetPart，再包装成 `legacy.*` Fragment；Registry 归一化后，Manager 又按临时 id 恢复旧 part。该往返不提供新过滤或权限，只迫使 Registry 维护第二套 kind、owner、lifecycle、importance 映射，并让 BudgetGuard 继续暴露 P0–P4 `priority`。第二十三轮让四个 Tier renderer 直接产出稳定原生 Fragment，预算只消费 Artifact 的 `tier + delivery.importance + required`，删除 legacy 包装、反包装、priority 与未消费的 Skill 文件兼容字段；外部 Contributor、Snapshot 和 runtime transport 保持不变。

## 第二十四轮：删除 NoOp MemoryHook 假扩展点

ContextManager 曾为未来跨会话记忆预先冻结 `MemoryHook.recall/write`，但全仓只有一个 NoOp adapter、没有任何写入调用或真实存储实现；Context Planner 每轮注入 NoOp，Manager 再把恒空结果包装成内建 Contributor，并输出恒为零且无人消费的 `recalledArtifacts`。这条专用 seam 没有被第二个 adapter 验证，反而提前承诺了 scope、kind、evidence 与生命周期模型。第二十四轮删除该文件、构造参数、内建包装和假指标；现有 `ContextContributor` 继续作为唯一上下文来源扩展面，未来 durable memory 必须先建立真实 owner 与持久化/恢复契约，再通过同一 Registry 接入读取侧。

## 第二十五轮：收窄浏览器 Store 死 action

`TaskHubState` 长期保留八个没有真实生产调用方的 action：三个浅读取 wrapper，以及旧聊天迁移、手动水合标记、独立会话恢复、浏览器 blocker 修复入口和只被自身单测消费的进度消息构造器。它们没有产生运行价值，却扩大 Store interface，并让调用者误以为旧迁移、浏览器领域写旁路和一条未接线的进度消息生产链仍受支持。第二十五轮删除这些 action、死 helper 自测及其无 producer 的 `progressData`/`ProgressMessageCard` UI 尾巴，保留真实 `loadFromServer` 水合、消息对账、删除失败聚合回滚、blocker 展示投影、Socket receipt 写入，以及通过普通聊天、任务通知和工程协作 metadata 呈现的进度；组件读取原始状态继续使用 Zustand selector，领域写入继续走正式 Human Command interface。

## 第二十六轮：删除 Proof Log 验收回执假 admission

验收回执的真实生产入口已经是 `GateOutcomeProcessManager` 对结构化 `record_gate_decision` outcome 直接校验并原子写入 QualityGate evidence/decision 与 Delivery receipt，但 `verification-receipt.ts` 仍保留一条只被自身测试调用的旧链：从 Proof Event metadata 再解析 `delivery_evidence`，附加 verifier allowlist、本地 report/spec 文件与 junction 越界检查，并提供一个无任何消费者的失败回执构造器。这些代码不会保护真实运行，反而让测试和接口错误宣称 Proof Log 能重新授予 Gate 结论。第二十六轮删除旧 helper、policy 与 Proof 解析自嗨测试；正式契约要求的 report/spec 必须是冻结 Delivery project path 内真实存在的普通文件，并由 live receipt validator 拒绝缺失、junction 越界与未绑定可信来源的 HTTP(S) 字符串。未来若支持远端验收物，必须先建立 provider/attachment receipt，不在 Gate 数据库事务内发起网络探测。verifier 身份继续绑定 Work Contract，Proof Log 只作审计与投影。

## 第二十七轮：删除 socket transport 的 proposal policy 旁路

普通项目的首轮方案仍使用 `legacyProposal` 意图标记，自主项目则必须由 Delivery `plan_goal` 独占规划；该规则已经由 `InvocationPlanner` 基于持久化 DeliveryRun 统一执行，并覆盖 socket、Agent Inbox、重试与重启恢复。但 daemon 的 `submitSocketTerminalStart()` 还在 Coordinator 之前重复查询 DeliveryRun、写一条无生产消费者的 `legacy_proposal.suppressed` Proof 并提前返回，导致 socket 命令绕过统一幂等、busy、completion 与观测 seam。第二十七轮删除 transport 私有 policy 与 Proof；socket 只归一化并提交命令，`legacyProposal` 继续持久传递，唯一拒绝事实留在 Invocation Planner。普通非自主 proposal 与自主规划权威均保持不变。

## 第二十八轮：删除单调用者 CLI spawn 透传模块

ACP 已是唯一 Agent backend，但执行链仍保留 `cliBridge.spawnCli()`：它只有 `AcpBackend` 一个生产调用者，函数体仅把 command、args 与 options 原样转交 `cross-spawn`，不提供校验、错误归一化、生命周期或第二种 adapter。该浅模块还引用已被 ACP 规格替代的历史 `cli-bridge-layer`，扩大了当前执行 interface。第二十八轮删除文件与自证测试，让 `AcpBackend` 直接拥有 `cross-spawn`；Windows `.cmd/.bat` 解析、spawn 失败、stdio、取消和进程树清理能力均由原依赖与 backend 测试继续保护。

## 第二十九轮：收口终止事件归一化 owner

`AcpBackend` 已经用同一 `AgentResult` 为成功、失败、取消、超时和底层无终止事件的路径保证 `done`，但 daemon 又对 backend 返回的同一事件流调用一次 `withDoneGuarantee`。第二层只会观察并透传已有 `done`，不增加保护；独立 helper 也没有第二个 backend 消费者，却让 backend 与编排层看起来都能拥有终止协议。第二十九轮删除 daemon 二次包装和独立浅模块，把保证逻辑内聚为唯一 `AcpBackend` 的私有实现细节。`AgentBackend` 契约继续要求事件流恰好一个终止 `done`，daemon 只消费统一事件并推进 Runtime/Invocation 投影，不再解释或修复 backend 协议。

## 第三十轮：删除浏览器平行账号执行解析

Team Runtime Contract 已通过 `resolveRuntimeAgentProfile()` 统一解析成员、RoleCard、Skill、账号 readiness、provider 路由和 legacy engine，并由 Store 缓存给 UI 与正式派发复用；但任务详情仍单独调用 `resolveAgentEngine()`，后者经一行 `providerToEngine()` 再转发共享映射，并在解析失败时猜测 `agent.cliEngine ?? 'opencode'`。这套平行 interface 只有一个生产组件消费者，却复制领域规则并能展示正式执行会拒绝的假运行按钮；同一 mapping 还经两层 Store 无消费者重导出。第三十轮让任务详情直接消费缓存 `RuntimeAgentProfile`，Profile 为空即不提供运行入口；删除平行 resolver、转发别名、Store mapping facade 与自证测试。共享账号规则、Team Runtime 缓存、历史读取迁移和正式派发链保持不变。

## 第三十一轮：删除浏览器重复角色分类

RoleCard 已经是岗位身份、显示名、能力和行为边界的正式 owner，但浏览器 `Agent` 仍保留 deprecated `role / roleLabel`，通过两张硬编码映射表和 `getEffectiveRoster()` 二次投影继续维护 `planner / worker / reviewer` 三态与岗位文案。`role` 没有生产读取者，`roleLabel` 的调用点也都已持有 RoleCard；两个只查全局数组的 RoleCard lookup Store action 则完全没有消费者。第三十一轮删除这些兼容字段、映射、重导出和死 action，让成员名与岗位名分离：TeamPack 成员名固定来自 `TeamPackRole.displayName`，UI、任务详情与 @提及通过 Team Runtime 缓存解析 global/snapshot RoleCard；缺卡时保留成员名或省略岗位标签，不再猜测静态分类。账号、Skill 和正式派发保持不变。

## 第三十二轮：删除 ContextManager 静态团队 fallback

正式 Invocation 在进入 ContextManager 前已经由 Team Runtime 解析当前项目 roster，并无条件注入 `RuntimeAgent[]`；Knowledge Tier 却仍在 roster 为 `undefined` 时调用 `buildTeamLayer()`，通过浏览器 `AGENT_ROSTER + allRoleCards` 重建另一套静态团队。这条 fallback 没有第二个生产入口，`getAllRoleCards`、Tier 字段和独立 renderer 只为它存在，而且无法忠实表达动态 TeamPack snapshot 与项目成员名。第三十二轮删除整条平行 seam，把 runtime roster 收紧为必需数组；空数组表示没有团队内容，不恢复默认成员。当前 Agent RoleCard identity、Context Registry、预算、Snapshot、A2A 与 dispatch 保持不变。

## 第三十三轮：删除 TeamModeEngine 假想工作流 interface

Team Runtime 的正式任务创建只需要根据 TeamPack workflow 与当前 roster 选择初始负责人，但旧 `WorkflowPolicy` 还暴露零消费者的 `getNextAgent(taskResult)`，并为它保留独立 `TeamModeEngine`、四套 Strategy 的 `getNextRole` 与重复 `canCommunicate`。完整 Task 输入、task result、roleId 和 assignedAt 从未参与正式决策或持久化；所谓调用方 fallback 参数同样没有任何生产传入者。真正的 A2A 通信规则已经由独立 `CommunicationPolicy` 读取同一 communication matrix，后续任务推进也归 Task Graph / Platform Harness。第三十三轮删除这组假接口、独立 Strategy module、伪分配结果对象与无调用者 fallback，把四模式初始选择内聚到 Team Runtime 的 `selectInitialAgent()`；显式负责人优先、runtime roster、A2A admission 与 TeamPack 数据模型保持不变。
