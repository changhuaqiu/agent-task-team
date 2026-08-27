# 前端与架构重构规格

> Status: active
> Date: 2026-08-16
> Branch: `codex/unified-event-agent-runtime`

## 1. 目标

把当前以群聊、Delivery Run 和浏览器 Store 为中心的工作区，重构为以长期 Project 协作、正式 WorkItem、Artifact 与 Review
事实为中心的用户体验；同时完成 WebUI 被动投影、CommandService 单写入口和服务端控制面的架构收敛。

产品决策以 `docs/product/ux/2026-08-16-delivery-workspace-refactor.md` 为准，技术设计以
`docs/technical/execution/frontend-control-plane-convergence.md` 为准。

## 2. 冻结决策

1. Project 是可独立存在的长期工作目录、协作空间和身份边界；Conversation 与 Delivery Run 都是内部兼容/编排对象，不再作为用户开始工作的前置概念。
2. Workspace 默认打开跨 Project 的事实 Activity；Project 默认打开常驻协作流，消息、Agent 回复和 Command Fact 使用同一时间线。运行细节附着于回复并渐进展开。
3. Workspace 镜头为动态、项目、工作、评审、产物；Project 主内容按协作、工作、评审、产物组织。协作是默认入口，其余镜头消费同一正式投影，不建立平行事实源。
4. WebUI 自动消费者只更新展示投影；所有自动执行和恢复由服务端 owner 完成。
5. 建立 Project Work Projection 和 `CommandService` 两个深 Module；MCP、CLI 与 Web/Desktop 只是 Adapter，不新增第二个全局事实 Store，也不各自实现写入规则。
6. 浏览器最终不得发出 `terminal:start`，任务 mutation 不得自动调用 `dispatchToAgent`。
7. 外部项目只作为研究参考，Implementation、视觉和文案独立完成；不得去除复制代码本应保留的许可声明。
8. 团队活动以 Invocation 回复为单位：同一次调用不裂泡，不同调用不按 Agent 合并；系统活动与 Agent 正文分面渲染。工具名称与目标始终可见，长回复正文可渐进展开，结构化证据和阻塞不随正文折叠。
9. Agent 文本、工具观察和 `runtime.completed` 都不是完成事实。WorkItem 只有在当前 authority 接纳终态 CommandReceipt、正式 Artifact 已登记且要求的 Review/Gate 通过后才完成；可选 Release 只聚合这些事实。
10. 验收进度必须可追溯到正式验收证据。主视图按验收标准展示结论与证据引用，并提供验证方式、验证人、报告、规格、代码版本和完成时间；Agent 聊天中的口头声明不得计入验收进度或证据包。
11. 交付首屏采用有界水合和按需加载：状态快照不携带未被首屏消费的调试记录，只携带每个交付最近一段活动；设置、弹窗、评估与调试组件按用户意图加载；任务关系图只在用户打开关系图时请求。完整历史仍保留在服务端，并通过选中交付后的后台对账与时间线渐进展开访问。
12. Web 和桌面共享同一个 Renderer 壳层：窗口 Chrome、Project 侧栏、工作总览、Project workspace 和按需对象详情为固定层级；桌面 Host 不复制业务页面。
13. 全局侧栏稳定导航工作动态、Agents 与 Projects；Project 不嵌套 Delivery 或 Conversation，不把 Buzz 的 CommunityRail 生搬为 Project。
14. Project 选中后即可协作，Agent 请求显式绑定 Project identity/path 与 WorkContract；用户无需先创建空 Delivery。没有 Project 时只展示“添加项目”空态。
15. 工作总览提供跨 Project 的进行中、待评审、已完成与阻塞口径；不得用 Runtime 状态或 Agent 口头声明凑统计。
16. Project 主面常驻绑定当前 Project 的 Conversation；WorkItem、Artifact、Review/Gate 与 Release 以事实卡进入同一流并可打开权威详情。右侧只展示 Project context，不再藏匿主协作入口。
17. 协作草稿按 Project workspace identity 隔离；上翻阅读不自动抢回底部，并提供瞬时新增活动提示。引用回复在 relation 尚未进入 Command 契约前只提交可见引用文本。切换正式对象镜头不得清空草稿或改变消息归属。
18. 全局唯一主创建动作是“添加项目”；产品页面不再提供“新建交付”，有界发布需要时由未来 Release 聚合表达。
19. Agent 是一等聚合对象，拥有稳定身份、工作指令、Skills、ACP Runtime、模型账号/模型、权限和运行状态；不存在独立“角色素材”或“团队能力”产品对象。团队与交付只引用 Agent identity，不再分别拼装 execution profile。Runtime Catalog 和 Skill Library 是 Agent 编辑器中的资源来源，不与 Agent 并列为主要配置对象。
20. Agent Profile 默认打开活动，并提供信息、运行、频道和技能视角。活动来自真实 Invocation/消息投影；运行来自 supervisor/worker/session observed state；任何环境变量值、凭据和敏感进程参数不得进入 DOM、辅助功能树或诊断响应。
21. 继承运行环境默认登录状态的 Agent 必须在所有协作入口呈现为已采用默认配置，不能仅因 `accountIds` 为空显示“未绑定账号”；单独配置模式缺失必需账号时才显示待配置状态。
22. Project 协作输入器采用单一会话面：输入区、`@`、表情和一个圆形发送动作构成完整主交互；内部任务引用、自动接手、路由和 Runtime 说明不得常驻在输入器周围，Agent 管理不得形成第二条操作栏。
23. `@` 候选是输入器内的按需 Agent 选择器；消息搜索/筛选只在长时间线中按需出现；Agent 派发与交接的正常状态压缩为可展开单行，只有失败或阻塞进入高显著性状态。
24. 输入器必须在提及控件内投影当前已寻址 Agent；Runtime 确认接管后，`dispatch.receipt:acknowledged` 按原始 `messageId + targetAgentId` 投影为用户消息下的确认反应。不得用时间邻近、当前持球人或乐观客户端状态猜测确认；progress 与 terminal receipt 必须独立保留，并使用统一的 phase 顺序处理同时间戳，保证实时投影与重启水合一致。
25. 全局 surface 使用一个共享的有界工作区网格；header、filter、main 与 252px context rail 在超宽屏保持同轴且相邻，子 surface 不得再次独立居中收缩。
26. Agent possession、派发与交接摘要属于当前 Project 的运行状态，不属于任何一条聊天消息；必须由 Project 工作区会话显式定域并位于 Project 标题与视图导航下方、当前主内容上方的顶部状态栏，不能跟随子任务选择漂移，也不能进入可滚动消息时间线或输入器区域。正常状态只显示一行，完整记录面板从状态栏向下浮层展开且不改变主内容、时间线或输入器高度，切换 Project 时必须关闭旧 Project 的展开状态；所有状态和失败原因必须转译为用户可理解的文案，不得显示内部枚举或 reason code。
27. Project 的“工作”镜头以 WorkItem 列表为主对象，不再用统计卡和说明卡包围任务。WorkItem 按生命周期状态分组，整行打开统一详情；列表只承担快速扫描，展示标题、必要描述、负责人、更新时间及有事实时的产物数，状态同时由分组与进度图形表达，不重复堆叠状态徽章。窄宽度按优先级隐藏次级元数据，不能把一条工作退化成拥挤的小卡片。同一 Project 页面在任一列表状态只能出现一个创建入口；对象选中、详情解析及编辑、状态、进度请求、删除等写操作必须使用 `conversationId + taskId` 复合身份，mutation epoch、请求中/错误状态与重试 idempotency key 也必须用该身份隔离。禁止裸 `taskId` 跨作用域解析对象或复用临时状态，也禁止在当前会话重复触发运行投影重置。
28. 全局收件箱是跨 Project 的用户事实与可行动更新镜头，不是 Runtime 观察日志。`tool_use`、`tool_result` 等工具生命周期不得作为独立收件箱条目；它们只附着在对应 Agent Invocation 回复的“运行记录”中渐进展开。工具失败只有先被领域 owner 转译为阻塞、待决策或其他可行动事实后才能进入收件箱，禁止按“使用工具”文案做 UI 字符串过滤。
29. Project 拥有可变的 Agent 成员关系，Agent Team 只是可复用的初始成员与协作拓扑模板。部署 Team 时以其成员初始化当前 Project；随后在 Project 内添加或移除 Agent 只改变该 Project，不反向修改 Agent Definition 或 Team。成员变化必须经 `CommandService` 产生幂等回执和领域事件，并立即成为聊天 `@`、默认派发、任务负责人候选和服务端 Conversation Runtime 的共同权威来源；Renderer 不得用全局 `activeAgentIds` 猜测 Project 成员。

