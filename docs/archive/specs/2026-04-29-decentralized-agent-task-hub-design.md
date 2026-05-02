# 去中心化 Agent 团队协作任务系统 (Decentralized Agent Task Hub)

## 1. 系统概述 (Overview)
本项目旨在基于现有的单节点 `opencode` 代理，构建一个**去中心化的 Agent 研发团队（Multi-Agent System）**。
系统采用 **“状态上板 + 消息通知” (Blackboard + Event-driven A2A)** 的混合驱动架构，结合专门的 **代码审查节点 (Reviewer Node)**，实现任务全生命周期的**可视、可管、可 push、可推进、可迭代**。

### 1.1 核心设计目标 (The "5-Abilities")
- **可视 (Visual)**: 通过中心化看板（Task Hub）实时反映所有任务节点的状态流转。
- **可管 (Manageable)**: 人类可随时介入，修改状态、中断死循环、重新分配任务。
- **可 push (Pushable)**: 外部需求可通过 API/CLI 注入任务池；Agent 可互相派发子任务。
- **可推进 (Drivable)**: 通过 A2A (Agent-to-Agent) 文本提及路由，确保任务节点无缝衔接。
- **可迭代 (Iterative)**: 引入独立的 Reviewer Agent，实现严谨的“开发-审查-打回-修复”闭环。

---

## 2. 核心架构设计 (Architecture)

### 2.1 组织架构 (Agent Roles)
系统采用**异构专家池 (Heterogeneous Expert Pool)** 结合**黑板模式 (Blackboard Pattern)**。
- **Planner Agent (架构师/拆解者)**: 接收人类的大需求，将其拆解为细粒度的 Task Items 写入看板，并分配给执行节点。
- **Worker Agents (执行节点, 如 `opencode-frontend`, `opencode-backend`)**: 专注于执行特定领域的编码任务。
- **Reviewer Agent (审查节点)**: 独立的“质检员”。不写业务代码，专职进行 Code Review，决定任务是 `approved` (放行) 还是 `rejected` (打回)。

### 2.2 数据模型 (Task Entity)
Task Hub (如 SQLite/PostgreSQL) 中存储的核心任务实体：
- `id`: 唯一任务标识 (e.g., `TASK-101`)
- `title`: 任务摘要
- `description`: 详细需求与验收标准 (AC)
- `status`: 状态机 (`pending` | `in_progress` | `in_review` | `done` | `rejected` | `blocked`)
- `assignee`: 当前负责的 Agent ID
- `dependencies`: 前置任务 ID 数组
- `artifacts`: 关联的文件路径、PR 链接或错误日志

### 2.3 通信与驱动机制
- **状态流转 (MCP Tools)**: 
  开发一组专门的 MCP 工具（如 `hub_create_task`, `hub_update_status`, `hub_get_my_tasks`）。所有 Agent 通过调用这些工具与中心化数据库交互，确保状态**可视、可管**。
- **接力通知 (A2A Text Routing)**: 
  当一个 Agent 完成当前阶段工作（更新完看板状态）后，在其输出文本的末尾使用 `@` 语法（如 `@reviewer-agent TASK-101 已完成，请审查`）。后端的 A2A Router 会捕获该指令，唤醒目标 Agent 并将上下文传递给它，确保任务**可推进**。

---

## 3. 核心执行流程 (Execution Flow)

### 3.1 任务创建与分配 (Push & Assign)
1. **人类 Push**: 用户向 Planner Agent 下发需求：“开发登录模块”。
2. **拆解上板**: Planner 调用 `hub_create_task` 创建 `TASK-1(后端接口)` 和 `TASK-2(前端页面, 依赖 TASK-1)`。
3. **唤醒 Worker**: Planner 输出：`@backend-agent 任务已分配，请开始执行 TASK-1。`

### 3.2 任务执行与提交 (Execution)
1. **接单**: `backend-agent` 被唤醒，调用 `hub_get_my_tasks` 确认任务，调用 `hub_update_status(TASK-1, 'in_progress')`。
2. **编码**: 使用自带的读写工具完成代码。
3. **提测**: 完成后，调用 `hub_update_status(TASK-1, 'in_review')`，并输出：`@reviewer-agent TASK-1 代码已提交，请审查。`

### 3.3 独立代码审查与迭代 (Review & Iteration)
1. **审查启动**: `reviewer-agent` 被唤醒，拉取 TASK-1 的代码变更进行分析。
2. **审查通过 (Approved)**:
   - 调用 `hub_update_status(TASK-1, 'done')`。
   - 检查看板发现 TASK-2 的前置条件已满足。
   - 输出接力指令：`@frontend-agent TASK-1 已通过审查，你可以开始执行 TASK-2 了。`
3. **审查驳回 (Rejected/Iterative)**:
   - 发现代码有 Bug 或不符合规范。
   - 调用 `hub_update_status(TASK-1, 'rejected', '缺少入参校验')`。
   - 输出打回指令：`@backend-agent 代码未通过审查（缺少入参校验），请修复。`
4. **修复循环**: `backend-agent` 重新唤醒，根据审查意见修改代码，再次提交至 `in_review` 状态，直至通过。

### 3.4 人类干预与熔断 (Management & Circuit Breaking)
- **死循环保护**: A2A Router 监控交互深度（Depth Limit）。如果 `backend-agent` 和 `reviewer-agent` 连续打回/提交超过 N 次，系统自动将任务置为 `blocked`。
- **人工接管**: 人类通过看板 UI 发现 `blocked` 任务，介入指导（“不要用 JWT，改用 Session”），并手动 `@backend-agent 按新要求重写`，恢复流程。

---

## 4. 后续实现计划 (Implementation Plan)
1. **Phase 1**: 设计 Task Hub 数据库 Schema (SQLite) 和基础的 MCP CRUD 工具集。
2. **Phase 2**: 为 Planner, Worker, Reviewer 编写 System Prompts，注入工作流规范和工具调用示例。
3. **Phase 3**: 完善后端的 A2A Text Router，支持跨节点唤醒和上下文（Thread History）的无损传递。
4. **Phase 4**: 构建前端看板 UI，实现纯人类视角的“可视”与“可管”。
