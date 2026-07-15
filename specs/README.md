# 活动规格目录

`specs/` 只保存仍在指导实现、尚未完成退出条件的规格。完成、被替代或放弃的规格统一迁入 `docs/archive/specs/`。

## 目录契约

每个活动规格使用 `specs/<name>/`，默认包含：

- `spec.md`：目标、范围、约束、核心契约、风险和退出条件。
- `tasks.md`：按依赖顺序维护的实施任务。
- `checklist.md`：可验证的验收标准。

支持性设计放在 `docs/technical/` 或 `docs/product/`，实施计划放在 `docs/plans/`；它们不能替代本目录中的规范事实源。

## 状态定义

| 状态 | 含义 | 所在位置 |
| --- | --- | --- |
| `draft` | 方向尚未冻结，不得据此大规模实施 | `specs/`，必须列出开放决策 |
| `active` | 决策已冻结，正在实施或等待验收 | `specs/` |
| `implemented` | 退出条件已满足，长期结论已回写 | `docs/archive/specs/` |
| `superseded` | 已被新规格替代 | `docs/archive/specs/`，必须指向替代者 |
| `abandoned` | 明确不再实施 | `docs/archive/specs/`，必须记录原因 |

## 当前活动规格

| 规格 | 状态 | 当前边界 |
| --- | --- | --- |
| [`platform-harness-loop/`](platform-harness-loop/) | active | 服务端 Agent Loop 主规格：触发、角色解析、上下文、派发、执行观察与续接；其他执行/协作规格作为子契约 |
| [`acp-runtime-integration/`](acp-runtime-integration/) | active | 用统一 ACP client 一次接入 OpenCode 原生 ACP、Claude/Codex ACP 适配器，并删除 bespoke backend |
| [`context-manager/`](context-manager/) | active | 统一上下文注入、项目隔离、可见性与 A2A 上下文来源；以 `docs/technical/execution/context-layering.md` 为设计依据 |
| [`team-simplification/`](team-simplification/) | active | 默认团队从 6 人收敛到 4 人并清理旧 preset |
| [`agent-session-stability/`](agent-session-stability/) | draft | 修正失败后的 session seal 与 ID 稳定性，实施前仍需对齐 ACP session 语义 |
| [`system-control-plane/`](system-control-plane/) | active | 统一 dispatch、policy、proof、health 与跨实例状态权威 |
| [`a2a-possession-contract/`](a2a-possession-contract/) | active | 完成持球、传球、交接包语义及控制平面接线 |
| [`group-chat-task-flow/`](group-chat-task-flow/) | active | 已有 baseline，仍有任务图、wakeup 和持久化验收未完成 |
| [`frontend-runtime-performance-refactor/`](frontend-runtime-performance-refactor/) | active | 完成剩余性能验收与订阅边界收敛 |
| [`team-role-card-compatibility/`](team-role-card-compatibility/) | active | 自动化已完成，仍需三项人工兼容验收 |
| [`role-card-format/`](role-card-format/) | draft | 冻结角色卡/Team Pack 文件格式并替换即将移除的示例 |

## 依赖关系

```text
platform-harness-loop
├── system-control-plane
├── context-manager
├── acp-runtime-integration
└── a2a-possession-contract
    └── group-chat-task-flow

system-control-plane
├── acp-runtime-integration
├── agent-session-stability
├── a2a-possession-contract
│   └── group-chat-task-flow
└── context-manager

team-simplification
├── team-role-card-compatibility
└── role-card-format
```

## 使用规则

- 开始实现前读取相关 `spec.md`、`tasks.md`、`checklist.md`。
- 代码行为变化时同步更新活动规格和对应长期文档。
- 规格完成时先将稳定结论回写到 `docs/` 或 `architecture/`，再迁入归档。
- 活动目录中不得保留“任务全部完成但仍列为 active”的规格。
- 被新方案替代的内容不得继续作为并行事实源。
