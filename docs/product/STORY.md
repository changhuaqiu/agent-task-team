---
topics: [product-story, user-outcomes, optimization, evidence]
doc_kind: product-story
created: 2026-08-02
updated: 2026-08-30
---

# Agent Task Hub 产品故事

这里记录产品优化带给用户的真实变化。

它不是代码变更日志，也不替代 spec、技术设计或测试报告。技术文档回答“系统如何实现”，故事文档回答“用户原来遇到什么、现在有什么不同、我们凭什么确认它真的变好了”。

## 维护规则

当一次优化产生用户可感知的效果时，交付前必须在本文件增加或更新一条故事。每条故事至少包含：

- 原来的用户处境，而不是内部错误码的堆叠；
- 优化后的可感知变化；
- 能复核的效果证据；
- 尚未改变的边界或历史记录；
- 对应 spec、产品文档或技术设计的链接。

只有直接覆盖所述用户效果的证据，才能支持“已经改善”：例如针对性自动化测试、真实界面观察或实际运行链验证。构建通过只能作为可交付性的辅助证据，不能单独证明用户体验已经改善。未验证目标不进入本故事文档，应留在 spec、计划或任务清单中。

---

## 2026-08-30：OpenCode Agent 不再“已接球但启动失败”

### 原来的处境

用户把工作交给 Luigi、Peach 后，平台虽然显示命令已接纳，实际运行却会继承本机已经失效的 OpenCode 默认模型并返回认证失败；两个 Agent 同时启动还会争用共享数据库和同秒日志。失败随后被包装成聊天中的“未返回最终文本”，收件箱和对话被 Runtime 噪音占据，真实 Invocation 甚至已经执行工具却仍显示 `starting`。

### 优化后的变化

- OpenCode 的模型选择只有一个实时 Catalog 解析入口，Daemon 配置和 ACP fallback 都显式写入同一个可用文本模型；
- 平台 worker 以 `--pure` 和独立 `XDG_CONFIG_HOME` 启动，保留宿主认证，但不继承用户全局插件、MCP 和失效默认模型；
- 多 Agent 只串行易冲突的冷启动握手，ready 后仍由 Agent Pool 并发执行；
- ACP update 统一补齐 Session identity，第一条执行事件即可把 Invocation 推进到 `running`；
- Runtime 失败进入 Project 顶部状态栏和可观测记录，不再合成聊天答复或 Inbox 条目；后续成功会清除旧失败提示。

### 已验证的效果

真实 OpenCode ACP smoke 在隔离配置下约 2 秒完成文本回复并以 `done` 收口。最终桌面 EXE `desktop-build-2facfabbf9bbb191887566fc91d295e5` 同时触发 Luigi、Peach 后使用 `deepseek/deepseek-v4-flash` 与 `opencode --pure acp`；Luigi 将在线面试任务推进到评审，Peach 跑通 `/summary` 成功和 400 失败路径。最终状态回归中 Peach Invocation 在约 5.4 秒内进入 `running` 并绑定真实 ACP Session。全量 270 个测试文件通过，1952 项通过、2 项按既有配置跳过；Next/TypeScript/Rust EXE 构建通过。

### 仍然保留的边界

Peach 的完整浏览器 E2E 仍需要项目明确授予浏览器 Skill；本轮没有伪造 gate decision。WiX `light.exe` 在当前机器仍无法生成 MSI，但 release EXE 已生成并运行，不影响本次本地桌面验收。

### 设计与实现依据

- [ACP 运行时统一接入规范](../../specs/acp-runtime-integration/spec.md)
- [统一 ACP 执行链](../technical/execution/opencode-integration-executable-chain.md)
- [Agent 可观测性](../technical/observability/agent-observability.md)

---

## 2026-08-30：规划与续作的“已接纳”终于等于真的会执行

### 原来的处境

协调 Agent 可以收到 `propose_task_graph` 已应用回执，但任务图 payload 随后才在异步处理器中失败，Task 仍是 todo、没有负责人；它再提交 `continue_work` 时，平台也可能只保存一条检查点而不启动下一轮。用户看到的是一份完整的恢复说明，系统实际没有任何 Agent 会继续工作。

### 优化后的变化

- planning Contract 冻结任务图 revision，结构化 MCP 公开真实 tasks 字段，由平台补齐 authority；
- 任务图、已有 WorkItem 负责人、依赖和可运行 Agent Inbox 与 accepted outcome 同事务落账，任一步失败只返回 rejected；
- 项目外 Agent、过期 revision、循环依赖以及执行中/终态任务改写都会在占用退出槽前拒绝；
- 独立任务和 A2A 恢复的 `continue_work` 会原子排入下一轮命令并保留 Possession authority，最多三次；Delivery 仍沿用既有控制面容量与续作策略。

### 已验证的效果

定向测试覆盖合法规划即时派发、依赖完成后唤醒、历史升级/事件幂等重放、错误 payload、冻结 revision 绕过、项目外 Agent、执行中任务保护、Delivery 接管，以及 standalone/A2A continuation 的即时排队、去重、stage/subject/Possession 权限保持和预算耗尽。最终 ESLint、TypeScript、269 个测试文件（1941 项通过、2 项按配置跳过）和桌面服务 production build 通过；三轮独立代码审查最终无 Critical/Important。

### 仍然保留的边界

升级前已经 accepted、但 payload 本身不完整的历史任务图 outcome 不会被伪造为成功；恢复处理器会保留其失败证据，需要以新 Contract 提交合法 proposal。Delivery continuation 的调度与容量模型没有改变。

### 设计与实现依据

- [Outcome Commit Atomicity 归档规格](../archive/specs/outcome-commit-atomicity/spec.md)
- [平台 Harness 状态机设计](../technical/execution/platform-harness-state-machine-design.md)
- [前端控制面收敛设计](../technical/execution/frontend-control-plane-convergence.md)

---

## 2026-08-28：Agent 回复回到“思考与结果”，协作交接不再因隐藏协议字段失败

### 原来的处境

一次 Agent 工作会在聊天里铺开几十条工具名称、参数和结果，用户真正关心的思考方向与最终答复反而被淹没。更严重的是，协调 Agent 按 `work_handoff` 工具公开契约提交 Luigi、Peach 的分派后，平台仍会因为 payload 内缺少第二份幂等键连续返回 `a2a_outcome_invalid`；任务留在 todo，Agent 又把内部失败码和“等待新合同”写成面向用户的最终答复。

