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
| [01-整体架构](./01-architecture.md) | 控制平面目标架构、当前数据流、会话隔离、队列隔离 |
| [02-前端工作台](./02-frontend.md) | 三栏布局、组件结构、状态管理 |
| [03-领域模型](./03-store-model.md) | Zustand Store、数据模型、Rehydrate |
| [04-后端 Daemon](./04-backend-daemon.md) | 执行链路、Session 管理、Agent Backend |
| [05-运行与开发](./05-run-and-dev.md) | 开发环境、测试、部署 |
| [06-依赖与集成](./06-dependencies.md) | 第三方依赖、集成点 |
| [07-架构图](./07-architecture-diagrams.md) | 可视化架构图 |
| [08-开发规范](./08-review-protocols.md) | 代码审查、发布流程 |
| [Agent 评估](./agent-evaluation.md) | 冻结快照、持久评估任务、Judge 降级、实验与提案的当前实现 |
| [Project Context](./project-context.md) | 代码库分层索引、增量加载、同目录 workstream 隔离与 Harness 注入的当前实现 |

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
| Project Context | `src/server/project-context/project-context-service.ts` |

## 使用路径

1. **接入项目并创建目标**：选择项目目录，创建工作项并填写验收；此时只是记录目标。
2. **交给团队安排**：查看统筹者及账号来源，显式提交安排请求。默认配置可以继承本地登录，不必重复创建账号；需要独立账号时再到设置配置。
3. **处理当前阻塞**：从概览直接进入对应任务；检查原因后补充输入或重试，不自动扩大权限。
4. **查收成果与验收**：进入工作项的“成果与验收”，按贡献角色和类别预览文件，并核对与这项工作绑定的验收和证据。

项目概览是汇总，不是公共群聊；每项工作拥有自己的任务、活动与成果。旧项目同样生效，历史缺失证据不会被补成已通过。详细契约见[简明工作旅程](../product/ux/2026-09-06-simple-work-journey.md)、[结果与安全预览](../technical/execution/work-result-reading.md)及[体验评测](../technical/evaluation/2026-09-06-ux-journey-evaluation.md)。

## 核心概念

### 会话隔离

每个项目中每个 Agent 维护独立的长期会话：
- Session 键：`(agentId, conversationId)`
- 任务完成不会 seal session
- Session 跟随项目生命周期

### 队列隔离

跨项目的排队消息完全隔离：
- 服务端事实源：`agent_inbox_item`，按 `projectId + projectAgentId` claim
- 项目 A 的 Agent busy 不影响项目 B
- 浏览器队列仅作显示投影，不负责启动下一次执行

### Agent Backend

Agent 执行统一经 ACP Catalog 与唯一 `AcpBackend`，当前 engine 为 OpenCode（原生 ACP）、Claude 和 Codex（ACP 适配器）。Google、Kimi、OpenCode 与 Other API Key 账号由 OpenCode provider 配置消费，连接验证也复用该正式配置；不存在旁路厂商 CLI backend。新增 engine 必须先提供可验证的 Catalog/ACP Adapter，不能只扩展前端 union 或 daemon map。

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
