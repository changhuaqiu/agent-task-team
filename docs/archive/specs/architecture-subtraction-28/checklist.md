# Acceptance Checklist

- [x] `src/server/agent/cliBridge.ts` 与 `spawnCli` 不存在。
- [x] `AcpBackend` 直接使用 `cross-spawn`，参数与错误语义保持。
- [x] `cross-spawn` 生产消费者只有 `AcpBackend`。
- [x] Catalog、daemon、session、permission、事件与 UI 行为未改变。
- [x] 架构守卫禁止恢复 pass-through spawn 模块和 probe wrapper。
- [x] 文档、TypeScript、定向测试和构建通过；全量测试已执行并精确记录 1 个既有基线失败。
- [x] 独立复审为 Critical 0 / Important 0 / Minor 0。
