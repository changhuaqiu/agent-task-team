# Acceptance Checklist

- [x] TaskStatus vocabulary 与 repository 合法迁移只有一个共享事实源。
- [x] `/api/state` 和 socket sync 不再降级正式状态。
- [x] 浏览器 Task 状态无 `pending/rejected`。
- [x] 直接 UI 动作不暴露需要证据或 QualityGate 的迁移。
- [x] 新建任务不再展示无效初始状态选择，optimistic/server 均为 `ready`。
- [x] v9 持久化迁移清理旧状态，socket 非法值 fail closed 并可诊断。
- [x] Agent preset schema 与 seed 后既有行使用正式七态。
- [x] TASKS.md 历史文本兼容仍在服务端 intake 生效。
- [x] 文档、TypeScript、定向测试、构建与全量测试已记录。
- [x] 独立复审为 Critical 0 / Important 0 / Minor 0。