### 优化后的变化

- Project 聊天与 Agent Activity 使用同一个响应投影：Runtime thinking 以低权重摘要呈现，最终答复直接可读；
- 同一 Invocation 的工具事件只形成一个“已处理 N 个操作”回执，执行问题保留计数，工具名、参数与逐条结果只在用户主动打开调用详情后出现；
- 实时 thinking delta 与持久 thinking segment 使用同一数据语义，刷新或重连后不会退化为普通正文；
- thinking 与工具观察不会成为跨 Project 收件箱条目，只在对应回复和调用详情中出现；
- 同一 Agent 同时执行多个 Invocation 时，每个回复拥有独立的实时气泡和完成边界；工具失败刷新后仍保留执行问题计数，同时不会误触发“收到项目消息”类 Automation；
- `work_handoff` MCP 直接声明 branches 字段，Agent 只提交一个公共幂等键，ACP Adapter 负责映射到 A2A canonical payload，不再要求模型猜测并重复内部身份字段；可纠正的 lifecycle 拒绝要求 Agent 在同一轮修复重试，不能再把内部 reason code 当作最终用户答复。

### 已验证的效果

- 真实历史数据副本中 43 个 Invocation 操作回执均未在聊天主线暴露工具名，点击回执仍能打开完整调用详情；
- thinking/final/tool presentation、并发 Invocation 隔离、实时与持久消息投影、Automation 边界、Agent Activity 和 ACP handoff contract 的定向回归 52 项通过；
- 两轮全量并行 Vitest 均完成 269 个文件：每轮 1915 项通过、2 项按既有配置跳过，并各自遇到 1 个不同的非本次范围并发敏感基线用例失败；两个失败用例隔离复跑均通过。TypeScript 与生产构建通过。

### 仍然保留的边界

旧历史没有持久化 thinking 的记录不会被反向生成；只有升级后产生的 Runtime thinking 才能在刷新后继续显示。工具轨迹没有删除，只是从普通协作阅读层降到用户主动进入的 Invocation 观察层。工具失败若需要用户处理，仍必须由领域 owner 转成正式阻塞或待决策事实。

### 设计与实现依据

- [Buzz 产品旅程借鉴](ux/2026-08-25-buzz-product-journey-adoption.md)
- [前端与架构重构规格](../../specs/frontend-architecture-refactor/spec.md)
- [命令驱动交付规格](../../specs/command-driven-delivery/spec.md)
- [前端控制面收敛设计](../technical/execution/frontend-control-plane-convergence.md)

---

## 2026-08-25：Project 成为持续协作空间，Agent 也终于有稳定的桌面运行内核

### 原来的处境

用户本质上在多个产品空间里与多个 Agent 长期协作，但页面要求先理解并创建“交付”，项目、任务、聊天、评审和产物入口
彼此竞争；Agent 又只是页面或设置中的一组配置，执行进程按轮次临时启动。页面断开、会话复用、权限和结果提交之间缺少
稳定边界，因而“能触发”不等于“能稳定运行并形成正式结果”。

### 优化后的变化

- Workspace 以收件箱、Project、Work、Review、Artifact 为稳定对象面；Project 默认进入持续协作流，不再先创建 Delivery；
- Project 内只创建工作或发起评审，评估和诊断收进次级入口但仍可到达；全局只保留一个“添加项目”主流程；
- 创建工作和发起评审都等待权威回执；被拒绝或失败时保留弹窗与输入并原位提示，不再以关闭弹窗伪装成功；
- Agent 成为完整的一等能力对象，直接拥有身份、工作指令、技能、权限、OpenCode/Claude/Codex 运行环境和活动/信息/运行/频道/技能视图；不再先创建角色素材再装配 Agent；
- Automation 可通过正式命令创建 Work，并以持久 Decision 等待用户批准/拒绝后继续；定义代码可复制/导入但不会携带项目身份或运行历史；
- Release 成为 Project 中按需创建的已验证结果快照，只有所选 Work/Review 通过权威检查后才能发布，不再要求先创建交付容器；
- Settings 只管理模型账号、运行环境和共享 Skills；Agent Team 只选择真实 Agent identity，成员缺失时明确拒绝运行，不复制 persona、账号、Skill 或 Runtime 快照；
- Agent 创建默认继承本机运行环境；协作条会把这一状态明确显示为“使用运行环境的登录状态”，不会因为没有单独绑定账号而误报为不可运行；
- `@Mario 开始处理` 现在只会让协调者接住目标、拆解并分派，不会因为附近存在一个未分配 Work 就直接修改代码；Agent 的主要职责成为 Definition 中可见、可编辑的结构化事实，普通 Human/A2A 消息没有 Task 或服务端独立工作 subject 时只能进入规划。
- daemon 长期持有受监管 ACP Worker，按 lane 排队并复用健康 transport；每轮重新签发最小 MCP 权限，正式工作必须用
  已接纳的结构化终态回执结束，单纯文本或进程退出不会伪造完成；
- 结构化 MCP 是 Agent 主路径，`ath` CLI 使用同一命令回执作为通用接口和逃生仓；
- Project 回复不再把引用内容拼进正文：服务端校验 `replyToMessageId` 的 Project 作用域并派生稳定 `threadRootId`，消息流与 Inbox 使用同一 Thread 身份；
- 收件箱不再把 `Read`、`Bash` 或结构化 MCP 调用当成跨 Project 更新；工具调用与结果只保留在对应 Agent 回复的运行记录中，正式阻塞或待决策事实仍可进入“需要处理”；
- Agent 接球、派发和交接不再插在聊天内容之间或占用输入器附近；它们固定在 Project 视图导航下方的顶部状态栏，“查看记录”向下覆盖展开，不改变消息视口和输入器高度；
- 重复的同步/运行活动在短时间内合并为一条带次数的摘要，`work.created`、`review.created` 和评审结论则从 domain event 单独投影为“已确认事实”卡；
- Skill 导入与其他创建器统一：失败保留输入、关闭脏草稿前确认，用户界面不再混用英文操作文案；
- Project 内新增完整 Automation 对象面：用户从卡片浏览行为，用同一个创建/编辑器选择事件、条件、定时或手动触发，再顺序添加“通知项目/交给 Agent”；创建默认关闭，启用、立即运行和每次运行记录都可在原卡片完成；
- Project“产物”不再要求用户或 Agent 维护第二套创建表单：成功文件写入会自动出现为“处理中”，随工作结果提交的同一引用原位升级为“已登记”；最近产物和真相源会自动进入下一次 Agent 上下文，接力者不靠聊天记忆寻找结果；
- Automation Run 现在冻结触发时的 Definition revision、Trigger 与 Actions；运行记录可展开每一步的状态、时间、输出和错误，永久失败可重试同一个 Run，后续编辑不会改变排队中的执行内容；
- Tauri Host 在窗口显示前完成随机 loopback Service、secret/protocol/build/PID 握手；关闭窗口不终止工作，重复启动只恢复同一窗口。

