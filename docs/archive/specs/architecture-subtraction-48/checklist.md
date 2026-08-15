# Acceptance Checklist

- [x] ACP fallback model 行为保持，未保留无消费者的 host model 常量。
- [x] 正式 ACP 权限只由 fail-closed operator / WorkContract / correlated MCP 策略拥有。
- [x] Project Context freshness 计算与 stale 判断保持。
- [x] SkillRuntime 生产公共面不再包含测试 fixture。
- [x] unit/integration/E2E 使用同一个 test-helper 构造 SkillPackageInput。
- [x] watcher cleanup 幂等且不会让重复 start 夺取已有 watcher 所有权。
- [x] TASKS.md 首次 add、restart reproject 与 conversation isolation 保持。
- [x] 架构守卫阻止五个退休接口回流。
- [x] 文档、类型、定向、build 与全量结果记录。
- [x] 独立复审无 Critical / Important。
