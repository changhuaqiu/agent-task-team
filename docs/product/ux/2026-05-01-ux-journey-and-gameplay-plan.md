# 玩法、用户旅程与 UX 设计规划（Chat-First · 轻量游戏化 · 独立开发者）

## Summary

围绕“独立开发者带一队 Agent 做项目”的定位，把产品主循环从「看板/作战室」调整为「对话驱动」，让用户在聊天里下达意图与约束，系统把它变成可追踪的会话、任务、执行与复盘。目标优先级：上手快、推进快（同时不牺牲质量与可解释性）。

本计划只覆盖玩法与前端 UX（信息架构、用户旅程、交互与组件/数据模型改造）。后台/daemon 设计由其他 agent 负责，本计划仅提出前后端契约层面的 UX 需求。

## Current State Analysis（基于仓库现状）

### 已有信息架构

- 顶部三视图切换：作战室 / 看板 / 质量，默认 `war_room`（[ClientHome.tsx](file:///Users/kk/agent-task-team/src/app/ClientHome.tsx#L17-L178)）
- 会话（Conversation）已存在：选择/新建会话（[ConversationPicker.tsx](file:///Users/kk/agent-task-team/src/components/war-room/ConversationPicker.tsx#L6-L80)）
- 任务（Task）强依赖会话：`addTask` 需要 `selectedConversationId`（[taskHubStore.ts](file:///Users/kk/agent-task-team/src/store/taskHubStore.ts#L685-L713)）
- 聊天目前是“全局聊天室”，不区分会话（[GlobalChatRoom.tsx](file:///Users/kk/agent-task-team/src/components/task-hub/GlobalChatRoom.tsx#L9-L109)）
- 对话 `@agent` 会触发 `dispatchToAgent`（store 内 `addChatMessage`）（[taskHubStore.ts](file:///Users/kk/agent-task-team/src/store/taskHubStore.ts#L741-L777)）
- 任务详情抽屉提供状态流转 + Run Opencode + Terminal（[TaskDetailPanel.tsx](file:///Users/kk/agent-task-team/src/components/task-hub/TaskDetailPanel.tsx#L88-L256)）
- 设置抽屉提供 daemon/opencode/bridge 检测与配置（[SettingsDrawer.tsx](file:///Users/kk/agent-task-team/src/components/task-hub/SettingsDrawer.tsx#L8-L229)）

### 关键 UX 问题（阻碍 Chat-First 主循环）

- “聊天与会话/任务”未对齐：聊天不绑定会话，导致用户在对话中产出/引用任务的链路不闭环。
- “第一眼该做什么”不够明确：虽然默认是作战室，但用户若想“用对话驱动”，需要理解会话、计划、看板的关系后才敢开口。
- 对话中缺少“结构化提案”承接：目前只有自由文本 + #TASK 引用，缺少把聊天意图转成“可一键接受的任务/批次/检查表”的 UI 载体。

## 目标体验（v0 成功标准）

### 成功标准（可验收）

1. 首次打开 2 分钟内完成：新建会话 → 在聊天里描述目标/约束 → 一键接受系统生成的任务 → 看见至少 1 个任务进入执行/可运行（mock 或真实）。
2. 用户任何时刻都能回答两个问题：
   - “现在在推进哪场战役（会话）？下一步是什么？”
   - “我刚刚 @ 了谁？他在做什么？产出在哪里？”
3. 任一任务从“对话产生”到“可追踪执行/评审/复盘”全链路可回放（时间线/事件）。

## 玩法设计（轻量游戏化）

### 叙事框架（不影响效率）

- “会话 = 一场战役（Mission）”
- “任务 = 作战指令（Order）”
- “批次 = 波次（Batch）/回合（Round）”

### 轻量游戏化机制（v0）

- 战役进度条：按会话统计任务状态（pending/in_progress/in_review/done/blocked/rejected）
- 里程碑徽章（仅作为提示，不做积分体系）：
  - First Mission（创建首个会话）
  - First Dispatch（首次 @agent 并收到回复）
  - First Run（首次运行并看到终端输出）
  - First Review（首次完成 in_review → done）
- 战报（Battle Report）：会话结束时生成一页总结（目标/关键决策/产出物/未解决风险）

## 用户旅程（Chat-First）

### Journey 0：冷启动（首次进入）

1. 空态引导：提示“先创建战役（会话）”，并给 2~3 个示例模板（例如：做一个 landing page、修一个 bug、写一个脚本）。
2. 创建会话：title + goal（沿用 [ConversationPicker.tsx](file:///Users/kk/agent-task-team/src/components/war-room/ConversationPicker.tsx#L47-L78) 但以更强引导呈现）
3. 进入 Chat Hub：输入框获得焦点，顶部展示“本会话上下文摘要”（goal、当前任务数、最新阻塞项）

### Journey 1：提出意图 → 形成可执行结构

1. 用户在聊天里描述：目标、范围、约束、偏好（并可 @planner 或 @ux/@dev）
2. 系统/agent 回复时，输出两层内容：
   - 文本解释（保留在消息流）
   - 结构化提案（Proposal Cards）：例如“建议拆成 4 个任务/1 个批次”，每个可一键“创建任务并分配”
3. 用户接受提案后：
   - 自动创建任务（会话绑定）
   - 任务进入看板列，并可直接点开详情运行/看终端

### Journey 2：推进与交接

- 在 Chat Hub 中提供“快捷动作条”：
  - “生成下一批次任务”
  - “请求评审”
  - “生成今日战报”
  - “列出阻塞项并给解除建议”
- 对话中引用任务：
  - `#TASK-000`（现有规则）继续保留
  - 点击引用可打开任务详情抽屉（现有 `setSelectedTaskId` 模式）

### Journey 3：收尾与复盘

- 会话标记为 completed 时生成 Battle Report（作为一条时间线卡片 + 可复制/导出文本）
- 产出物聚合：把任务 artifacts 汇总为会话级“成果列表”

## 信息架构与页面策略（v0）

### 顶层导航

- 新增/强化 “Chat” 作为默认视图（替代当前 `war_room` 默认）
- 建议 v0 视图：Chat / Board / Quality
  - Chat：主入口（对话 + 提案 + 上下文摘要）
  - Board：任务执行态（按 agent 列）
  - Quality：阻塞与门禁（现状保留）

### Chat Hub 的布局（桌面优先，移动可降级）

- 左侧（主列）：会话内消息流（按会话过滤）+ 输入区
- 右侧（上下文列）：会话摘要卡 + 最新任务列表 + 阻塞项
- 任务详情仍用抽屉（沿用 [TaskDetailPanel.tsx](file:///Users/kk/agent-task-team/src/components/task-hub/TaskDetailPanel.tsx)）

## Proposed Changes（具体落地改造）

### 1) 数据模型：让聊天与会话对齐（前端 store）

目标：`chatMessages` 从全局改为按会话分桶，避免跨会话污染，并让 Chat Hub 可按会话回放。

- 文件：[taskHubStore.ts](file:///Users/kk/agent-task-team/src/store/taskHubStore.ts)
- 变更点：
  - 将 `chatMessages: ChatMessage[]` 改为 `chatMessagesByConversation: Record<string, ChatMessage[]>`
  - 新增 selector：`getChatMessagesForSelectedConversation()`
  - `addChatMessage` 默认写入 `selectedConversationId`（若为空：拒绝写入并提示创建会话）
  - 保留 `mentions` 与 `intent` 逻辑，输出保持不变

兼容策略：
- 迁移现有 localStorage：若发现旧结构 `chatMessages`，在 hydrate 时迁移到默认/当前会话（或创建一个“未命名会话”承接旧数据）

### 2) 视图：实现 Chat Hub（新组件/复用现有）

- 新增组件（建议）：`src/components/chat/ChatHubView.tsx`
  - 复用 `ConversationPicker`（作为顶部或侧边）
  - 复用 `ChatMessageItem`（渲染消息）
  - 替换 `GlobalChatRoom` 为 `ConversationChatRoom`（或在 `GlobalChatRoom` 中改为基于 selector 读取当前会话消息）
  - 新增 Proposal Cards 容器（先支持“手动点击创建任务”，结构化输出暂由 mock/agent 产出文本驱动）

### 3) Shell：调整首页默认视图为 Chat

- 文件：[ClientHome.tsx](file:///Users/kk/agent-task-team/src/app/ClientHome.tsx)
- 变更点：
  - `view` 默认值改为 `chat`
  - 导航按钮改为：Chat / 看板 / 质量
  - 在非 `lg` 屏幕下确保 Chat 可完整使用（现在 `GlobalChatRoom` 在 `lg` 才显示）

### 4) 提案卡（轻量结构化承接）

目标：把“聊天里出现的任务拆解”变成可点击的 UI，不要求后端先完成。

- 新组件：`ProposalCard`（位置：Chat Hub 消息流中，贴在某条 agent 消息下方）
- 最小字段：
  - title / description / suggestedAgentId / confidence（可选）
  - 操作：一键“创建任务并分配”（调用现有 `addTask`）

### 5) Onboarding 空态与引导文案

- Chat Hub 空态：无会话时引导创建会话（强化“先战役，后指令”）
- 会话为空时提示 3 条示例 prompt（可直接一键填充输入框）

## Assumptions & Decisions

- 已确认偏好：Chat-First、轻量游戏化、个人开发者、v0 优先“上手快 + 推进快”。
- v0 不做复杂积分/经济系统，不引入强叙事动画，不做多用户权限与协作细节（可在后续版本扩展）。
- 后端输出结构（proposal/plan/status）先不强依赖：前端先以“可渲染的卡片容器 + mock 数据/约定字段”把 UX 结构搭好，再由后台 agent 对齐协议。

## Verification（实现后如何验证）

1. 冷启动：清空 localStorage → 打开首页 → 能创建会话 → Chat 输入可发送 → 消息只出现在当前会话。
2. 会话切换：切换会话后，聊天/任务/时间线均只显示该会话的数据。
3. 任务创建：在 Chat Hub 中通过 ProposalCard 创建任务 → 看板出现任务 → 任务详情抽屉可打开。
4. 推进：在任务详情中改状态 `pending → in_progress` 能触发 dispatch（现状已有）并在 UI 可见。

