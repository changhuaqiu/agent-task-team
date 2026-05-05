# 工程三件套 (Engineering Trio)

> Planner + Coder + Reviewer 经典组合，适合中小型项目。

## 团队组成

| 角色 | 职责 | 核心产出 |
|------|------|----------|
| **Planner** (规划师) | 拆解任务、排优先级、梳理依赖 | 任务列表 |
| **Coder** (实现者) | 写代码、调 bug、实现功能 | PR + 测试 |
| **Reviewer** (审查者) | 审查质量、发现问题、把关交付 | 审查意见 |

## 协作流程

```
用户需求
    ↓
┌─────────────────────────────────────────────────────────────┐
│ Planner                                                      │
│  → 理解需求                                                  │
│  → 拆解任务                                                  │
│  → 派发给 Coder                                             │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ Coder                                                        │
│  → 接收任务                                                  │
│  → 编写测试                                                  │
│  → 实现代码                                                  │
│  → 提交 PR                                                  │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│ Reviewer                                                     │
│  → 审查代码                                                  │
│  → 运行测试                                                  │
│  → 出具结论                                                  │
└─────────────────────────────────────────────────────────────┘
    ↓
   ┌┴┐
   │  │
   ↓  ↓
  通过  打回
   │    │
   │    └──→ Coder 修改 ──→ Reviewer 重新审查
   │
   ↓
  完成
```

## 状态流转

```
planning → implementing → reviewing → done
                ↑              │
                └──── 打回 ────┘
```

| 状态 | 负责人 | 说明 |
|------|--------|------|
| `planning` | Planner | 正在拆解任务 |
| `implementing` | Coder | 正在实现代码 |
| `reviewing` | Reviewer | 正在审查代码 |
| `blocked` | Planner | 遇到阻塞，等待解决 |
| `done` | - | 任务完成 |

## 通信规则

| 角色 | 可以发给谁 | 可以接收谁的消息 |
|------|------------|------------------|
| Planner | Coder | Reviewer, Coder |
| Coder | Reviewer, Planner | Planner, Reviewer |
| Reviewer | Planner, Coder | Coder |

## 使用场景

- ✅ 中小型项目开发
- ✅ 功能迭代
- ✅ Bug 修复
- ✅ 代码重构

## 不适用场景

- ❌ 大型项目（需要更多角色）
- ❌ 需要设计角色（需要 Designer）
- ❌ 需要运维角色（需要 DevOps）

## 配置示例

```json
{
  "team": "engineering-trio",
  "project": "my-project",
  "settings": {
    "max_iterations": 3,
    "escalation_timeout_hours": 2,
    "require_evidence": true
  }
}
```

## 相关文件

- `pack.json` — 团队元数据和协作规则
- `roles/planner/SOUL.md` — 规划师角色定义
- `roles/coder/SOUL.md` — 实现者角色定义
- `roles/reviewer/SOUL.md` — 审查者角色定义
- `shared/PROJECT.md` — 项目上下文（待填写）
- `shared/CONSTRAINTS.md` — 团队约束
