# 实施任务

- [x] 建立 `ExecutionProfileResolver` 深模块与纯函数测试。
- [x] 扩展 SkillRuntime，分离 eligible、activated、required 与 activation reason。
- [x] 新增 browser-verification preset，并为内建执行/质量角色建立绑定。
- [x] Context planner 使用执行配置编译 Skill，并写入 WorkContract。
- [x] ACP 权限策略仅对 browser_verification capability 放行受限 Playwright 命令。
- [x] 补 planner、WorkContract、permission 与 seed 回归。
- [x] 更新长期技术文档并完成类型、全量测试和生产构建验证。
- [ ] 合并重启后用真实 browser-evidence Task 完成一次线上闭环验证。
- [x] 冻结 Coordinator 对未分配 `proposed/ready` Task 的 Task Graph-first 协调义务。
- [x] 在 Task Graph Outcome owner 中拒绝遗漏冻结 Task 的 proposal，并验证接受后自动派发。
- [x] 升级马里奥默认角色指令与 TeamPack 协作规则，同时保留用户自定义指令。
- [x] 补 Coordinator planning、迁移兼容与 Task Graph Outcome 回归，并完成桌面端重建验证。
