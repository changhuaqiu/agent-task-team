---
topics: [buzz, product-journey, desktop, creation, collaboration]
doc_kind: product-ux
created: 2026-08-25
updated: 2026-08-25
---

# Buzz 产品旅程与桌面交互采纳协议

## 1. 目的

本轮参考对象不是 Buzz 的颜色、卡片或某个 Agent 配置弹窗，而是它如何把长期协作、Agent 运行和正式产出组织成一个可连续使用的桌面产品。Agent Task Hub 的定位仍是多 Project 软件交付 Agent OS；采纳的判断标准是能否让用户在多个产品空间里稳定触发 Agent、持续协作，并把结果写成可验证的工作事实。

Buzz 是 community / channel 中人与 Agent 的通用协作产品；Agent Task Hub 是 Project 中人和 Agent 共同推进软件工作的产品。因此两者共享稳定身份、事件流、Inbox、Agent Definition / Instance、ACP 和桌面连续性，但本产品仍保留 Work、Artifact、Review/Gate 与可选 Release，不把业务对象退化成频道消息。

## 2. 从 Buzz 还原的产品骨架

Buzz 的一级对象长期稳定：Inbox、Channels/DM、Agents、Projects、Workflows 和 Settings。创建动作不从万能“新建”开始，而从当前对象的浏览器或上下文开始：

1. “添加”先打开可搜索的已有对象列表；
2. 已有对象可直接打开或加入；
3. 搜索没有精确匹配时，创建行持续可见；
4. 进入创建表单时继承搜索词和父级作用域；
5. 创建失败保留输入，服务端接纳后才关闭；
6. 有改动的编辑器退出前阻止丢失草稿；
7. 创建后的对象立即出现在原列表、侧栏和事件流中，不要求手动刷新。

这套模式同时出现在 Channel、Project、Agent、Team 和 Workflow，只是每个对象的首问不同。其价值不是“统一表单”，而是统一创建协议。

## 3. Agent Task Hub 的稳定对象与用户旅程

### 3.1 一级空间

- **Inbox**：跨 Project 的事件投影，可按需要处理、Agent、评审、提及/回复、提醒和草稿过滤。
- **Projects**：长期产品/代码上下文与协作边界。
- **Agents**：可复用 Agent Definition 与按 Project 运行的 Agent Instance 的统一入口。
- **Automations**：基于统一事件上下文触发结构化动作的工作流；默认归属 Project，需要时才提供 Workspace 级浏览。
- **Settings**：模型账号、Runtime Catalog、共享 Skills、Compute 与桌面偏好等基础资源，不编辑 Agent 身份，也不再提供“团队能力”或“角色素材”对象。

### 3.2 Project 主旅程

```text
浏览/添加 Project
  -> 打开 Project 连续协作流
  -> 提出目标或在当前 Project 创建 Work
  -> Agent Inbox 接纳并由受管 ACP Instance 执行
  -> thinking/tool/usage 作为可展开运行观察
  -> 结构化 MCP 提交 Work / Artifact / Review / Gate 命令
  -> CLI 在主路径不可用时提交同一种 Product Command
  -> CommandReceipt 成为消息流中的正式事实卡
  -> Inbox、Project 镜头和对象详情从同一投影更新
```

### 3.3 Automation 主旅程

Automation 是 Project 内对统一事件的持久订阅，不是一次性脚本，也不是 Agent Prompt 模板：

```text
浏览 Project Automations
  -> 创建（名称、触发、条件、顺序动作）
  -> 默认关闭，预览自然语言摘要
  -> 用户确认启用
  -> PlatformEvent 进入耐久 Dispatcher
  -> 过滤 Project / event type / condition
  -> 以 Automation + source event 形成唯一 Run
  -> 顺序执行动作，Agent 动作写入持久 AgentInbox
  -> 正式对象动作通过注册的 Product Command 写入
  -> 需要人决定时在原 Run 上等待，并从 trace 直接批准或拒绝
  -> 每步保存 running/completed/failed trace
  -> Run、错误和重试可从对象详情回看
```