## 3. 范围

包含：

- 首页 Shell、独立 Project 注册、Project 导航、Project 协作/工作/评估和对象详情的信息架构重构；
- Web / 桌面共用的窗口级 Chrome、工作区侧栏、工作总览和 Project workspace；
- 交付只读投影及其 selector/测试；
- 冻结 `DeliveryBundle` 的逐条验收证据投影与渐进展开界面；
- 首屏状态载荷、客户端代码边界、活动时间线与次级请求的性能收敛；
- CommandService、结构化 MCP、`ath` CLI、Web/Desktop API 和测试 Adapter；命令覆盖任务创建/更新/流转、结果、产物、评审/Gate、发布和用户对团队的要求；
- `taskHubStore` / `taskStore` / `daemonStore` 的责任收缩；
- Daemon executor-only 收敛所需的接口迁移和架构门禁；
- 对应产品文档、技术文档、wiki、架构图、测试和迁移记录。

不包含：

- 复制任何外部参考项目的源码、品牌或资产；
- 为追随参考项目切换框架、引入 Redis 或增加新的运行 backend；
- 在本规格中直接冻结新的 Delivery 数据表；若兼容映射不足，先补数据模型决策再迁移；
- 重做评估领域本身；账号、Runtime Catalog 与 Skill 作为 Agent 编辑器的可选资源，并删除团队/页面中的重复运行配置入口。历史角色卡字段只允许停留在迁移兼容层，不得进入创建、执行或提示词。

