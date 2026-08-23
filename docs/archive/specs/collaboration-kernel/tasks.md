# 统一协作内核任务

## 契约

- [x] 从 Buzz Relay/ACP 提炼 identity、durable trigger、per-space serialization、replay、callback 不变量。
- [x] 定义 Workspace / Project / Delivery / Agent / Runtime 的产品关系。
- [x] 冻结 `WorkRequest`、`replyTo`、Lane 和真实 ACK 语义。

## 实现

- [x] 新增 `CollaborationKernel` 深 Module 与接口级测试。
- [x] 在内部 AgentWorkCommand 保存 requestId、laneId 和 replyTo。
- [x] Human Command、Task Router、Gate/Delivery Control、A2A、Evidence Recovery 改走 Kernel。
- [x] 删除生产领域模块对 `AgentInbox.enqueue()` 的直接依赖并增加静态门禁。
- [x] 将 Runtime ACK 移到 Invocation/ACP execution handle 真正创建之后。
- [x] 增加未 ACK setup failure、ACK 后 failure、重放去重和 Lane 串行集成测试。
- [x] 增加 ACP 显式 readiness、claim fencing、启动重试与 orphan Invocation 恢复。
- [x] 将 Evaluation Case 与 Task wakeup 的直接 Invocation 入口改为统一 WorkRequest。
- [x] 将幂等唯一性统一限定为 project + Agent scope，并校验 cause event project。

## 收尾

- [x] 更新 system-control-plane、context-manager、ACP runtime 规格的实际状态。
- [x] 更新长期架构、wiki、产品愿景与评测记录。
- [x] 运行相关测试、类型检查、全量测试和生产 build。
- [ ] 完成代码评审、知识沉淀和原子提交。