### 已验证的效果

- 对 Buzz v0.5.18 原生 EXE 与本地源码逐项审计了 Inbox、Channels、Agent 创建/资料、Settings/Compute、Projects、Tasks、
  Reviews、Workflows 与 CLI/ACP/EventQueue/AgentPool；学习的是其产品定位下的对象、引用、事件和运行时边界，没有照搬
  其尚未持久化审批恢复的 Workflow 缺陷；
- 在真实 Agent Task Hub EXE 中逐项点击 Project、收件箱、Agents、Agent Team、模型账号和 Runtime Catalog；验证了 Agent/Team/自定义 ACP 的渐进创建表单，以及 Work、Review、Artifact、评估实验室和运行诊断等 Project 对象入口；
- 通过桌面 UI 实际创建一条 Work，首次提交暴露历史错误 `artifacts: {}` 会让 Renderer 调用 `.map` 崩溃；修正后命令写入 `[]`，hydration 与 socket 投影对非数组旧值 fail-soft，重启最新 EXE 后同一错误数据也能正常显示；
- 通过 Project 协作流实际发送 `@Mario` 消息，统一事件链创建 Invocation，经 Codex ACP Worker 执行并调用结构化生命周期工具；WebSocket 超时后自动回退 HTTPS，最终在同一个 Agent 回复对象返回“桌面协作链路已收到”，诊断投影记录完成状态、1184 tokens、工具调用和约 139 秒耗时；
- 针对 Mario 误实现事故增加了真实 `HumanCommandService → A2A → AgentInbox → InvocationPlanner` 回归：同一个 Project 中先创建未分配 Work，再发送原始“@mario 看到消息了吧，开始处理吧”，最终合同固定为 coordinator/planning、`allowCodeChanges=false` 且没有任务提交出口；同链路的无 Task `@luigi 开始处理` 也保持 planning。Task 在准入后改派会于签约事务失败关闭；Claude ACP worker 另有 Session Mode 回归，验证 planning/default 每轮显式重置且 setMode 失败时不发送 prompt。
- Windows 原生 Host 的冷启动、Service PID、关闭隐藏、单实例恢复和最终窗口渲染通过；自包含 Service 无 junction，也未携带
  `.ath` 用户事实库或旧 bundle；
- 最终原生 EXE 逐项复核 Workspace Activity、Review 筛选、Project/Review 计数、全局 Work 打开详情、Agents/Profile、独立 Runtime 与 Runtime Catalog；待评审在所有镜头统一显示为 1，正式 Review 作为独立活动事实出现；
- 在真实页面中，连续 36 条同义“测试有新活动”只显示为一条 `×36` 摘要；Skill 导入输入测试地址后关闭会出现“继续编辑/放弃改动”，选择继续编辑并清空后未产生导入数据；
- 在真实 3103 页面逐项打开 Settings、Agent 信息、新建 Agent、Agent Teams 和新建团队：设置导航只有模型账号/运行环境/技能，Agent 信息明确显示“指令来源：Agent 自身”，创建器没有角色素材选择，团队创建只提供已有 Agent 多选；
- 在真实 3103 Project 页面创建“手动验收通知”，确认保存后为未启用；显式启用并立即运行后，旧 daemon 中的 pending Run 在重启后被耐久 Dispatcher 自动恢复为已完成，运行历史和 Project 协作流分别出现终态与通知，页面控制台无错误；
- Automation Command 完整信封幂等、Definition 版本历史/激活水位、Run snapshot、事件去重、schedule claim、循环隔离、临时失败 durable replay、AgentInbox、消息触发、API 与页面逐步 trace/重试均有回归；最终全量 259 个测试文件通过、2 个跳过，1871 项测试通过、2 项跳过；Next production build 通过并仅保留既有 9 条动态文件追踪警告；
- Agent Definition ownership 架构门禁、Runtime Prompt、Task 通知、评估快照和旧自主控制面完成回归；全量 255 个测试文件通过、2 个跳过，1859 项测试通过、2 项跳过；Next production build 通过并仅保留既有动态文件追踪警告；
- Artifact Ledger 的服务端投影与上下文定向测试覆盖成功写入、未完成/只读/越界过滤、Project 隔离、传统 Task 与直接 A2A Outcome 的同 ref 正式证据升级、`.ath` 内部状态过滤和 briefing 注入；页面组件测试覆盖两种状态、筛选、搜索、来源 Agent 映射、复制引用以及不存在“创建产物”入口。
- 在真实桌面数据中先复现“验收结果已结构化接纳但产物为 0”：该结果来自 A2A WorkContract 而非传统 Task，证据没有 `task_artifact_ref`。修正后同一历史数据库无需迁移即可投影出 `ACCEPTANCE-REPORT-TASK-001.md`、测试与 live DB 证据，并明确归属 Luigi；Project 产物页不再显示空态。
- 在真实桌面数据中复现 Project 产物页把 31 条文件定位、计划引用、控制文件和验证文本混成一列，来源角色只能进入详情、同一实现还会被协调者的上下文引用抢占归属。修正后页面按“贡献角色列 → 实现 / 设计与文档 / 验证与评审 → 产物卡片 → 详情”阅读；同一数据库无需迁移即可收敛为 Luigi 的 9 项有效交付（实现 4、文档 1、验证 4），`file://`、绝对路径和行范围归一为同一文件，Mario 的计划引用及 `TASKS.md` 控制投影不再冒充交付件。定向服务端与页面组件 7 项测试、TypeScript、受影响文件 ESLint 及全量 268 个测试文件通过（2 个跳过，1923 项通过、2 项跳过），并在本地浏览器用生产数据备份确认角色、类别、计数和详情一致；最终代码审查为 0 Critical / 0 Important，Next production build 与 Rust release build 通过，Renderer build 为 `desktop-build-ccce924c0344d653eaae26acb19f3617`。
- 结构化回复、Thread 聚合、活动折叠和事实卡相关 36 项定向测试通过；本轮全量回归 1870 项通过、2 项跳过，唯一失败是旧 evaluation 恢复测试仍断言 schema 101，修正为当前 103 后该测试及相关回归通过；Next production build 通过并保留既有动态文件追踪警告。
- TypeScript、受影响文件 ESLint、Next production build 与最终代码审查（0 Critical / 0 Important）通过；全量 253 个测试文件中 251 通过、2 跳过，1851 项测试通过、2 跳过；Rust release build 通过。最终桌面 Renderer build 为 `desktop-build-992ae195b3db1c55cc3bbeabee9bdbbe`。