- `AutomationDefinition` 保存意图、触发、条件、动作与 revision；`AutomationRun` 保存一次触发的输入、状态、逐步 trace 和错误，两者不能混为一个状态字段。
- 事件触发必须排除 `automation.*` 自身事件，并限制同一 Run 的最大动作数与因果深度，阻止自动化自激循环。
- 同一 `automationId + sourceEventId` 只能创建一个 Run；计划触发使用持久时间窗口 claim，不能依赖单进程内存中的 `lastFired`。
- 创建后默认保持关闭；启用前用自然语言明确“何时触发、将做什么”，避免保存即执行。
- Agent 动作只进入既有 AgentInbox/EventQueue，不能直接启动 Runtime；正式对象写入仍调用 Product Command，而不是由 Automation Repository 修改领域表。
- Product Command 动作只展示注册的用户动作，例如“创建工作”，不让用户编辑命令名、subject、actor 或原始 JSON 信封。
- “等待决定”是一张可操作的 Run step 卡：批准后继续下一步，拒绝后结束本次 Run；关闭应用再打开仍在原位置等待。
- “复制定义 / 导入定义”交换同一个可校验 Definition；导入先成为未启用草稿，不复制 Project、历史运行或审批记录。

消息是触发和连续反馈主链路，Work/Artifact/Review 是权威对象。Runtime 完成、Agent 文本和工具输出都不能直接改变工作完成状态。

### 3.3 Agent 主旅程

```text
Agents 浏览器
  -> Create / Import / Catalog
  -> 身份（头像、名称、指令）
  -> 继承默认 AI 或单独配置 Harness / Account / Model
  -> 高级：响应对象、并行度、实例名称池、Skills、权限、运行位置
  -> agent.create CommandReceipt
  -> Definition Profile
  -> 在具体 Project 中形成 Instance
  -> 观察 / 停止 / 重启该 Project Instance
```

Agent Definition 和 Instance 不能再被一张设置表混为一谈。Definition 保存可复用意图与策略；Instance 保存 Project、Runtime Node、generation、session/worker 和 observed state。

Agent 本身就是完整能力对象。名称、头像、结构化主要职责、工作指令、Skills、权限、Runtime、账号和模型都归 Agent Definition；主要职责明确区分协调分派、实现工作、评审验证和专业支持，自由文本不能把一次普通提及升级成实现。Agent Team 只保存真实 `AgentRef` 及协作关系，不能复制角色素材、账号或 Skill 快照，也不能在成员缺失时合成一个临时角色。Settings 中的 Skills 是可安装资源库，具体是否使用由 Agent 自己选择。

## 4. 统一创建协议

| 对象 | 创建入口 | 创建前 | 首屏输入 | 成功判据 | 失败行为 |
| --- | --- | --- | --- | --- | --- |
| Project | Projects 页“添加项目” | 先浏览/搜索已有 Project | 名称、目录 | `project.create` receipt + 权威 Project 投影 | 保留表单与错误 |
| Work | Project 头部或消息动作 | Project 已确定，不再重复选择 | 目标、验收、负责人/类别按需 | `work.create` receipt | 保留输入，不打开假对象 |
| Review | Project / Work / Artifact 上下文 | Project 与候选对象已确定 | 比较范围、标题、评审要求 | `review.create` receipt | 保留输入与当前上下文 |
| Agent | Agents 页新建卡 | Create / Import / Catalog 三条路径 | 身份优先，AI 默认可直接可用 | `agent.create` receipt + Definition 投影 | 保留草稿；冲突可恢复 |
| Automation | Project 自动化入口 | 先选一次触发器，再进入图/表单 | 名称、触发、条件、动作 | `automation.create` receipt + revision | 保留 JSON 定义代码/表单草稿与冲突 |
| Release | Project 结果上下文 | 只有需要冻结对外交付批次时出现 | 选择已验证对象，不重新填写工作过程 | `release.create` receipt | 不从运行结束自动生成 |

所有创建器遵守：父作用域不重复询问、默认值立即可用、高级配置渐进披露、脏草稿保护、幂等提交、revision 冲突、成功后打开真实对象。

## 5. Inbox 与连续协作体验

