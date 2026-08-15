# Acceptance Checklist

- [x] `ContextProviders.getRuntimeRoster` 必须返回数组，不接受 `undefined` fallback。
- [x] Knowledge Tier 只从 Team Runtime roster 构造团队 Fragment。
- [x] `getAllRoleCards / allRoleCards / buildTeamLayer` 生产残留为零。
- [x] 静态 teamLayer 文件与仅自证测试删除。
- [x] 当前 Agent 的 RoleCard identity/bootstrap 行为保持。
- [x] TeamPack/动态成员、scenario、预算、Snapshot 与 dispatch 契约不变。
- [x] 架构守卫覆盖生产 TS/TSX，禁止平行 roster 回流。
- [x] 文档、TypeScript、定向测试、构建与全量结果精确记录。
- [ ] 独立复审为 Critical 0 / Important 0 / Minor 0。