- Agent 接球/派发/交接状态栏已进一步从输入器下方提升到 Project 视图导航正下方；在最终原生 EXE 中确认“⚡ Luigi · 未接纳 / Agent 启动失败”位于主内容上方，“查看记录”从顶部状态栏向下覆盖展开，消息区与输入器均不移动。相关组件 10 项测试通过；全量 264 个测试文件中 262 通过、2 跳过，1879 项测试通过、2 项跳过；TypeScript、受影响文件 ESLint、Next production build 与 Rust release build 通过。Renderer build 为 `desktop-build-6654ba9c70269c5955edccb3f0421008`。
- 在修正前的真实 EXE 收件箱中复现了 `Read`、`Bash`、`Write` 和生命周期 MCP 的独立条目；最终 EXE 对同一持久数据完成对账后已无“使用工具”条目，Work、Agent 更新和人的消息仍在。Workspace Inbox 与 Runtime Trace 定向回归 7/7 通过，全量 264 个测试文件中 262 通过、2 跳过，1879 项测试通过、2 项跳过；TypeScript、受影响文件 ESLint、Next production build 与 Rust release build 通过，Renderer build 为 `desktop-build-710b6313bda05f51ee05a109f34acfc3`。

### 仍然保留的边界

Task、Artifact、Gate 和 Release 还没有全部迁入 Product Command Kernel，因此尚不能宣称“所有领域写入只有一个
CommandService”；当前桌面开发版仍依赖系统 Node，renderer session 尚未覆盖所有兼容 HTTP/WebSocket，Host crash 的
整棵进程树约束、托盘、deep link、MSI/签名和自动更新仍属于发布门禁。
Thread 详情侧栏、精确消息深链、提醒/草稿 Inbox 类型和 Release 创建仍未完成；Automation 首批动作只覆盖项目通知与 AgentInbox，调用任意已注册 Product Command 和持久人工 Gate 将在后续切片扩展。Buzz 原生窗口当前还有用户未保存的 Agent 草稿，未获确认前不会为了继续点验而放弃它。
Artifact Ledger 当前只识别 ACP 标准化工具事件中的路径字段与 patch header；Shell 内部发生但 Runtime 未结构化报告的文件写入不会被猜测为产物，PR/Review 外部真相源的自动发现仍待接入对应 owner。

### 设计与实现依据

- [Buzz 全功能与创建逻辑审计](ux/2026-08-16-delivery-workspace-refactor.md)
- [统一事件与 Agent Runtime](../technical/execution/unified-event-agent-runtime.md)
- [桌面 Host 目标架构](../technical/execution/desktop-host-target-architecture.md)
- [命令驱动交付规格](../../specs/command-driven-delivery/spec.md)

---

## 2026-08-23：团队活动终于像一个持续工作的协作现场

### 原来的处境

用户进入一个 Delivery 后，目标摘要、自主运行面板和聊天被纵向挤在同一页。活动区只剩较小空间；切换到另一交付时，上一交付的草稿还会留在输入框里并阻止发送；引用操作把整段正文直接塞进输入框。用户上翻阅读时虽不会总被拉到底部，却不知道是否有新活动，也缺少明确的返回入口。这个页面更像几个功能块拼在一起，而不是可长期停留的团队工作现场。

### 优化后的变化

- Delivery 固定提供“概览 / 活动 / 评估”三个 surface；活动获得完整纵向空间，切换 surface 不改变当前 Delivery，也不销毁活动现场；
- 每个 Delivery 有独立本地草稿，切换交付或刷新页面后恢复自己的内容，不再把 A 的要求带到 B；
- 引用回复先显示来源、摘要和取消入口；该轮当时只保存可见引用文本，现已由 2026-08-25 的结构化 Thread relation 替代；
- 用户上翻时保持阅读位置，新活动出现时提供“回到最新”入口，自己发送成功后回到底部；
- 消息操作在鼠标悬停、键盘聚焦和触屏场景都可发现，输入区改为稳定的底部 composer。

### 已验证的效果

- 5 个定向测试文件共 18 项通过，覆盖三 surface、交付级草稿隔离与恢复、引用预览/持久文本以及有界活动窗口；仓库全量 238 个测试文件、1772 项通过，2 个文件/2 项按既有条件跳过；
- TypeScript、受影响文件 ESLint 与 Next.js production build 通过；全仓 ESLint 仍被本次范围外的 219 个既有错误阻断，本次涉及文件没有新增 lint 问题；
- 在隔离数据目录的真实 1280×720 页面中验证活动 surface 独占工作区、概览隐藏、composer 可见；草稿经过“概览 → 评估 → 活动”切换和整页刷新后仍恢复，浏览器控制台无错误或警告；
- 桌面 Renderer 产物已重新生成，构建标识为 `desktop-build-99e062c8844600c0c1fc9e0e16215584`。

### 仍然保留的边界

本条记录的是当时边界；服务端 `replyToMessageId/threadRootId` 与持久 Inbox 未读投影已在 2026-08-25 补齐。Thread 详情侧栏和精确消息深链仍未完成。活动交互借鉴 Buzz/Telegram 的连续时间线原则，没有复制品牌、视觉资产或把 Project 改造成频道。

### 设计与实现依据

- [交付工作区前端决策](ux/2026-08-16-delivery-workspace-refactor.md)
- [前端与控制面收敛架构](../technical/execution/frontend-control-plane-convergence.md)
- [活动实现规格](../../specs/frontend-architecture-refactor/spec.md)

---

## 2026-08-23：Project 和 Delivery 终于各归其位

### 原来的处境

用户管理多个项目时，旧页面把 `Conversation` 当“项目”，真实 `projectPath` 只是一段隐藏字段；Project、Delivery、聊天和 Agent 运行状态互相争抢首页。第一版桌面重排又把 Buzz 的 CommunityRail 误映射为 Project 图标轨道，虽然层次变多，却没有理解 Project 与一次交付的关系。