- Inbox 不是把 Task、Message 和 Review 临时拼数组，而是统一事件投影的用户镜头；每个条目保存 subject、project、actor、timestamp、read/action state 和可回到原上下文的引用。
- Inbox 只承载人类消息、Agent 对人可读的更新以及 Work、Review、Blocker、Artifact 等业务事实；ACP/Runtime 的工具调用与工具结果属于对应 Invocation 的观察详情，不得提升为跨 Project 条目。Project 回复只保留操作回执和执行问题计数。需要用户处理的工具失败必须先转译成正式阻塞或待决策事实，不能直接显示工具名、参数或内部错误。
- 连续协作流按 Project 保存草稿；切换 Project、Thread 或应用重启后仍恢复各自草稿。
- 提及 Agent 先显示接纳/排队/运行状态，实例真正建立后才显示执行中；失败提供稳定原因和重试入口。
- 正式 CommandReceipt 卡与普通消息、thinking、operation receipt 使用不同类型和视觉语义。
- Thread、引用、未读边界、回到最新和发送中/失败重试都属于消息产品能力，不以日志面板替代。
- 回复关系必须以 `replyToMessageId + threadRootId` 持久化；引用预览只是展示，不能把 `> 引用…` 文本当作 Thread 身份。Inbox、消息流和深链必须使用同一 `threadRootId` 聚合。
- 同一对象、同一活动类型、同一内容在短时间内重复出现时，消息流合并为一条带次数的活动摘要；原始事件仍保留在观察/诊断层，避免心跳和同步噪声淹没正式事实。

### 5.1 Agent 回复层级

真实 Buzz Transcript 会先把 ACP 更新规范化为 message、thought、tool 等 typed item：thought 作为低权重 disclosure，最终 assistant message 直接呈现；连续 tool item 在 presentation 层归组为一次 “Ran N tool calls”，子项默认不展开。这里学习的是信息层级而不是组件外观：本产品保留完整 Runtime Event 作为 canonical data，但聊天和 Agent Activity 共用一次响应投影，只显示思考摘要、最终答复与一个操作回执。需要排障时从 Invocation 观察入口进入完整工具轨迹。

### 5.2 Project 消息输入器

真实 Buzz 桌面端的输入体验采用“一个输入面、两组低权重动作、一个主发送动作”的层级。Agent Task Hub 采纳这一交互思想，但只呈现本产品已经可用的能力：

- 输入器的唯一主任务是向当前 Project 发消息；占位文案使用“发消息给团队…”，不把 Human Command、任务引用语法、自动接手、路由或 Runtime 机制暴露给用户。
- `@` 是选择 Agent 的统一入口。候选列表展示头像、名称和可理解的状态，内部 Agent ID 只用于写入消息，不作为列表的主要信息。
- 表情和 `@` 位于输入器左下角的低权重工具区；发送位于右下角，空内容时自然禁用。当前没有完整附件生命周期时不展示虚假的附件按钮。
- `@` 不只是文本补全：已选 Agent 必须在同一个提及控件中以紧凑头像/表情呈现，让用户在发送前看见消息会触达谁；不得另起一条“Agent 工具栏”。
- `@` 只决定消息触达谁，不授予实现权限。协调者收到“开始处理”这类普通消息时先理解目标、拆解并分派；它可以看见 Project 中尚未分配的 Work，但不会自己直接修改代码。
- 实现只由当前 Work 的明确负责人执行；如果用户确实要让某个实现型 Agent 处理一项不属于 Work 的临时工作，系统必须把它建模为明确的独立请求，不能用“最近任务”或模糊上下文猜测归属。
- Agent 真正接管运行后，由权威 `dispatch.receipt:acknowledged` 在原始用户消息下投影轻量确认反应。反应必须按原始 `messageId + agentId` 关联和去重；`requested/sent` 不算已收到，也不得做乐观伪造。
- Enter 发送，Shift+Enter 换行；引用预览、发送中和失败重试都留在同一个输入面内，且只在相关状态发生时出现。
- 输入器下方不得常驻帮助文案、Agent 列表、运行配置或团队管理入口。Agent 浏览与管理属于 Agents / Project context，运行过程属于对应消息的渐进详情。
- 消息搜索与筛选在消息较少时完全隐藏；需要时以一个安静的按需入口出现，不常驻展示消息数量。
- Agent 接纳、派发与交接属于 Project 运行状态，不是聊天内容：不得插入消息时间线或输入器区域。它固定绑定当前 Project 的工作区会话，位于 Project 标题与视图导航下方、主内容上方，不跟随用户临时打开的子任务会话切换；状态栏正常状态压缩为可展开的单行摘要，完整历史记录向下浮层展开且不推动主内容；阻塞或失败才使用警示色并显示用户可理解的原因，内部 reason code 不得直接露出。
- 日期分隔使用细线与小号日期标签；主消息流不使用装饰性粗边框、硬投影或重复计数制造额外层级。

