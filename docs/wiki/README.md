# Agent Task Hub — Code Wiki

本 Wiki 描述项目的当前实现状态和架构设计。

## 快速上手

```bash
# 一键安装
./setup.sh

# 启动生产模式
pnpm start

# 或开发模式（带热更新）
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000) 开始使用。

## 文档导航

| 文档 | 说明 |
|------|------|
| [01-整体架构](./01-architecture.md) | 四层架构、数据流、会话隔离、队列隔离 |
| [02-前端工作台](./02-frontend.md) | 三栏布局、组件结构、状态管理 |
| [03-领域模型](./03-store-model.md) | Zustand Store、数据模型、Rehydrate |
| [04-后端 Daemon](./04-backend-daemon.md) | 执行链路、Session 管理、Agent Backend |
| [05-运行与开发](./05-run-and-dev.md) | 开发环境、测试、部署 |
| [06-依赖与集成](./06-dependencies.md) | 第三方依赖、集成点 |
| [07-架构图](./07-architecture-diagrams.md) | 可视化架构图 |
| [08-开发规范](./08-review-protocols.md) | 代码审查、发布流程 |

## 快速定位

| 模块 | 入口文件 |
|------|----------|
| 前端入口 | `src/app/ClientHome.tsx` |
| 项目工作台 | `src/components/project/ProjectWorkspace.tsx` |
| 状态管理 | `src/store/taskHubStore.ts` |
| Daemon 编排 | `src/server/daemon.ts` |
| 数据库 | `src/server/db/` |
| Repository | `src/server/repositories/` |
| Agent Backend | `src/server/agent/` |
| Skill 系统 | `src/server/repositories/skill-repo.ts` |

## 使用路径

1. **创建项目**：左侧项目栏点击 `+`
2. **配置账号**：右上角设置 → 模型账号 → 添加并验证
3. **绑定角色卡**：设置 → 角色卡 → 为 Agent 绑定账号
4. **配置 Skill**（可选）：Skill 库浏览/导入 → Agent 绑定
5. **开始协作**：在作战指挥室发起对话、创建任务

## 核心概念

### 会话隔离

每个项目中每个 Agent 维护独立的长期会话：
- Session 键：`(agentId, conversationId)`
- 任务完成不会 seal session
- Session 跟随项目生命周期

### 队列隔离

跨项目的排队消息完全隔离：
- 队列键：`agentId:conversationId`
- 项目 A 的 Agent busy 不影响项目 B
- dequeue 时正确匹配 conversationId

### Agent Backend

统一的执行器抽象，支持多 CLI：
- OpenCode
- Claude CLI
- Codex CLI
- Gemini CLI

新增引擎只需实现 `AgentBackend` 接口。

## 项目结构

```
src/
├── app/                    # Next.js App Router
├── components/             # React 组件
│   ├── project/           # 项目工作台
│   ├── task-hub/          # 聊天、任务、设置
│   ├── role-card/         # 角色卡
│   └── skill/             # Skill 系统
├── store/                  # Zustand 状态管理
├── server/                 # 后端逻辑
│   ├── agent/             # Agent Backend
│   ├── repositories/      # 数据访问层
│   └── db/                # 数据库
├── lib/                    # 工具函数
└── pages/api/             # API Routes
```