### 优化后的变化

- Web 与桌面共用一个 Renderer：顶部收敛为轻量窗口 Chrome，Tauri 只增强拖拽和 Host 能力；
- 工作区侧栏提供一个“交付总览”入口，并以真实目录命名 Project；Project 展开后才显示它的 Delivery；
- 交付总览和侧栏共享同一投影：顶部组合指标回答整体情况，“继续工作”直接回到最近交付，Project 区展示长期目录上下文、任务进度和开放阻塞，不引入第二套事实 Store；
- 选择 Delivery 后进入稳定详情，目标、验收、任务、活动和 Agent 协作仍属于同一个交付闭环；
- 没有交付时只保留一个创建入口和一个解释 Project / Delivery / Agent 协作关系的中心空态，不再挂载团队、空时间线、禁用输入框或无意义模式切换；
- 工作区侧栏可收放，窄窗口仍保留清楚的主动作和当前交付入口。

### 已验证的效果

- 组件定向回归覆盖总览投影、Project 分组、跨 Project/外部创建选择、交付详情和零数据空态：6 个测试文件、23 个用例全部通过；
- 仓库全量回归：237 个测试文件通过、2 个跳过，1769 个用例通过、2 个跳过；类型检查、受影响文件 ESLint 和生产构建全部通过；
- 真实生产页面在 1280×720 与 800×600 两档窗口下均无横向或纵向溢出；全局只出现一个“新建交付”主入口，工作区侧栏可从 260px 收至 56px 并恢复，空态没有挂载聊天输入和工作检查器；
- 桌面 Renderer 产物已重新生成并写入构建标识 `desktop-build-bc849405691a4266f077421dbd2db881`。

### 仍然保留的边界

Project 当前仍由 `projectPath` 投影，尚未引入独立 Project 数据表；因此没有 Delivery 的空 Project 还不能单独存在。桌面发行中的 Rust toolchain、Node runtime 打包、签名、自动更新、托盘和深链继续按桌面 Host 规格推进。

### 设计与实现依据

- [交付工作区前端决策](ux/2026-08-16-delivery-workspace-refactor.md)
- [前端与控制面收敛架构](../technical/execution/frontend-control-plane-convergence.md)
- [活动实现规格](../../specs/frontend-architecture-refactor/spec.md)

---

## 2026-08-23：多个项目里的 Agent 工作不再各走一套触发逻辑

### 原来的处境

用户同时推进多个项目和交付时，补充要求、任务开始、评审、Agent 交接和失败恢复分别走不同的后台入口。
界面可能已经显示“接手”，但底层 Agent Runtime 还没有真正建立执行；同一 Agent 的长任务也会让后续工作频繁
重试。用户感受到的是协作偶发失联、重复唤醒，或者结果回来后找不到原任务。

### 优化后的变化

- 所有 Agent 工作都用同一种持久请求表达“哪个项目、哪个 Agent、做什么、为什么触发、结果回到哪里”；
- 同一请求重放不会重复建工作，内容冲突会明确拒绝；同项目同 Agent 串行，不同 Agent 可以并行；
- 只有 Runtime 建立 Invocation、Session 和真实执行句柄后才确认接手，准备失败不再制造假“已启动”；
- 浏览器断开不影响排队事实，A2A 分支、任务、质量门和交付结果都能沿持久回复地址回到各自 owner；
- 慢启动使用有界准备窗口，繁忙 Agent 的重试会退避，不再形成高频空转。

### 已验证的效果

- 生产领域直接创建/投递 AgentInbox 的入口从 5 个降为 0，并由静态架构测试阻止回归；
- WorkRequest 重放/冲突、同 Agent 串行、跨 Agent 并行、租约恢复、A2A 回调、ACK 前后失败和慢启动窗口均有
  确定性自动化覆盖；
- 全量回归 1727 项通过、2 项跳过，TypeScript、核心受影响文件 ESLint 与 Next.js production build 通过。

### 仍然保留的边界

这些证据证明组件契约已经稳定，不等价于真实 Agent 任务成功率已经提升；后者仍需固定任务集的 E 级 paired
experiment。当前只接通本地 daemon，远端 Runtime transport 仍然明确拒绝。内部仍保留 `Conversation` 作为
Project 的持久化兼容表名，但用户与新协作契约使用 Project/Delivery 语义。

### 设计与实现依据

- [统一协作内核](../technical/execution/collaboration-kernel.md)
- [统一事件、身份与 Agent Runtime](../technical/execution/unified-event-agent-runtime.md)
- [变更评测记录](../technical/evaluation/2026-08-23-collaboration-kernel-evaluation.md)

---

## 2026-08-02：被唤醒的队友终于会回来

### 原来的处境

用户在群聊里 `@` Agent，平台看起来已经接纳任务，但 Agent 迟迟不回来。界面有时还会因为任务状态不兼容而崩溃，消息输入框随之消失。即使后台在周期恢复，同一批过期动作也可能反复阻断后续工作。

对用户来说，这不是三个技术故障，而是同一个体验：**任务像被系统吞掉了，既不能继续交付，也无法判断团队是否还在工作。**

### 优化后的变化

- 聊天页面能够稳定打开，消息输入框保持可见；
- 看板把受管任务状态转换为用户界面能够理解的“待处理、进行中、评审中、已完成”等状态，不再因为内部状态词崩溃；
- Claude Agent 唤醒时直接使用已安装并锁定版本的 ACP 适配器，避免在每次唤醒中临时启动包管理器；
- Claude 原生后台子代理仍由父会话承接，子任务输出不会落到平台无法管理的后台等待中；
- 恢复批次遇到过期工作时会取消该动作并继续处理仍有效的队友任务，不再让一个过期动作卡住整批恢复。

### 已验证的效果

- 生产服务重建并重启后，浏览器中的聊天输入区和看板正常渲染且没有错误；
- 旧看板使用的状态投影没有暴露非法状态；
- 重启后一次由调度器触发的 Claude 唤醒正常完成，未再出现 `write EPIPE`；
- 真实 Claude ACP 烟测完成并返回可见文本；
- 相关回归测试、TypeScript 检查和 Webpack 生产构建通过。

### 仍然保留的边界

历史失败记录仍会保留用于审计，因此旧消息中可能继续看到过去的 `acp_startup_failed`。它表示曾经发生过故障，不代表重启后的新唤醒仍在失败。故事中的效果以新 invocation 和当前界面状态为准。

