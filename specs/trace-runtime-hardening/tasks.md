# Tasks

## Phase 1: Diagnosis and design

- [x] 从 Phoenix 与 `.ath/data.db` 对齐最近 Invocation、Tool、Outcome、Task 和 Session 事实。
- [x] 写入诊断报告、修复计划和活动规格。

## Phase 2: WorkContract ownership

- [x] 将 accepted Outcome 收敛为每个 WorkContract 唯一一个。
- [x] 从 WorkContract permissions 裁掉 Task 领域 mutation tool。
- [x] 将浏览器产物服务归入 `browser-verification` Skill。
- [x] 增加结果接纳与派发权限回归测试。

## Phase 3: ACP session health

- [x] 增加累计输入 token / Invocation 次数预算与 session seal reason。
- [x] 在 daemon 恢复 CLI session 前执行预算轮换。
- [x] 增加 repository 与配置回归测试。

## Phase 4: Phoenix online projection

- [x] 接入 OTLP exporter、redaction 与 runtime worker fail-open 投影。
- [x] 补齐 exporter、worker 和配置测试。
- [x] 用本地 Phoenix 验证新 trace 可见并可按业务字段定位。

## Phase 5: Verification and documentation

- [x] 运行 full Vitest、TypeScript、受影响路径 ESLint 和 production build。
- [x] 更新长期执行/观测文档和 C 级评测结论。
- [ ] 完成独立代码审查，处理 Critical/Important 反馈。
