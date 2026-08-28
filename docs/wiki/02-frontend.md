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
4. 页面进入可交互态后，后续 `loadFromServer()` 作为后台刷新运行，不得让 `hasHydrated` 回退或卸载 `ProjectWorkspace`；刷新期间 `runtimeRefreshInProgress=true`，输入仍可编辑但暂缓发送；草稿由 Renderer 按 Project workspace identity 隔离并本地持久化，切换、刷新和短暂离开活动 surface 后可恢复

主界面结构：

- `WorkspaceAppChrome`
  - 左侧：紧凑的产品身份
  - 右侧：窗口级设置；添加 Project 由 Projects surface 承担
  - 同一个 DOM 同时服务 Web 与 Tauri Renderer，并声明桌面窗口拖拽区域
- Body
  - `ProjectWorkspace`
- Overlay
  - `TaskDetailPanel`
  - `SettingsDrawer`

## 2.3 当前工作台信息架构

[`ProjectWorkspace.tsx`](../../src/components/project/ProjectWorkspace.tsx) 是当前页面主框架，采用“工作区侧栏 + 全局 surface / Project workspace + 按需详情”布局。Project 是用户直接进入协作的长期对象；`Conversation` 只作为兼容存储身份，不在界面中形成第二层产品对象：

- 工作区侧栏：[`ProjectSidebar.tsx`](../../src/components/project/ProjectSidebar.tsx)
  - 稳定入口为收件箱、Agents、Projects 与设置；Project 列表直接打开长期 workspace
  - 不在 Project 下嵌套 Delivery/Conversation，也不重复放置创建动作
- 全局 surface：[`ProjectsOverview.tsx`](../../src/components/project/ProjectsOverview.tsx)
  - 提供跨 Project 的收件箱、Projects、工作、评审和产物镜头
  - header、filter、主内容与右侧 workspace context 使用同一个有界宽屏网格，最大化时不彼此漂移
- Project workspace：[`ProjectObjectWorkspace.tsx`](../../src/components/project/ProjectObjectWorkspace.tsx)
  - Project 选中后直接展示消息、工作、评审和产物事实，不要求先创建 Delivery
  - [`GlobalChatRoom.tsx`](../../src/components/task-hub/GlobalChatRoom.tsx) 是主协作面，结构化事实卡与 Agent 回复进入同一时间线
- 空态：没有 Project 时只解释并提供“添加项目”；不会预渲染团队、素材、Delivery 或 Runtime 配置区

WebUI 有两个明确分离的入口：

- Workspace Command：人的点击、输入和确认只能调用统一 Command Interface；
- Project View Consumer：服务端事件只能更新当前项目展示，不能自动启动 Agent、重试、推进任务或回传执行 ACK。

Project 活动输入、任务创建/编辑/流转/图操作、阶段写入与拆解确认已通过
`src/lib/workspace-command/` 的 `WorkspaceCommandGateway` 提交。Web Adapter 只调用 `/api/workspace-commands` 并还原
统一 receipt；服务端应用 Module 完成范围校验、幂等回执和跨领域编排，再委托 Delivery、Task Graph、Collaboration
等既有 owner。Project 注册不再由浏览器拼接多个领域写入，也不再由浏览器猜测补偿删除；
拆解确认也不再循环提交 Phase、Task 与文件写入，只有一个稳定幂等意图和一个完整权威回执。
其中兼容命令 `delivery.requirement.submit` 仍由内部 Human A2A owner 在一个事务内
完成消息、A2A possession、handoff packet、Agent Inbox 和持久 receipt。浏览器不再先写本地消息，也不再串行调用
`message.append` 与 `a2a.human_handoff`：只有 accepted/duplicate receipt 返回后才按权威 message id 更新投影；领域
拒绝或网络失败会保留草稿，同一草稿重试沿用原幂等键。

切换项目时会离开旧 room、加入新 room，并清空终端日志、流式缓冲和 Agent 活跃态等瞬态投影。服务端 room 隔离与浏览器 `projectId` 校验共同防止跨项目污染。

聊天消息采用双通路收敛：`project:view` 的文本与 thinking delta 提供实时显示，`chat_message` 快照提供
持久事实。Socket 连接/重连、项目切换以及服务端消息投影完成时都会执行幂等消息对账；
后台水合使用合并而非整表替换，不能覆盖请求期间刚到达的实时消息。用户不需要通过反复刷新
页面才能看到已经持久化的消息。

## 2.4 关键交互组件

### Project 导航与全局 surface

- [`ProjectSidebar.tsx`](../../src/components/project/ProjectSidebar.tsx)
  - 稳定展示收件箱、Agents、Projects、设置和 Project 列表
  - 搜索 Project 名与目录；不把内部 Conversation/Delivery 作为导航层级
  - 选择行为回调 `ProjectWorkspace`，再通过 Project 的 workspace conversation identity 切换兼容 Store 边界
- [`ProjectsOverview.tsx`](../../src/components/project/ProjectsOverview.tsx)
  - 读取跨 Project 的持久 Inbox、工作、评审与产物投影
  - Workspace Inbox repository 按 `chat_message.content_type` 排除 `thinking` / `tool_use` / `tool_result`，并在每次对账时清理旧版本已写入的 Runtime 观察条目；原始消息与对应 Invocation Trace 仍保留在 Project 协作流
  - 与 `ProjectWorkspace` 的 header、filter 和 context rail 共用同一个最大宽度框架

