# 前端与架构重构任务

> Status: active

## Phase 0：审计与契约

- [x] 检查外部参考的真实源码、架构文档、许可证和商标边界。
- [x] 盘点当前首页 IA、Store 消费者、任务写入、派发与 Daemon 调用链。
- [x] 更新产品 UX 决策和技术架构设计。
- [x] 建立活动规格、任务和验收清单。
- [x] 为现状关键流程补充基线截图和浏览器行为记录。

## Phase 1：交付工作区投影与 IA

- [x] 阅读本仓库 Next.js 版本对应的 App Router、Layout、Client Component 和状态保留指南。
- [x] 定义 `DeliveryWorkspaceView` 和纯 `DeliveryWorkspaceProjection`。
- [x] 为项目隔离、空态、当前工作、需要处理和活动摘要补投影测试；验收项随 Delivery snapshot 接入补齐。
- [x] 把侧栏重构为 Project -> Delivery，并统一用户文案。
- [x] 把自主交付摘要提升为中心主视图，团队消息下沉为活动区。
- [x] 把右面板从 5 个一级 tab 收敛为任务与调试，任务内部提供看板/列表/关系图模式。
- [x] 保证草稿、选中工作项和面板状态在水合与切换时符合产品契约。
- [x] 删除未选交付时隐式创建/选择 Conversation 的活动提交回退，并覆盖项目隔离测试。
- [x] 将用户关注收敛到 manual blocker 与 `waiting_human`，并阻止关系图迟到响应跨交付覆盖。
- [x] 让交付摘要按 Task 权威状态校正滞后的运行阶段，并将 `in_review` 计入当前工作。
- [x] 删除按连续 Agent 合并并折叠历史的活动分组，改为跨并行事件稳定聚合同一 Invocation。
- [x] 将 Task 通知、自动唤醒和系统控制变化改为独立活动提示；保持工具 Trace 摘要可见、过程说明默认折叠、最终结论直接展示。
- [x] 将已完成 Trace 的最近工具名称和目标直接投影到收起态，并把超长 Agent 正文改为原位渐进展开；工具、任务和证据卡不随正文隐藏。
- [x] 将任务完成数与验收通过数改为明确、独立的展示口径；终态交付与 Task 冲突时保留任务比例并显示“需核对”。
- [x] 把冻结 DeliveryBundle 投影为逐条验收证据包；显示正式验证来源、报告、规格、代码版本和完成时间，不采信聊天口头声明。
- [x] 移除 `/api/state` 中首屏未消费的 Invocation 调试载荷，并把每个交付的初始活动窗口限制为最近 200 条。
- [x] 把设置、任务详情、成员弹窗、创建弹窗和评估工作区改为按用户意图加载；修正表情组件的运行时静态导入。
- [x] 活动时间线首次只渲染最近 120 个聚合项，提供“显示更早活动”；选中交付后继续后台对账完整持久化历史。
- [x] 关系图只在工作面板已打开且用户选中关系图视图时请求，调试组件只在调试 tab 打开后加载。
- [x] 建立 C 级性能评测记录并保存相同数据集的前后载荷、初始脚本和无效请求指标。
- [x] 完成组件测试与浏览器 E2E。

## Phase 2：Workspace Command 单入口

- [x] 将无显式 mention 的默认入口成员选择迁到服务端 Team Runtime；无初始角色时使用已校验 roster，无成员时返回可见冲突。
- [x] 定义 Command、CommandReceipt、幂等键和失败语义。
- [x] 实现 Web API Adapter 与内存测试 Adapter。
- [x] 迁移交付补充要求到 `HumanCommandGateway`，删除浏览器 `message.append -> a2a.human_handoff` 双调用。
- [x] 将现有 `HumanCommandGateway` 深化为覆盖 Delivery/Work 显式用户业务操作的 `WorkspaceCommandGateway`；历史模块仅作为服务端内部兼容 Adapter，生产 Renderer 消费者已清零。
- [x] 迁移任务动作到 `WorkspaceCommandGateway`。
- [x] 迁移交付创建、删除与推进到 `WorkspaceCommandGateway`；自主交付创建由服务端作为一个应用操作完成，浏览器两步提交和补偿删除已删除。
- [x] 将阶段写入与拆解确认迁移为权威 `work.phase.*` / `delivery.breakdown.confirm` Command；浏览器不再循环写入阶段、任务和文件投影。
- [x] 将 Workspace Command 幂等回执移入独立 lease journal，保留删除后的历史回执并拒绝同键并发 owner。
- [x] 将 optimistic Task domain write 改为 pending command + 带 revision 的服务端权威投影确认。
- [x] 删除 `taskStore` 中任务变化后自动调用 `dispatchToAgent` 的路径。
- [x] 添加展示事件不得调用 Command Interface 的静态架构测试。

