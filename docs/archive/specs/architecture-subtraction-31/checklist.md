# Acceptance Checklist

- [x] `Agent` 不含 `role / roleLabel`，生产代码无 `AgentRole` 或兼容映射表。
- [x] `getEffectiveRoster()` 不再复制角色分类或默认猜测 `worker`。
- [x] AgentBar、Roster Modal、TaskDetail 和 Team context 只从 RoleCard 得到岗位展示。
- [x] RoleCard 缺失时 UI/Context 不恢复旧静态分类。
- [x] `getRoleCardById / getRoleCardForAgent` 从 Store interface 与实现删除。
- [x] DK 默认评审身份由真实 RoleCard 断言覆盖。
- [x] 架构守卫覆盖生产 TS/TSX，禁止旧字段和死 action 回流。
- [x] 文档、TypeScript、定向测试、构建和全量结果精确记录。
- [x] 独立复审为 Critical 0 / Important 0 / Minor 0。