### 设计与实现依据

- [唤醒恢复实施归档](../archive/specs/wakeup-recovery/spec.md)
- [群聊任务图与状态投影](../technical/execution/group-chat-task-graph.md)
- [统一 ACP 执行链](../technical/execution/opencode-integration-executable-chain.md)

---

## 2026-08-24：Project、Agent 与结果终于回到各自的位置

### 原来的处境

用户同时在多个产品空间里协作，但页面仍要求先理解 Conversation、Delivery、Runtime、账号和团队角色的拼装关系。Project 被塞进旧交付树，Agent 在设置页以一排执行下拉框出现，聊天与运行结束又很容易被误读成正式结果。Agent 触发不稳定时，用户既不知道“谁在工作”，也不知道结果是否真正进入任务、产物和评审事实。

### 优化后的变化

- 全局导航固定为工作动态、Agents 和 Projects；Workspace 的动态、项目、工作、评审、产物是同一事实集的不同镜头；
- Project 是可创建的长期目录和协作边界，进入后直接看到常驻消息与事实流，底部输入可以立即触发 Agent；工作、评审和产物是同一事实集的正式镜头，不再创建空 Delivery，也不再先打开协作侧栏；
- Agent 成为一级对象：Directory、Profile、活动、运行、频道、工作指令、Skills、账号、模型和工作权限在同一个对象里管理；不存在独立角色素材或团队能力层。活动来自真实消息与 Invocation，运行页不伪造尚未接通的 supervisor 状态；Agent Team 只选择 Agent 与协作关系，Settings 只保留模型账号、运行环境和共享 Skills；
- Activity 使用稳定 Agent 显示身份，内部唤醒文本和任务 id 不再混入工作事实流；全页只有一个“添加项目”主操作；
- Project 创建、Agent 结构化 outcome 和 `ath` CLI 开始复用同一 CommandService / CommandReceipt；Runtime 文本与进程完成仍不能改变领域事实；
- Managed Runtime 在订阅就绪前不接单，同一 lane 不会因亲和 Worker 忙碌而切到另一 Worker 并发执行，旧 lease 也不能释放新 turn；持久 Inbox 对每个执行 lane 设置容量上限；
- Work、Review 与 Agent Team 都成为 Project 中可创建、可打开、可追踪的正式对象，不再借用 Delivery 容器表达一次工作；Project 内创建 Work 直接进入统一 `work.create` Command handler；Agent Team 只引用真实 Agent，缺少成员或有效 Catalog Runtime 时整体拒绝；
- Project 不再被部署时的 Team 成员快照锁死：右侧上下文可以直接添加已有 Agent，Team 只提供初始成员；添加后的 Agent 立即进入同一 Project roster，聊天 `@`、默认接手、任务通知和 Runtime 不再各自维护成员名单；
- Project 的工作镜头不再用四张统计卡、产物卡和完成口径卡包围任务，而是按生命周期分组显示可扫描的 WorkItem 行；页面只有一个创建入口，整行打开统一详情。列表、详情、编辑、状态、进度请求、删除、请求中/错误态和重试幂等键全部以 `conversationId + taskId` 定域，不同 Project 出现相同任务 ID 时不会互相选中或改错对象；
- Runtime Catalog 同时提供 13 个内建 ACP Harness 和受约束的自定义 ACP 创建；Catalog 不保存秘密环境值，修改/删除会注销旧实例。Agent Profile 的发消息、按 Project 停止和重启连接真实项目事件与 Runtime Supervisor，失败后的 observed state、原因码和需要人工恢复的队列不会被绿色成功提示掩盖。

### 已验证的效果

- 在本地 Buzz Desktop v0.5.18 EXE 中沿真实“消息触发 → ACP session → tool command → CLI 写回 → 同流回复”完成只读复核，并以同版本源码交叉核对 Projects、AgentPool、EventQueue、ACP、CLI 与 MCP；这次复核推翻了此前只看对象页得出的“聊天应按需打开”判断；
- 新增组件回归直接证明 Project 首屏挂载 Agent 列、连续消息流与 embedded composer，页面不再存在“与 Agent 协作”抽屉按钮；Agent Profile 首屏能从真实消息投影展示 Invocation、工具活动与 Project 频道，并保留 Agent 对象编辑；
- TypeScript、Next.js production build 与全量 Vitest 通过：251 个测试文件、1836 项通过，2 个文件/2 项按既有条件跳过；生产构建仍报告既有的动态文件追踪范围警告，但未阻断产物。Tauri release 需要在最终桌面验收前按本轮源代码重新构建。
- 在新构建的本地 Windows EXE 中逐项验证 Project 协作流、Work 详情、Agent Team 投影、Agent Profile 发消息、ACP Runtime observed state、停止/重启、失败原因码、Runtime Catalog、自定义 ACP 创建/不可用状态/删除确认以及 Project 失败队列入口。真实 Codex ACP 重启在本机配置下失败时，页面显示 `failed · 0/0` 与 `runtime_start_failed`，没有再宣告重启成功。
- 在 build `desktop-build-31c3ae613f0424f3fb31f0b727349c8a` 的 release EXE 中进入“验收测试项目 → 工作”，真实看到 2 个开放工作按“进行中”分组、唯一“创建工作”入口和带可访问状态名称的整行对象；点击“验收：Project 与 workspace 原子创建”打开现有任务详情对话框。Store 与相关 Project/Task Detail 回归共 18 个文件、99 项通过，TypeScript、相关 ESLint、Next.js production build 与独立复审通过，复审结论为 Critical 0、Important 0、Ready to merge。
- 在 build `desktop-build-63d10aad569cab32ff0f0054cc8f8388` 的 release EXE 中为“验收测试项目”加入 Peach，刷新后的右侧 Project 上下文稳定显示 Mario、Luigi、Peach；打开聊天 `@ Agent` 候选也同时显示三者。真实桌面验收发现并修正了旧 `activeAgentIds` 对 Project roster 的二次过滤，验证后收起候选并清空草稿，未发送测试消息。

### 仍然保留的边界

