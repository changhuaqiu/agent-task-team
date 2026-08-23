---
topics: [product-story, user-outcomes, optimization, evidence]
doc_kind: product-story
created: 2026-08-02
updated: 2026-08-23
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
