---
title: Worktree-Based Project Collaboration Model
created: 2026-05-04
status: draft
---

# Worktree-Based Project Collaboration Model

## Problem Statement

当前项目中，多个 agent 协作时缺乏明确的工作空间边界。所有 agent 共享同一个工作目录，容易产生文件冲突和协作混乱。

**核心需求**：
- 每个"项目"有独立的工作空间
- 所有 agent 协作在同一个工作空间内进行
- 不同项目之间互不干扰

## Design Decisions

### 核心概念映射

| 概念 | 实现 | 说明 |
|------|------|------|
| **项目 (Project)** | Git Worktree + 分支 | 每个项目 = 一个独立 worktree 目录 |
| **特性分支** | `feature/<project-slug>` | 分支命名与项目关联 |
| **协作空间** | worktree 目录路径 | 所有 agent 在同一目录下工作 |

### 目录结构

```
agent-task-team/
├── .worktrees/
│   ├── feature-genshin-chat/     # 项目 A 的 worktree
│   │   ├── src/
│   │   └── ...
│   └── feature-auth-system/      # 项目 B 的 worktree
│       ├── src/
│       └── ...
├── src/                          # main 分支的工作目录
└── ...
```

## Architecture

### 项目生命周期

```
创建项目
    ↓
git worktree add .worktrees/feature-xxx -b feature/xxx
    ↓
Agent 加入项目 → 在该 worktree 目录下工作
    ↓
开发完成 → 创建 PR / 合并回 main
    ↓
git worktree remove .worktrees/feature-xxx
    ↓
git branch -d feature/xxx
```

### Agent 路由规则

当一个 agent 被分配到项目时：

1. **找到 worktree 路径**：根据项目名/分支名定位
2. **切换工作目录**：agent 的所有操作都在该 worktree 内
3. **共享状态**：同一项目的 agent 看到相同的文件状态
4. **隔离性**：不同项目的 agent 互不干扰

**约束**：
- 一个 agent 同时只能属于一个项目
- 一个项目可以有多个 agent
- agent 切换项目需要明确的"离开当前项目 + 加入新项目"操作

## Integration Points

### 与现有系统的集成

| 现有组件 | 集成方式 |
|----------|----------|
| **Daemon** | 根据项目名路由 agent 到对应 worktree |
| **Task Store** | task 关联 project_id，记录在哪个项目下 |
| **前端 UI** | 项目列表展示活跃项目，点击切换上下文 |
| **Git 操作** | 所有 commit/push 在 worktree 内执行 |

## Constraints

1. **文件系统隔离**：不同项目的 agent 不能直接访问对方的文件
2. **Git 操作范围**：所有 git 操作必须在对应 worktree 内执行
3. **依赖管理**：每个 worktree 可能需要独立的 `node_modules`（或使用 pnpm workspace 共享）
4. **端口冲突**：多个项目同时运行时需要分配不同端口

## Open Questions

1. **依赖共享策略**：是否共享 `node_modules`？还是每个 worktree 独立安装？
2. **项目归档**：完成后是删除 worktree 还是保留一段时间？
3. **跨项目协作**：是否需要支持项目间的代码共享或依赖？

## Next Steps

1. 实现项目创建/销毁的 CLI 命令
2. 修改 Daemon 支持按项目路由 agent
3. 前端 UI 展示项目列表和切换
