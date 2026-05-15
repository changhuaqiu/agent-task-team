# 02 — 前端（项目工作台）

## 2.1 前端目录结构

- `src/app/`
  - `layout.tsx`：RootLayout、字体、全局样式
  - `page.tsx`：页面入口，渲染 `ClientHome`
  - `globals.css`：全局设计系统与 Tailwind v4
- `src/components/project/`
  - 新的项目工作台主 UI
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
3. 数据未准备好时展示“初始化中”状态

主界面结构：

- Header
  - 左侧：产品标题
  - 右侧：新建任务、设置
- Body
  - `ProjectWorkspace`
- Overlay
  - `TaskDetailPanel`
  - `NewTaskDialog`
  - `AgentRosterModal`
  - `SettingsDrawer`

## 2.3 当前工作台信息架构

[`ProjectWorkspace.tsx`](../../src/components/project/ProjectWorkspace.tsx) 是当前页面主框架，采用三栏布局：

- 左栏：[`ProjectSidebar.tsx`](../../src/components/project/ProjectSidebar.tsx)
  - 项目列表
  - 项目统计
  - 项目切换
  - 新建项目入口
- 中栏：[`ProjectChatPanel.tsx`](../../src/components/project/ProjectChatPanel.tsx)
  - 当前项目标题与目标
  - 拆解状态提示
  - Agent 条带
  - 嵌入式聊天室
- 右栏：[`ProjectRightPanel.tsx`](../../src/components/project/ProjectRightPanel.tsx)
  - Mini Kanban
  - 下一步代办
  - 风险 / 阻塞

这意味着“项目上下文”已经成为前端第一层状态，而不是旧版的单一全局看板。

## 2.4 关键交互组件

### 项目侧

- [`ProjectSidebar.tsx`](../../src/components/project/ProjectSidebar.tsx)
  - 从 `conversations` 派生项目列表
  - 根据任务和 blocker 计算项目摘要
  - 通过 `selectedConversationId` 切换当前上下文
- [`ProjectCreateDialog.tsx`](../../src/components/project/ProjectCreateDialog.tsx)
  - 负责新建项目

### 指挥室

- [`ProjectChatPanel.tsx`](../../src/components/project/ProjectChatPanel.tsx)
  - 展示当前项目标题、goal、拆解状态
  - 聚合当前项目任务数
  - 内嵌 [`GlobalChatRoom.tsx`](../../src/components/task-hub/GlobalChatRoom.tsx)
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
  - 基于任务状态推导下一步代办
  - 基于 blocker 列表展示风险
- [`MiniKanban.tsx`](../../src/components/project/MiniKanban.tsx)
  - 当前项目任务概览

### 任务执行与设置

- [`TaskDetailPanel.tsx`](../../src/components/task-hub/TaskDetailPanel.tsx)
  - 任务详情
  - 状态流转
  - CLI 执行入口
  - 终端输出
- [`SettingsDrawer.tsx`](../../src/components/task-hub/SettingsDrawer.tsx)
  - 系统摘要
  - daemon / runtime / bridge 检查
  - 账号与执行配置入口

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

因此前端组件的职责已从”直接持有全部业务状态”变为：

- 渲染状态
- 调用 store action
- 通过 store 间接触发 API 写入与实时更新

## 2.6 样式与设计系统

全局样式位于 [`src/app/globals.css`](../../src/app/globals.css)：

- Tailwind v4：`@import "tailwindcss";`
- 设计变量：`--bg-* / --text-* / --status-* / --accent-*`
- 通过 HSL variables 驱动卡片、边框、状态色和深浅模式
- 页面主风格已经从“纯任务板”转向“控制台 / 工作台”式布局