## Phase 3：浏览器退出派发控制

- [x] 让所有用户派发通过服务端 Command owner、Agent Inbox 和 DispatchGateway。
- [x] 删除浏览器运行配置选择、busy queue、强制派发和自动重试 owner。
- [x] 删除 React/store 的 `terminal:start` emitter 和相关兼容类型。
- [ ] 收缩 `taskHubStore` 为展示投影、水合、订阅和少量跨路由 UI 状态。
- [x] `ProjectWorkspace` 只计算一次 `DeliveryWorkspaceView` 和 Project/Delivery 导航，子面板不再读取 Conversation/Task 原始事实重复投影。
- [ ] 验证浏览器断线、多标签页和重连不会改变自动执行结果。

## Phase 4：Daemon executor-only 与收尾

- [x] 提取并验证 Daemon ExecutionAdapter 的最小 Interface。
- [x] 删除 Daemon transport 中重复的业务 policy、任务推进和恢复判断；恢复与 closure policy 迁入服务端 owner。
- [x] 完成本地 daemon 的 directed admission、原子进程占位与 no-ACK/unreachable 测试；非本地执行明确 fail closed。
- [x] 增加终态交付 Task 投影校准 owner：只使用完成前已存在的 `task.review_recorded(status=done)` 证据，幂等修复历史回退并留下审计事实。
- [x] 更新当前架构图、`docs/wiki/02-frontend.md`、`docs/wiki/04-backend-daemon.md`。
- [x] 删除失效 UI、事件、类型、测试和文档；不保留无退出条件的兼容层。
- [x] 执行 typecheck、相关测试、全量测试、build 和浏览器回归。
- [x] 按迭代知识规范完成当前事实沉淀并更新 STORY（仅记录已验证效果）；因仍有显式后续项，规格保持 active，不提前归档。

## Phase 5：Web / 桌面统一工作台体验

- [x] 对照 Buzz `desktop/` 的真实 AppShell、TopChrome、CommunityRail、Sidebar、Projects 总览/详情、Project read model、Agent 页面上下文和 per-channel Runtime queue，区分可复用原则与不可复制实现。
- [x] 明确定位差异：Buzz 是通用 relay workspace；本产品是跨 Project 的 Agent 交付系统。Community 不映射 Project，Buzz 的交付链也不压扁成单一 UI 实体。
- [x] 冻结窗口 Chrome、工作区侧栏、交付总览、Delivery 详情和按需上下文面板的模块边界。
- [x] 将首页重构为 Web / 桌面共享 Renderer 壳层，并为桌面拖拽区域保留同一 DOM 契约。
- [x] 侧栏提供交付总览，并以命名 Project 分组其 Delivery；总览和详情共享同一投影。
- [x] 未选 Delivery 时不挂载团队活动、输入区和工作检查器，只展示单一创建空态。
- [x] 将有数据总览补齐为组合指标、继续工作和命名 Project 进度；区分开放阻塞与用户 Attention。
- [x] 修复创建完成后权威选择与页面 surface 漂移，并覆盖外部选择和零数据整页回归。
- [x] 补充组件测试、生产构建和真实浏览器宽屏/窄屏回归。
- [x] 更新当前前端事实、STORY 和验证证据。
- [x] 将 Delivery 详情拆为概览 / 活动 / 评估三个稳定 surface，活动获得完整纵向空间。
- [x] 增加按 Delivery 隔离的本地草稿、引用回复预览、回到最新与键盘可发现的消息操作。
- [x] 补充活动交互组件测试、真实浏览器回归、文档和 STORY 证据。
