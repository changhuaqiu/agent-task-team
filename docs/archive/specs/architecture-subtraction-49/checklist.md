# Acceptance Checklist

- [x] Invocation managed lifecycle、reason code 与 Domain Event 事务保持。
- [x] Invocation 调用方只消费 repository lifecycle 与必要 row/input/output 类型。
- [x] Phase 正式 interface 只有 list/upsert/delete，Pages API 行为保持。
- [x] Agent 正式 interface 只有 list/upsert/delete，preset 删除保护保持。
- [x] Conversation aggregate 仍删除项目 phases。
- [x] ACP session metadata、Task notification/watcher、WorkContract dispatch、worktree GC 与 Invocation registry 行为保持。
- [x] 三个死 helper 删除，内部-only helper 不再导出。
- [x] 架构守卫阻止死 helper和内部实现重新进入公共 interface。
- [x] 文档、类型、定向、build 与全量结果记录。
- [x] 独立复审无 Critical / Important。
