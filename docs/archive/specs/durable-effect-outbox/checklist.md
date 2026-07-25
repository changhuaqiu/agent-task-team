# Durable Effect Outbox 验收清单

> 状态：implemented；验收已完成，本文件仅用于历史追溯。

## 契约

- [x] Effect Command 与 Platform Event 的语义边界明确。
- [x] interface 不暴露 lease/attempt/SQL 等实现细节。
- [x] transactional 与 idempotent 两类完成语义有类型和运行时守卫。
- [x] 默认幂等键稳定，内容漂移报冲突。

## 可靠性

- [x] batch 与调用方状态更新原子。
- [x] lane 内严格有序，不同 lane 可并行。
- [x] retry、dead letter、lease recovery、attempt fencing 成立。
- [x] 超时等待 handler 释放，不产生同 command 并发执行。
- [x] transactional 动作和成功 receipt 原子。
- [x] external crash-window 以相同幂等键安全重试。

## Runtime completion

- [x] task sync 失败可重试。
- [x] proof/evaluation/team-log/A2A 已迁移为 adapters。
- [x] A2A response 先于 done。
- [x] held-out evaluation 不产生 production effects。
- [x] Socket 只在 commit 后 best-effort 推送。
- [x] 旧 step receipt 路径已退出。

## 交付

- [x] migration 和 schema 测试通过。
- [x] 相关故障注入与端到端测试通过。
- [x] 确定性全量测试、TypeScript 和 production build 通过。
- [x] 长期设计与 Wiki 已同步。
- [x] 独立评审 Ready。
- [x] 工作区提交后干净。
