# 统一协作内核验收清单

## 产品与对象

- [x] Workspace 是长期协作空间，Delivery 是委托结果，不再混为同一对象。
- [x] Agent identity 与 Runtime process 分离。
- [x] 用户主视图不暴露 Lane、Inbox、ACK 等内部术语。

## 统一触发

- [x] 所有生产 Work trigger 只调用 `CollaborationKernel.request()`。
- [x] 调用者不提交预编译 Runtime Prompt、Session、Node 或 Lease。
- [x] request identity、cause、scope、replyTo 可从 Inbox durable row 恢复。
- [x] 相同幂等键同内容去重、不同内容 fail closed。

## 调度与恢复

- [x] 同项目同 Agent 最多一个 in-flight，不同 Agent 可并行。
- [x] claim lease 过期后可恢复且旧 worker 不能提交终态。
- [x] claim 被取消、续租失败或 worker 停止后，旧 worker 不能 ACK Runtime。
- [x] claim 校验、Envelope ACK 与 Inbox admitted 使用一个原子持久事务，无 check/ACK TOCTOU。
- [x] Invocation owner lease 在所有 daemon 间维持 lane busy；只在 lease 过期后恢复 orphan。
- [x] Runtime event、Session 绑定和 terminal result 使用 Invocation owner fence；旧 owner 的迟到输出无业务副作用。
- [x] Permission callback 与 backend error 路径同样 owner-fenced；失权后拒绝权限并跳过 Envelope/领域副作用。
- [x] Evaluation 的 admitted→running 是可重放的持久投影，ACK 后 crash 不会留下 planning Case。
- [x] Socket/browser 退出不影响 durable request。
- [x] A2A 分支和聚合回调具有可追溯 reply address。

## Runtime

- [x] Invocation、Session 和 ACP execution handles 创建后才 ACK。
- [x] setup failure 不会留下 acknowledged Envelope。
- [x] ACP readiness 区分 execution handles 与真实 session setup 成功。
- [x] Runtime startup failure 有界真实重试，不被 completed dedupe cache 吞掉。
- [x] busy/deferred 不进入 completed dedupe cache，也不消耗 Runtime startup failure 预算。
- [x] ACK 后失败具有 phase-specific reason code。
- [x] Runtime completion 不越权推进业务 owner。

## 验证

- [x] 接口级测试通过。
- [x] 五类入口集成测试通过。
- [x] 静态架构门禁通过。
- [x] TypeScript 类型检查通过。
- [x] 全量测试和生产 build 通过。
- [x] 长期文档、wiki、相关 active specs 与代码一致。
