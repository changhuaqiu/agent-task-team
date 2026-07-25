# Durable Effect Outbox 实施任务

> 状态：implemented；全部任务已完成，本文件仅用于历史追溯。

## 1. 设计与持久化

- [x] 更新平台事件长期设计，增加 Effect Outbox seam 与 ADR。
- [x] 增加 migration 和 Drizzle schema：command、attempt、索引、约束。
- [x] 定义 Effect Command、registration、执行模式与稳定错误。

## 2. 深模块

- [x] 实现 `enqueueBatch()` 原子接纳、规范 JSON 与幂等冲突。
- [x] 实现 lane 顺序 claim、attempt、lease、fencing、重试和 dead letter。
- [x] 实现 transactional adapter 的动作/receipt 同事务。
- [x] 实现 idempotent adapter 与 after-commit best-effort 通知。
- [x] 实现 startup recovery 与 worker tick。

## 3. Runtime completion 迁移

- [x] 把 completion port 改成纯 Effect 规划。
- [x] 注册 task-sync、proof、evaluation、team-log、A2A response/done adapters。
- [x] held-out evaluation 保持 production effect 隔离。
- [x] 删除 daemon 的 `runRuntimeCompletionStep()` 调用。
- [x] 删除旧 step receipt 生产模型和 migration 后表。

## 4. 验证与收尾

- [x] 覆盖 batch 原子性、幂等冲突、顺序、并行、恢复、fencing、超时。
- [x] 覆盖 transactional 原子性和 idempotent crash-window。
- [x] 覆盖 Runtime completion 全链与 A2A retry。
- [x] 运行 TypeScript、相关测试、确定性全量测试和 production build。
- [x] 更新长期设计、Wiki 与知识沉淀判断。
- [x] 独立代码评审无 blocker。
- [x] Spec 完成后归档并创建原子提交。