### 5.3 全局工作区宽屏布局

- 收件箱、Projects、工作、评审和产物共享同一个有最大宽度的工作区框架；顶部视图导航、筛选、主内容和右侧上下文必须对齐到同一网格。
- 最大化或超宽屏只增加框架两侧留白，不得把主列表留在屏幕中央、上下文面板推到最右边。上下文面板始终紧邻主内容；窄屏按既有断点隐藏。
- 全局页面的内容列在框架内自然占满可用宽度，不再由子页面单独套一个更窄的居中容器造成二次收缩。

### 5.4 Project Agent 成员

- Project 是 Agent 可触达范围的产品边界；Project context 展示当前成员，并提供一个“添加 Agent”主入口。添加器只列出已有且尚未加入的 Agent，不重复询问 Runtime、账号、Skill 或 Team。
- Agent Team 是复用协作组合的模板，部署时初始化 Project 成员；Project 后续增减成员不修改 Team，也不修改 Agent 自身配置。
- 添加成功必须立即影响当前 Project 的 `@` 候选、无显式提及的默认接手、任务负责人候选与 Runtime roster。只在右栏显示一个名字而没有运行语义，不算功能完成。
- 成员变化显示权威保存结果；空成员时 Project 协作流明确提示先添加 Agent。内部 membership、binding、channel 和 routing 术语不进入主界面。

## 6. Runtime、MCP 与 CLI 的产品边界

- Agent 触发只产生持久 WorkRequest / Inbox item，不直接启动一次性进程。
- AgentPool 按 `Project + Agent + RuntimeNode` 管理受监管 Instance；EventQueue 负责容量、lease、重试和恢复。
- ACP 是 Harness 统一会话协议，Catalog 是唯一能力来源；Definition 引用 Catalog，不复制 launcher 细节。
- 结构化 MCP 是 Agent 创建和推进正式对象的主路径，结果返回 CommandReceipt。
- CLI 与 MCP 调用同一个 Command Kernel；CLI 输出机器可读 JSON、稳定退出码、幂等键和 revision 冲突，是通用接口与逃生仓。
- Agent 对自身 Definition 的创建/修改只可提交 owner-reviewed draft；不能由运行中的 Agent 静默扩大权限或修改自己的触发范围。

## 7. 桌面验收

Web 与 Desktop 共用 Renderer，但桌面完成度由完整旅程而非能打开页面判断。每轮必须在真实 EXE 棱镜下验证：

1. 一级导航、返回和深链保持对象上下文；
2. Project/Agent/Automation 的浏览、创建、取消、错误和脏草稿；
3. Project 草稿、Thread、提及、发送、失败重试和未读边界；
4. Agent Instance 的排队、启动、运行、停止、重启、失败和恢复；
5. MCP/CLI 写入后的消息流、Inbox 与对象页同步；
6. 应用隐藏/恢复、单实例、通知、快捷键、本地 Service 与子进程生命周期；
7. 所有秘密在界面、辅助功能树、日志和诊断接口中保持掩码。

## 8. 当前差距与实施顺序

### Clowder Artifact Ledger 体验补充（2026-08-27）

学习 Clowder 的 `recentArtifacts` 做法：用户和 Agent 不手工创建“产物对象”。平台从 Agent 已成功的文件修改、PR/Review 和终态 evidence 自动汇总最近产物；Session/Invocation 切换后，下一位 Agent 自动收到“传球 + 活跃工作 + 最近产物 + 真相源”的导航摘要。

Project“产物”页因此是自动账本，不是第二套交付表单。卡片区分“处理中”（Runtime 已观察到真实写操作）与“已登记”（Outcome 已提交为 evidence），并展示来源 Agent、Work 与更新时间；工具调用名称、参数和过程日志不进入该页面。用户无需提醒 Agent“集成到产物页”，Agent 也不需要额外维护一套身份。

