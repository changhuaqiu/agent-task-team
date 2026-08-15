# Acceptance Checklist

- [x] `agent_team_pack` 并行成员绑定不再是当前 schema。
- [x] 六个旧 repository 方法和对应自嗨测试删除。
- [x] Conversation→TeamPack 与 TeamPack→roles 正式关系保持。
- [x] TeamPackRole 的 RoleCard/Account/Skill 配置链保持。
- [x] create/update/delete/list/export、role config、seed 与 runtime 解析保持。
- [x] forward-only migration 在真实 SQLite 删除遗留表。
- [x] 架构守卫阻止旧表写读和旧 interface 回流。
- [x] 文档、类型、定向测试、构建与全量结果精确记录。
- [x] 独立复审为 Critical 0 / Important 0。
