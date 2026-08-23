# 02 — 前端（交付工作区）

## 2.1 前端目录结构

- `src/app/`
  - `layout.tsx`：RootLayout、字体、全局样式
  - `page.tsx`：页面入口，渲染 `ClientHome`
  - `globals.css`：全局设计系统与 Tailwind v4
- `src/components/project/`
  - 新的项目工作台主 UI
- `src/components/shell/`
  - Web / 桌面共用的窗口级 Renderer Chrome
- `src/components/task-hub/`
  - 聊天、任务详情、设置、终端、agent 相关组件
- `src/components/role-card/`
  - 工程型角色卡展示、编辑、绑定相关组件
- `src/components/skill/`
  - Skill 能力模块：SkillLibrary（双栏浏览）、SkillDetail（详情）、SkillImportDialog（导入弹窗）
- `src/store/`
  - Zustand 状态与前端编排
- `src/lib/`
  - 路由、工具函数与辅助逻辑

## 2.2 页面入口

真实页面入口是 [`src/app/ClientHome.tsx`](../../src/app/ClientHome.tsx)。

启动阶段：

1. 调用 `loadFromServer()` 从 API rehydrate
2. 完成后调用 `connectDaemon()`
3. 首次数据尚未 settled 时展示“初始化中”状态
4. 页面进入可交互态后，后续 `loadFromServer()` 作为后台刷新运行，不得让 `hasHydrated` 回退或卸载 `ProjectWorkspace`；刷新期间 `runtimeRefreshInProgress=true`，输入仍可编辑但暂缓发送；草稿由 Renderer 按 Delivery ID 隔离并本地持久化，切换、刷新和短暂离开活动 surface 后可恢复

主界面结构：

- `WorkspaceAppChrome`
  - 左侧：紧凑的交付中心身份
  - 右侧：唯一主创建动作“新建交付”、设置
  - 同一个 DOM 同时服务 Web 与 Tauri Renderer，并声明桌面窗口拖拽区域
- Body
  - `ProjectWorkspace`
- Overlay
  - `TaskDetailPanel`
  - `ProjectCreateDialog`
  - `AgentRosterModal`
  - `SettingsDrawer`

## 2.3 当前工作台信息架构

[`ProjectWorkspace.tsx`](../../src/components/project/ProjectWorkspace.tsx) 是当前页面主框架，采用“工作区侧栏 + 交付总览/详情 + 按需检查器”布局。当前
兼容数据仍使用 `Conversation`，但用户界面已明确区分 Project（真实目录）与 Delivery（一次交付）：

- 工作区侧栏：[`ProjectSidebar.tsx`](../../src/components/project/ProjectSidebar.tsx)
  - 一个跨 Project 的“交付总览”入口
  - 按真实 `projectPath` 展示命名 Project，展开后展示其 Delivery、任务进度和开放阻塞数量
  - 支持跨 Project/Delivery 搜索和收放；不重复放置创建动作
- 交付总览：[`ProjectsOverview.tsx`](../../src/components/project/ProjectsOverview.tsx)
  - 复用 `ProjectNavigationGroup[]`，给出 Project、可继续 Delivery（进行中 + 已暂停）、任务完成与开放阻塞组合指标
  - “继续工作”按最近更新时间回到可继续 Delivery；命名 Project 区使用同一口径展示目录上下文、整体进度及具体 Delivery
  - 总览只称“开放阻塞”；只有详情投影可以把人工 blocker 与 `waiting_human` 称为用户“需要关注”
- 中栏：[`ProjectChatPanel.tsx`](../../src/components/project/ProjectChatPanel.tsx)
  - Delivery 详情固定提供“概览 / 活动 / 评估”三个 surface，切换不改变当前 Delivery
  - 概览由 `DeliveryWorkspaceOverview` 与自主交付详情展示阶段、验收、当前工作和证据摘要
  - 活动使用完整纵向空间承载连续时间线、Agent 在场状态和补充要求输入；从概览或评估返回时保持同一个组件现场
- 空态：没有任何 Delivery 时由总览独占一个解释性引导，侧栏不重复提示；团队成员、活动时间线、输入区和右侧检查器均不挂载
- 右栏：[`ProjectRightPanel.tsx`](../../src/components/project/ProjectRightPanel.tsx)
  - 一级入口只有“任务”和“调试”
  - “需要关注”只投影人工 blocker 和自主交付 `waiting_human`；普通评审、ready 和自动 gate 故障不冒充用户待办
  - 关系图是同一任务域的视图模式

`src/lib/delivery-workspace/DeliveryWorkspaceProjection.ts` 是当前工作区的只读投影 Interface。它集中完成
Conversation 兼容映射、Project -> Delivery 导航、项目隔离、Task/Blocker/Message/DeliveryRun 合并和“需要关注”排序。
`ProjectWorkspace` 只计算一次 `DeliveryWorkspaceView` 和导航投影，再传给中栏、右栏和侧栏；子组件不再读取原始
Conversation/Task 集合重复拼接领域含义。独立 Delivery schema 尚未冻结，兼容映射只允许留在此投影 producer 边界。