产物页的主问题不是“最近发生了什么”，而是“每个角色交付了什么”。因此桌面端采用四层渐进结构：一级按实际贡献角色分列，列顺序沿用 Project Agent 顺序且不展示无内容空列；二级在角色列内按“实现 / 设计与文档 / 验证与评审 / 外部交付 / 其他”分组，只出现当前存在的类别；三级是可选择的 canonical 产物卡片；四级详情才展示精确引用、状态、关联 Work、时间和操作。搜索与状态筛选先过滤产物，再重建角色/类别分组，不能把命中项重新降级成无归属的平铺结果。

来源 Agent 是归类轴，不只是详情字段；Artifact kind 是角色列内的次级分类，不应与 Agent、Work、状态混排为同一级标签。只有提交结果、请求评审和 Gate 决策可以把 evidence 登记为交付；协调计划、继续工作、交接和阻塞 outcome 里的上下文引用不能冒充该角色的产物，`.ath` 与历史根目录 `TASKS.md` 等控制投影也不能作为用户交付件。同一文件的 `file://`、绝对路径、行号/行范围和逗号组合证据必须归一到同一个 Project ref，定位信息只属于证据 provenance；命令、E2E、trace、live-db 等验证回执明确归入“验证与评审”，不得显示成似是而非的文件名。这样既保留自动账本的事实来源，也让用户能按团队职责阅读交付结果。

当前实现已具备 Project identity、连续协作流、Work/Review 创建、Agent Profile、持久 Agent Inbox、受管 ACP Runtime、Command Kernel、MCP 与 CLI 骨架，但尚不能称为完成 Buzz 式产品旅程。按以下顺序继续重构：

1. Project 添加改为“浏览已有对象优先”的创建协议；
2. Agent Create / Import / Catalog 完成 Definition 与 Instance 分层及真实运行反馈；
3. Inbox 建立持久投影、未读/需要处理/草稿/评审等过滤与原上下文跳转；
4. Project 消息补齐 Thread、引用、发送状态、草稿和正式事实卡；其中结构化回复关系与重复活动折叠先行，Thread 侧栏与精确深链随后接入；
5. Work、Artifact、Review/Gate、Release 全部迁入 Product Command Kernel；
6. Automation 作为统一事件图落地，并以持久 Gate 处理人工审批；
7. 完成桌面通知、隐藏恢复、深链、快捷键、打包 Runtime 和整棵进程树治理。

本轮同时废弃旧的“团队能力 / 角色素材”产品层：设置页仅保留模型账号、运行环境和共享 Skills；Agent 创建与资料页不再读取或展示 RoleCard；Agent Team 的创建和编辑只选择已有 Agent。数据库中的历史兼容字段不得再进入创建命令、Runtime Profile 或 Prompt 编译，后续 schema 清理只属于存储迁移，不构成产品模型。

### 当前落地状态（2026-08-25）

Project Automation 第一阶段已落地：卡片浏览、共享创建/编辑器、自然语言预览、默认关闭、revision 启停、立即运行、可展开逐步 trace/错误/重试的 Run 历史，以及 event/manual/schedule 三类触发均进入真实对象页。项目通知与 AgentInbox、自身事件隔离、source-event/schedule-window 去重、Definition revision/Trigger/Action 冻结、按事件时刻选择订阅版本、临时失败 durable replay、自动刷新和 daemon 重启恢复均已有真实证据。

第二阶段现已接通：动作列表可选择“创建正式工作”和“等待决定”；Product Command 通过闭集 Registry 与 CommandService 执行，Decision 在运行记录原位批准/拒绝并从下一步恢复。定义代码只交换 schemaVersion/name/description/trigger/actions，粘贴后先校验、仍需保存且创建保持关闭。Project 同时新增可选“发布”页，用户只在需要冻结对外批次时选择 Work/Review；草稿只有在所选 Work 已完成、Review 已通过后才能发布，不恢复“先创建交付”的流程。

在第 3—7 项完成并通过真实 EXE 旅程验证前，不得在产品故事中宣称“Buzz 全功能与创建体验已经完成”。
