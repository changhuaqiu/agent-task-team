# 去中心化 Agent 任务枢纽 (Decentralized Task Hub) UX/UI 设计与实施计划

> **For execution:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为去中心化的 Agent 团队打造一个“可视、可管、可 push”的前端任务看板（Task Hub），让多节点（如 Planner, opencode-a, reviewer）的协作状态透明化。

**Architecture:** 采用垂直分组流式布局（参考早期外部看板交互模式），通过 Zustand 订阅后端任务状态。以 Agent 为维度聚合任务，支持多状态（Pending, In Progress, In Review, Done, Blocked）的视觉区分与人工干预交互。

**Tech Stack:** Next.js 14 (App Router), Tailwind CSS, Zustand, Lucide React (Icons), Radix UI (Collapsible).

---

## UX 设计规范 (Design Specs)

### 1. 布局结构 (Layout)
放弃传统的横向 Kanban（在侧边栏或紧凑界面下会拥挤溢出），采用**垂直流式卡片分组 (Vertical Grouped Cards)**：
- **外层容器**: Task Hub Panel（可折叠侧边栏或独立页面）。
- **第一层分组 (By Agent/Role)**: 按当前负责的 Agent 聚合（例如：“Opencode-A 的工作台”、“Reviewer 的工作台”）。
- **第二层分组 (By Status)**: 在每个 Agent 下，按状态分为：
  - 🚨 **Blocked / Rejected** (红色警示，需人工或 Agent 优先介入)
  - 🔄 **In Progress / In Review** (蓝色/紫色，脉冲动画，表示正在运行)
  - ⏳ **Pending** (灰色，排队中)
  - ✅ **Done** (绿色，默认折叠到底部)

### 2. 卡片视觉 (Card Visuals)
单张任务卡片 (Task Item) 的核心元素：
- **Header**: 任务 ID (如 `#TASK-101`) + 标题。
- **Tag**: 状态标签 (Status Badge) 与优先级。
- **Body**: 简短描述或当前进展的最后一条 Comment（例如 Reviewer 的打回原因）。
- **Footer**: 
  - 依赖关系 (Depends on `#TASK-100`)。
  - 操作区 (Action Buttons)：供人类使用的“暂停”、“强制流转”、“分配”按钮。

### 3. 交互动效 (Interactions)
- **状态流转**: 任务状态改变时，卡片通过平滑的位移动画 (Framer Motion 或 Tailwind Transition) 移入新的分组。
- **人工干预**: 悬浮卡片显示操作菜单（如 `Cancel`, `Mark as Done`）。点击可展开查看详细日志。
- **死循环预警**: 当一个任务在 `In Review` 和 `In Progress` 之间横跳超过 3 次时，卡片边框变红并抖动，提示人类介入。

---

## 实施计划 (Implementation Tasks)

### Task 1: 定义状态模型与 Mock 数据
构建基础数据结构，以便在没有后端 API 的情况下进行 UI 开发。

**Files:**
- Create: `src/store/taskHubStore.ts`
- Create: `src/types/taskHub.ts`

- [ ] **Step 1: 定义类型 (Types)**
  在 `taskHub.ts` 中定义 `Task`, `Agent`, `TaskStatus` 枚举。
- [ ] **Step 2: 创建 Zustand Store**
  在 `taskHubStore.ts` 中创建带有 Mock 数据的 Store（包含 A、B 两个 Agent 的数个处于不同状态的任务）。
- [ ] **Step 3: 添加基础 Actions**
  在 Store 中添加 `updateTaskStatus`, `assignTask` 等方法。

### Task 2: 开发原子 UI 组件
构建构成看板的基础 UI 积木。

**Files:**
- Create: `src/components/task-hub/StatusBadge.tsx`
- Create: `src/components/task-hub/TaskCard.tsx`

- [ ] **Step 1: 开发 StatusBadge 组件**
  接收 `status` 属性，返回对应颜色和 Icon（如 `lucide-react` 的 `Clock`, `Loader2`, `CheckCircle`, `AlertTriangle`）。
- [ ] **Step 2: 开发 TaskCard 组件 (基础版)**
  渲染标题、描述、状态 Badge 和负责人头像。
- [ ] **Step 3: 添加人工干预按钮 (Action Bar)**
  在卡片底部添加仅 Hover 时显示的快速操作按钮（利用 Tailwind 的 `group-hover`）。

### Task 3: 开发分组看板视图
将任务卡片按 Agent 和状态进行聚合和布局。

**Files:**
- Create: `src/components/task-hub/AgentTaskGroup.tsx`
- Create: `src/components/task-hub/TaskHubBoard.tsx`

- [ ] **Step 1: 开发 AgentTaskGroup 组件**
  接收一个 Agent 和其名下的 Tasks 列表，内部按状态（Blocked -> In Progress -> Pending -> Done）排序渲染 `TaskCard`。
- [ ] **Step 2: 实现“已完成”折叠逻辑**
  使用 Radix UI Collapsible 或简单的状态控制，将 `Done` 状态的任务默认折叠。
- [ ] **Step 3: 开发 TaskHubBoard 主容器**
  遍历所有活跃的 Agent，渲染多个 `AgentTaskGroup`，处理整体的垂直滚动和空状态 (Empty State)。

### Task 4: 页面集成与状态流转测试
将开发好的看板接入页面，并验证状态更新交互。

**Files:**
- Modify: `src/app/hub/page.tsx` (或指定的入口页面)

- [ ] **Step 1: 引入看板组件**
  在目标页面引入 `TaskHubBoard` 组件。
- [ ] **Step 2: 绑定人工干预操作**
  将 `TaskCard` 上的操作按钮绑定到 `taskHubStore` 的 `updateTaskStatus` 方法。
- [ ] **Step 3: UI 测试与验证**
  在浏览器中点击状态切换按钮，验证卡片是否正确、平滑地移动到对应的状态分组中；验证 Blocked 状态的警示 UI 是否明显。