WebUI 有两个明确分离的入口：

- Workspace Command：人的点击、输入和确认只能调用统一 Command Interface；
- Project View Consumer：服务端事件只能更新当前项目展示，不能自动启动 Agent、重试、推进任务或回传执行 ACK。

交付活动输入、交付创建/删除/人工继续、任务创建/编辑/流转/图操作、阶段写入与拆解确认已通过
`src/lib/workspace-command/` 的 `WorkspaceCommandGateway` 提交。Web Adapter 只调用 `/api/workspace-commands` 并还原
统一 receipt；服务端应用 Module 完成范围校验、幂等回执和跨领域编排，再委托 Delivery、Task Graph、Collaboration
等既有 owner。交付创建不再由浏览器串行调用 Conversation create 与 Autonomous Delivery start，也不再由浏览器猜测补偿删除；
拆解确认也不再循环提交 Phase、Task 与文件写入，只有一个稳定幂等意图和一个完整权威回执。
其中 `delivery.requirement.submit` 仍由内部 Human A2A owner 在一个事务内
完成消息、A2A possession、handoff packet、Agent Inbox 和持久 receipt。浏览器不再先写本地消息，也不再串行调用
`message.append` 与 `a2a.human_handoff`：只有 accepted/duplicate receipt 返回后才按权威 message id 更新投影；领域
拒绝或网络失败会保留草稿，同一草稿重试沿用原幂等键。

切换项目时会离开旧 room、加入新 room，并清空终端日志、流式缓冲和 Agent 活跃态等瞬态投影。服务端 room 隔离与浏览器 `projectId` 校验共同防止跨项目污染。

聊天消息采用双通路收敛：`project:view` 的文本 delta 提供实时显示，`chat_message` 快照提供
持久事实。Socket 连接/重连、项目切换以及服务端消息投影完成时都会执行幂等消息对账；
后台水合使用合并而非整表替换，不能覆盖请求期间刚到达的实时消息。用户不需要通过反复刷新
页面才能看到已经持久化的消息。

## 2.4 关键交互组件

### 项目与交付导航

- [`ProjectSidebar.tsx`](../../src/components/project/ProjectSidebar.tsx)
  - 消费完整 `ProjectNavigationGroup[]`，保持 Project / Delivery 层级，不把租户轨道误用为 Project 导航
  - 搜索 Project 名、目录、Delivery 标题和目标
  - 根据任务和 blocker 计算交付摘要
  - 选择行为回调 `ProjectWorkspace`，再通过兼容键 `selectedConversationId` 切换当前交付
- [`ProjectsOverview.tsx`](../../src/components/project/ProjectsOverview.tsx)
  - 与侧栏共享导航投影，不直接读 Store
  - Project 表达长期上下文，Delivery 表达一次目标到验收的工作闭环
- [`ProjectCreateDialog.tsx`](../../src/components/project/ProjectCreateDialog.tsx)
  - 负责新建交付，收集标题、目标、项目目录、验收标准和授权

### 交付主视图与团队活动

- [`ProjectChatPanel.tsx`](../../src/components/project/ProjectChatPanel.tsx)
  - 通过父级传入的 `DeliveryWorkspaceView` 展示目标、进度、当前工作和需要关注
  - 概览与活动为内部稳定 surface；内嵌 [`GlobalChatRoom.tsx`](../../src/components/task-hub/GlobalChatRoom.tsx) 在页面模式切换时保持挂载
  - 活动时间线独占剩余高度，底部 composer 始终留在视口内；上翻阅读历史时不自动抢回滚动位置
  - 草稿由 [`useDeliveryRequirementDraft.ts`](../../src/hooks/useDeliveryRequirementDraft.ts) 按 Delivery 隔离并持久化；引用回复先显示可取消预览，当前持久结果只保存可见引用文本，不伪造 reply relation
  - “回到最新/新活动”只表示当前打开时间线的瞬态阅读位置，不作为服务端未读事实
  - 未选交付时不挂载活动和输入；已选后要求必须显式带当前交付 ID，不能由 Store 自动选中或创建 Conversation
- [`AgentBar.tsx`](../../src/components/task-hub/AgentBar.tsx)
  - 展示当前参与 Agent 与绑定状态
  - Agent 成员配置面板中保留调试用 CLI session id 展示与复制入口，便于排查 session 续接问题
- [`CliOutputBlock.tsx`](../../src/components/task-hub/CliOutputBlock.tsx)
  - 将 CLI tool events 渲染为“执行摘要 + 活动时间线”
  - 顶部展示运行中 / 已完成 / 错误数量和当前工具
  - 每条工具事件支持展开查看参数或结果，避免正文只剩工具噪音
- [`A2APossessionStrip.tsx`](../../src/components/task-hub/A2APossessionStrip.tsx)
  - 在聊天室消息流顶部展示当前持球者、最近一次交接和阻止原因
  - 支持展开最近 8 次交接记录，作为轻量可审计时间线
  - 只使用用户可理解的“当前持球 / 交接 / 被阻止”文案，不暴露 runtime、worklist、chain 等内部概念
  - 由 socket 事件 `a2a:pass-offer`、`a2a:possession-changed`、`a2a:pass-blocked` 驱动

