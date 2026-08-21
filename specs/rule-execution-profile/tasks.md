# 实施任务

- [x] 建立 `ExecutionProfileResolver` 深模块与纯函数测试。
- [x] 扩展 SkillRuntime，分离 eligible、activated、required 与 activation reason。
- [x] 新增 browser-verification preset，并为内建执行/质量角色建立绑定。
- [x] Context planner 使用执行配置编译 Skill，并写入 WorkContract。
- [x] ACP 权限策略仅对 browser_verification capability 放行受限 Playwright 命令。
- [x] 补 planner、WorkContract、permission 与 seed 回归。
- [x] 更新长期技术文档并完成类型、全量测试和生产构建验证。
- [ ] 合并重启后用真实 browser-evidence Task 完成一次线上闭环验证。