### Project 主视图与连续协作

- [`ProjectChatPanel.tsx`](../../src/components/project/ProjectChatPanel.tsx)
  - 在 Project workspace 内承载连续协作；内嵌 [`GlobalChatRoom.tsx`](../../src/components/task-hub/GlobalChatRoom.tsx) 在对象镜头切换时保持挂载
  - 活动时间线独占剩余高度，底部 composer 始终留在视口内；上翻阅读历史时不自动抢回滚动位置
  - 草稿由 [`useDeliveryRequirementDraft.ts`](../../src/hooks/useDeliveryRequirementDraft.ts) 按 Project workspace identity 隔离并持久化；引用回复使用持久化 `replyToMessageId + threadRootId`，预览只是展示
  - “回到最新/新活动”只表示当前打开时间线的瞬态阅读位置，不作为服务端未读事实
  - 未选 Project 时不挂载活动和输入；已选后必须显式带当前 Project identity，不能由 Store 自动创建工作空间
- [`GlobalChatRoom.tsx`](../../src/components/task-hub/GlobalChatRoom.tsx)
  - 输入器只承担向当前 Project 发消息：正文、`@`、表情、引用预览与单一发送动作位于同一表面
  - Agent 候选通过按需 `@` 弹层选择；已触达 Agent 在提及控件内紧凑显示，输入器周围不常驻 Agent 管理、任务语法、路由或 Runtime 提示
  - `dispatch.receipt:acknowledged` 通过原始 message identity 投影为用户消息下的确认反应；requested/sent 不伪装为已收到
  - 筛选状态按 Project 隔离；短时间线不渲染且不应用旧筛选，长时间线才提供按需搜索与类型过滤
- [`AgentResponseActivity.tsx`](../../src/components/task-hub/AgentResponseActivity.tsx)
  - 将 Runtime thinking 作为低权重、可展开的思考摘要，将最终答复保持为回复正文
  - 将同一 Invocation 的全部工具事件合并为一个操作回执，只显示进行中/已完成、操作数与执行问题数；工具名、参数和逐条结果只在观察详情出现
- [`agent-response-presentation.ts`](../../src/lib/agent-response-presentation.ts)
  - 统一实时 provisional message 与持久 thinking/text/tool segments 的展示语义，聊天页和 Agent 活动页共用同一投影
- [`A2APossessionStrip.tsx`](../../src/components/task-hub/A2APossessionStrip.tsx)
  - 由 `ProjectObjectWorkspace` 用 `workspaceConversationId` 显式定域并挂载在 Project 标题与视图导航下方、中央主内容上方的顶部状态栏，不进入 `GlobalChatRoom` 的可滚动消息时间线或输入器区域，也不受子任务会话选择影响；正常状态低权重，阻止与失败才使用警示色
  - 完整记录详情从顶部状态栏向下浮层展开，不挤压主内容、消息时间线或输入器；展开状态由 `conversationId` 定域，切换 Project 时自动重置
  - Handoff 与 Dispatch Receipt 按真实时间归一排序，从同一条最新记录派生标题、颜色和原因
  - 只使用用户可理解的“正在处理 / 已接纳 / 交接失败”语义，内部 reason code 必须经过转译或安全兜底，不暴露 runtime、worklist、chain 等内部概念
  - 由 socket 事件 `a2a:pass-offer`、`a2a:possession-changed`、`a2a:pass-blocked` 驱动

### Project 工作对象列表

- [`ProjectWorkSurface.tsx`](../../src/components/project/ProjectWorkSurface.tsx)
  - 从当前 Project 的 workspace conversation 与关联 conversation 生成唯一 WorkItem 列表，不建立第二套任务状态
  - 按 blocked / in progress / review / ready / proposed / done / cancelled 生命周期顺序分组；空分组不渲染
  - 行首状态图形、标题和类别承担首要扫描；描述、负责人、正式产物数与更新时间按宽度渐进隐藏，内部 Task/Conversation/Runtime 标识不进入列表
  - 整行调用会话定域的 `openTask({ conversationId, taskId })`，一次性切换当前会话与工作；当前会话内只更新工作选择，不重置运行投影
  - 行 key、选中态、`TaskDetailPanel` 解析和 Task Store 的编辑/状态/进度/删除 mutation 都使用 `conversationId + taskId`；mutation epoch、进度请求中/错误状态与重试 idempotency key 也由复合 key 隔离，允许不同会话存在相同任务 ID，列表没有第二份 Task identity 或局部详情状态
  - Project 顶栏与工作镜头共享单一创建路径：工作镜头激活时由列表提供入口，空态只保留一个就地动作；工作镜头使用命名区域而非嵌套页面主地标
  - Project 页不再渲染四张统计卡、独立产物统计或重复完成口径说明；跨 Project 统计仍由 Workspace 监督面负责

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
  - 只配置模型账号、运行环境与共享技能
  - Agent 身份、工作指令和技能选择在 Agent 对象中完成；Agent Team 在 Agents 页面只选择已有 Agent
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
- 手工“新建任务”和“新建交付”全局入口均已删除；唯一显式创建入口是 Projects surface 的“添加项目”。
- 交付补充要求、规划请求、交付生命周期操作和全部 Task/Task Graph 用户操作已迁入 Workspace Command，并通过持久 receipt 对账。
- Project workspace 采用连续协作时间线、按 Project 草稿、结构化引用、锚定滚动和键盘/触屏可发现的消息操作。
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