CommandService 已接入结构化 outcome、Project、Review 和 Agent Team 创建/部署，Task、Artifact、Gate、Release 等其余公共写入口仍需逐步进入 registry。历史 Platform Event 的 `project_id` 仍受 Conversation 外键约束，Project workspace conversation 是暂时的事件兼容边界；在新 Project identity 迁移完成前不能把它描述成最终统一数据模型。桌面 Host 已能打包、启动和拥有本地 Service，但 Windows Job Object 级的完整 ACP/vendor/MCP 子进程树终止语义仍是目标状态。订阅 first-match 过滤器的约束已冻结在设计中，当前触发主链仍以显式提及和既有授权规则为准，尚未交付可配置的订阅规则产品面。
本轮完成并验证的是 release EXE；MSI 安装器、签名与分发仍属于发布门，不把未生成的安装包写成已交付效果。

### 设计与实现依据

- [交付工作区前端决策](ux/2026-08-16-delivery-workspace-refactor.md)
- [统一事件、身份与 Agent Runtime](../technical/execution/unified-event-agent-runtime.md)
- [命令驱动交付规格](../../specs/command-driven-delivery/spec.md)
- [ACP Runtime 接入规格](../../specs/acp-runtime-integration/spec.md)

---

## 2026-08-16：用户先看到交付，不再先理解 Agent 内部

### 原来的处境

首页同时把项目、会话、群聊、任务、团队、地图、待办、风险和调试放在第一层。用户进入系统后先看到“作战指挥室”
和 Agent 卡片，右侧还要在五个 tab 间寻找进度；“新建项目”和“新建任务”又同时竞争主操作。用户必须先理解平台
内部如何组织 Agent，才能回答“这次交付完成到哪、是否需要我处理”。

### 优化后的变化

- 顶栏只保留一个主操作“新建交付”，创建时直接收集目标、项目目录、验收标准和授权；
- 侧栏按真实项目目录分组交付，中心首屏展示目标、工作进度和需要关注，聊天降为“团队活动”；
- 右侧一级入口从五个收敛为“任务/调试”，“需要关注”只出现必须由用户补充信息、选择或授权的事项，关系图成为任务视图模式；
- 用户无需 `@Agent` 也能补充要求，默认接球人由服务端 Team Runtime 决定；未选交付不能发送，无接手人会明确提示。
- 新建自主交付现在只提交一次统一命令；项目记录、上下文初始化和 Agent 团队启动由服务端编排，页面不再出现“记录已建但团队没启动”后再猜测回滚的中间状态。
- 删除/推进交付、任务创建/编辑/流转/拆分/合并/改派等操作使用同一 Workspace Command 回执语义；刷新、重复点击或重放以幂等键识别同一操作。
- 阶段保存与“确认拆解”不再由浏览器循环写多个接口：一个稳定意图在服务端协调 Phase、Task Graph 和 `.ath` 投影，完整回执返回前页面不会宣布确认成功。
- 补充要求只有在服务端同时记录消息和团队接手工作后才进入活动流；失败时草稿保留，重试不会重复创建消息或工作项。
- 任务详情中的“请求进度”只表达用户意图，不再让用户选择执行引擎或由当前浏览器直接启动 Agent；任务开始与自动接续
  即使页面断开，也由服务端命令、Inbox 和执行器链路持有。
- 团队活动不再把“连续同一个 Agent”压成一组历史回复；一次 Invocation 只显示一个稳定回复，过程说明折叠，超长正文先给核心结论再按需展开；工具调用汇总为一个 Trace，收起时仍直接显示最近的工具名称和目标。
- 任务通知和自动唤醒不再冒充 Agent 发言；它们显示为紧凑活动提示，Agent 间交接只表达谁接手了谁的工作。
- Agent 的一次工作不再止于生成聊天文本：服务端持有排队、执行、工具循环、独立评审、验收和下一步推进；只有真实权限或外部依赖边界才转为“需要你处理”。
- 同一 Agent 的长任务不会因为一次执行轮次结束而被算作失败：它可以留下已完成内容、精确下一动作和剩余步骤，平台带着该检查点开启新的受管轮次；Agent 间也只能在下一角色确有具体动作时交接，普通“收到、正在看、建议下一步”不再构成协作结果。

### 已验证的效果

- 在独立 worktree 的 Next.js 16.2.4 服务上完成真实浏览器检查，辅助技术树确认唯一主创建动作、Project -> Delivery
  文案、交付摘要、次级团队活动，以及任务/调试两级结构；
- 原交付投影、项目组件、草稿保持和架构门禁 88 项定向测试通过；审查后新增的隔离、关注语义、关系图竞态、
  默认接手人、自主交付组件、Task revision 合并和持久拒绝回执回归均通过；