### 右侧辅助面板

- [`ProjectRightPanel.tsx`](../../src/components/project/ProjectRightPanel.tsx)
  - 只维护任务/调试一级切换与任务视图模式
- [`DeliveryAttentionSection.tsx`](../../src/components/project/DeliveryAttentionSection.tsx)
  - 消费投影后的统一关注项，不再分别维护待办和风险 tab
- [`MiniKanban.tsx`](../../src/components/project/MiniKanban.tsx)
  - 当前项目任务概览
  - 直接展示 Task Authority 的正式状态，只允许共享 Task lifecycle 声明的合法拖拽与菜单操作

### 任务执行与设置

- [`TaskDetailPanel.tsx`](../../src/components/task-hub/TaskDetailPanel.tsx)
  - 任务详情
  - 状态流转
  - 通过 `task.progress.request` Human Command 请求负责人汇报进度
  - 只读终端输出与运行状态
- [`SettingsDrawer.tsx`](../../src/components/task-hub/SettingsDrawer.tsx)
  - 模型账号、角色素材、技能与团队套件的唯一配置入口
  - 不暴露 runtime、channel、routing 等内部实现概念

### Skill 管理

- [`SkillLibrary.tsx`](../../src/components/skill/SkillLibrary.tsx)
  - 双栏布局：左侧 skill 列表 + 右侧 skill 详情
  - 支持创建、导入、编辑、删除 skill
- [`SkillDetail.tsx`](../../src/components/skill/SkillDetail.tsx)
  - 展示 SKILL.md 内容与配套文件
- [`SkillImportDialog.tsx`](../../src/components/skill/SkillImportDialog.tsx)
  - URL 输入弹窗，支持 Git 仓库和单文件导入
- Agent skill 标签集成在 `AgentBindingPanel` 中
  - 每个 agent 卡片显示已绑定的 skill 标签，支持添加/移除

## 2.5 当前前端状态来源

前端不是单纯本地状态页面，数据来源分为三层：

- 初始真相源：`GET /api/state`（含 skills）
- 运行时缓存：`taskHubStore`（`skillsMap` 缓存所有 skill，`agentSkillIds` 缓存绑定关系）
- 实时流：Socket.io daemon 事件

Skill 加载流程：`loadFromServer()` → `loadSkills()` → `GET /api/skills` → 写入 `skillsMap`。Agent 绑定通过 `assignSkillsToAgent()` 调用 `/api/agents/{id}/skills` 更新。

前端展示职责正在按活动规格 `specs/frontend-architecture-refactor/` 收敛。已完成部分是：

- 交付主视图与工作面板通过只读投影渲染跨领域状态；
- UI-only 的面板、视图模式和创建弹窗状态保持在所属组件；
- 手工“新建任务”全局入口及其 Store 状态已删除，顶栏只保留“新建交付”。
- 交付补充要求、规划请求、交付生命周期操作和全部 Task/Task Graph 用户操作已迁入 Workspace Command，并通过持久 receipt 对账。
- Delivery 详情已拆为概览、活动、评估三个稳定 surface；活动采用连续时间线、按 Delivery 草稿、可取消引用、锚定滚动和键盘/触屏可发现的消息操作。
- Task 创建、改派和状态命令仍由 Task Command Service 持有事实；需要执行时由服务端 Task Wakeup 推进，浏览器不再
  把任务变化解释为 Agent 启动。浏览器也不再先乐观改 Task：命令携带预期 revision，只有服务端返回权威 Task 后才
  更新投影；rehydrate 与 `task.state` 都携带 revision 并推进投影 epoch，迟到 HTTP 响应不能覆盖更高 revision 的 Socket 事实。
- `daemonStore` 只保留 Socket 连接、流式展示缓冲、watchdog 与运行投影；浏览器 runtime node、busy queue、强制发送、
  自动重试和 `terminal:start` emitter 已删除。

尚未完成的事实是：`taskHubStore` 仍聚合较多历史展示、水合和配置 action，尚未拆成最终的小型 UI Store；账号、Skill、
TeamPack 等配置领域仍使用各自明确 API，它们不属于 Delivery/Work 命令模型。Delivery/Work 的生产浏览器代码已不再直接
写 `/api/mutations`、`/api/task-graph` 或 `/api/autonomous-delivery`。

`daemonStore` 对外只提供 slice、Socket 连接与 TaskHub 实际调用的 watchdog seam；流式 buffer 的
schedule/append/flush 是同模块实现细节。Token 用量对外渲染入口是 `TokenBadge`，其展开卡片不作为独立公共组件。

## 2.6 样式与设计系统

全局样式位于 [`src/app/globals.css`](../../src/app/globals.css)：

- Tailwind v4：`@import "tailwindcss";`
- 设计变量：`--bg-* / --text-* / --status-* / --accent-*`
- 通过 HSL variables 驱动卡片、边框、状态色和深浅模式
- 页面主风格已经从“纯任务板”转向“控制台 / 工作台”式布局