## 4. 依赖与冲突规则

- 依赖 `specs/system-control-plane/` 的 DispatchGateway、Task Authority 与运行健康事实。
- 遵守 `docs/technical/execution/webui-passive-project-projection.md`；若发生冲突，以“浏览器不是自动化 owner”为硬约束。
- 遵守自主交付产品契约；群聊基线只在团队活动展示层继续有效，不再定义自主交付的顶层 IA。
- 与账号、Skill、评估活动规格只通过公开 Interface 集成，不修改其领域事实；角色卡不再是现行领域对象。

## 5. 实施顺序

必须按 `tasks.md` 的 Phase 依赖推进。每个 Phase 先更新相应长期文档，再实现、测试和删除旧路径。不得同时保留
两个可产生同一执行事实的 owner。

## 6. 退出条件

- `checklist.md` 全部通过；
- Project 工作区的关键浏览器 E2E 通过并有可复查证据；
- 浏览器没有自动执行 owner，React/store 中不存在 `terminal:start` emitter；
- 任务变化只通过服务端 Command owner 触发后续工作；
- Runtime 文本和进程结束不能完成 WorkItem；任务完成数、评审通过数和可选 Release 使用明确事实来源；
- 每条已通过验收标准都能从主视图展开正式证据与验证来源，未形成正式回执时明确显示为待验证；
- 首屏不下载未打开的设置/弹窗/评估模块，不请求未打开的关系图，不同步渲染全部历史活动；性能结论有可重复的前后对比记录；
- Daemon 只消费已裁决命令并报告生命周期；
- 当前事实回写 `docs/wiki/`，失效设计归档，活动规格迁入 `docs/archive/specs/`。

## 7. 风险控制

- 所有重构在独立 worktree 和命名分支进行；只显式 stage 本规格相关路径。
- Conversation / Delivery Run 兼容层只能存在于仓储或编排边界，必须记录 producer、consumer 和退出条件。
- 每个 Phase 保持可构建、可测试、可人工验收；不得用长期 feature flag 保存旧 owner。
- 若当前服务端缺少某个 Workspace Command，先补服务端 owner 和 receipt，再删除浏览器写路径。