- 早期控制面收敛的全量测试曾达到 1559 通过、2 跳过；此前记录的 human-resume 基线失败已定位为 Command Adapter 与 Agent Inbox 未共享注入时钟并修复。本轮聊天、ACP、Gate、恢复和控制链 15 个测试文件共 132 项全部通过；其中 Gate 结果在接纳事务内校验证据和目标绑定，普通任务也不会因无升级承接者而被失败预算静默封死。
- 真实浏览器中完成新建交付、任务视图切换和补充要求提交；刷新后权威活动仍只出现一次且控制台无错误。
- 当 DeliveryRun 的早期阶段投影滞后、任务已经进入评审时，真实页面不再一直显示“正在规划”：顶部和运行摘要统一显示“评审中/正在评审”，当前工作从 0/1 更新为 1/1，并显示正在评审的任务标题；对应投影与组件定向测试 9/9 通过。
- 使用包含大量并行 Agent 历史和失败重试的真实交付复核团队活动：页面完全水合后投影为 15 个 Invocation 回复、15 个聚合 Trace 和 27 个紧凑系统活动；已完成 Trace 全部默认收起，“某 Agent N 次回复”入口为 0，同一工作项在每次回复中最多出现一次。全新页面加载后没有控制台错误。
- 真实自主交付完成 Task Review 和 Delivery Review 后，自动进入 Acceptance Verification；由于目标要求 Web UI E2E、而浏览器权限被拒绝，系统稳定停在 `waiting_human`，没有重复启动 evaluator 或伪造验收回执。自主控制面 14 个测试文件 94/94 通过。
- 续作检查点的接纳、快照投影、独立预算、继续派发、新轮次提示、A2A 交接与四出口协作协议已覆盖执行、Task 评审、Delivery 评审和验收验证；Gate 续作的新轮次同时收到上一轮摘要、精确下一动作、剩余步骤、证据、Gate id 与 receipt 约束。同一 WorkContract 的第二个续作检查点会被拒绝，排队中的续作计入并发容量，避免状态播报或 reconcile 形成无界循环。最终全量回归 1609 通过、2 跳过。
- Agent 已经完成一轮工作却忘记提交结构化结果时，平台不再把原任务从头重跑：它只启动一次结果收口轮次，带回上一轮持久化回复和证据，只允许提交 Outcome，不允许改文件、跑命令或调用项目 Skill；再次没有结果就作为系统故障结束，不要求用户判断 Agent 是否可用。执行、Gate、Inbox、WorkContract 和控制面定向回归 72/72 通过；全量回归 1657 通过、2 跳过，另有 1 项既有 evaluation migration 版本断言仍停在 83、当前实际为 87。
- Agent 把同一步并行交给多个角色后，平台会等待全部分支终结并只回调原负责人一次；回调携带 complete/partial 分支摘要和精确 outcome 证据，不复制分支聊天，也不会因一支失败丢掉其他成功结果。并行宽度限制为 3，越界 handoff 在 Outcome 接纳事务内拒绝且不占用终态槽；取消或替换协作时，平台会取消 pending 回调、关闭已签发权限，并在派发和结果接纳两端拒绝旧 Possession revision。A2A、Inbox、WorkContract、Invocation Pipeline、ContextManager 相关回归 276/276 通过。
- 多个交付复用同一项目目录时，`TASKS.md` 现在只归当前 Conversation 的 Task Graph 所有；新交付会先重建自己的投影并关闭旧 watcher。Task 一旦进入 WorkContract，文件中的状态、owner、标题、交付物和依赖全部只读，不能再把评审中或阻塞中的工作拉回执行。真实故障曾让同一成果产生重复父子任务、32 个执行 epoch 和 59 次 Task revision；对应接管与 revision 保护回归已覆盖，修复后的 3000 页面可正常加载且无控制台错误。
- 在真实 3000 页面复核已完成交付：页面显示 100% 验收，历史中 2 条超长 Agent 回复进入渐进展开，11 个已完成 Trace 在收起态直接显示工具调用，浏览器控制台无应用错误。
- Workspace Command、独立 lease journal、统一工作区投影、桌面握手/退出与架构门禁加入回归后，全量 1759 项测试通过、2 项跳过；Next.js standalone 生产构建通过。真实 standalone Service smoke 证明无密钥握手返回 401，正确密钥返回 protocol v1、内容派生的 Host/Service build ID、实际 Service PID 和 64 字符派生 session token；桌面模式下无 renderer session 的 Workspace Command 返回 401，认证 shutdown 完成 WAL checkpoint 后退出。

### 仍然保留的边界

当前 `Conversation` 仍是持久化兼容对象，独立 Delivery schema 尚未冻结；自主交付验收详情仍由现有 snapshot 面板读取。
独立 Delivery schema 和 `taskHubStore` 的进一步展示/UI 状态拆分尚未完成；账号、Skill、TeamPack 等配置对象仍使用各自领域 API。
Tauri Host 和 Service 开发骨架已经落地，但当前机器未安装 Rust toolchain，尚未执行 `cargo check`；Node runtime 打包、renderer
session 全链校验、Host crash 的 process-group kill-on-close、托盘/deep link、签名和自动更新完成前只能称为桌面开发版。Daemon 已删除浏览器启动/强杀旁路，但更细的进程生命周期模块拆分、
重启恢复仍按活动规格继续验收；当前发布只接通本地单 daemon，非本地节点会明确拒绝，远端 transport 尚未实现。
当前续作由 Agent 在退出前显式提交检查点；基于上下文占用、运行时长和产出规模自动触发检查点仍属于后续能力。
历史上已经导入的影子 Task 保留审计事实，不由升级代码静默删除；修复阻止新影子工作和继续回滚，已有记录仍需通过正式取消/收口命令处理。

### 设计与实现依据

- [交付工作区前端决策](ux/2026-08-16-delivery-workspace-refactor.md)
- [前端与控制面收敛架构](../technical/execution/frontend-control-plane-convergence.md)
- [活动实现规格](../../specs/frontend-architecture-refactor/spec.md)
- [Platform Harness 状态机](../technical/execution/platform-harness-state-machine-design.md)

---

## 2026-08-03：自主 Agent 不再卡在无人回答的权限确认

### 原来的处境

用户已经在创建自主交付时允许团队修改代码，但 Claude 真正调用 Write、Edit 或 Bash 时，平台仍把权限请求按默认拒绝处理。无人值守会话里没有人能点击“允许”，于是 Agent 会报告自己无法写文件、无法运行测试；用户只能到每个项目手工添加 `.claude/settings.local.json`，同一份授权被迫配置两次。

### 优化后的变化

- 创建自主交付时给出的“允许改代码”会随 WorkContract 到达当前 Agent，并转成当前 Invocation 内的单次 ACP 授权；
- 项目内 Write/Edit、白名单内测试/构建/检查命令，以及父会话承接的 Claude 原生 Task/Agent 子任务可以在无人值守模式继续执行；
- 通用 shell、Git/网络命令不会由“允许改代码”放开；push、创建 PR、合并仍经受信平台动作分别检查原有授权；
- 每次权限请求和允许/拒绝结果都进入 Runtime Event 流，排障时可以直接确认工作是被 Agent 放弃还是被平台策略拦截。

### 已验证的效果

- 权限策略、ACP backend 回调和 Runtime Event 审计的 37 项针对性回归测试通过；
- 使用真实 Claude ACP 在没有项目级 Claude 权限文件的临时目录中，成功完成 Write 创建文件、Bash 调用 Node 读取文件并返回结果，期间平台收到 `edit` 与 `execute` 请求并逐次选择 `allow_once`；
- TypeScript 检查、受影响文件 ESLint 和 Next.js 生产构建通过。

### 仍然保留的边界

没有自主 WorkContract 或没有“允许改代码”时，权限请求继续默认拒绝。文件编辑的真实路径必须位于当前项目工作目录；执行只允许直接调用约定的 test/build/lint 命令，通用 shell 与外部交付动作走受信平台能力。平台从不自动选择 `allow_always`；每次请求重查 Work Authority，历史或已替换 Invocation 的授权不能复用。这里信任的是 Agent 与当前项目代码；对恶意仓库的网络、凭据和文件系统隔离仍需要部署级执行沙箱。

### 设计与实现依据

- [自主交付产品契约](business/2026-07-19-autonomous-delivery-contract.md)
- [ACP 运行时统一接入规范](../../specs/acp-runtime-integration/spec.md)
- [统一 ACP 执行链](../technical/execution/opencode-integration-executable-chain.md)
