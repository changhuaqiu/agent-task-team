# 统一事件、身份与 Agent Runtime 任务

## Phase 0：契约

- [x] 审计 Buzz 统一事件、relay 与 ACP runtime 真实源码。
- [x] 审计本项目 Platform Event、Project View、Socket 和 Agent execution 调用链。
- [x] 冻结长期设计、活动规格和删除策略。

## Phase 1：统一事件与身份

- [x] 新增共享 Identity/Event Envelope 类型和运行时校验。
- [x] 让 Platform Event 复用共享语义核并保持 durable cursor。
- [x] 让 Project View 显式携带 identity、causality 与 durable/transient class。
- [x] 更新 publisher、runtime projection 和 browser consumer 测试。

## Phase 2：单一项目事件通道

- [x] 将 Task state/notification/wakeup/sync/error 投影到 `project:view`。
- [x] 将 dispatch receipt 投影到 `project:view`，删除无生产者的 command error 兼容分支。
- [x] 删除旧 Socket emitter、listener、类型与兼容断言。
- [x] 添加架构门禁，阻止旧通道回归。

## Phase 3：Agent Runtime

- [x] 建立 `src/server/agent-runtime/` 深模块与最小 Interface。
- [x] 把定向 envelope、reservation/ACK 与 ACP turn normalization 收入模块。
- [x] 把 ACP Catalog/setup/permission/backend、Session generation 和 process cleanup 收入模块。
- [x] 重接 Invocation Pipeline 与 daemon 组合根。
- [x] 删除旧 daemon execution adapter 和 compatibility runtime bridge 命名。
- [x] 覆盖 busy、remote fail-closed、ACK、single terminal 与 cancellation。

## Phase 4：验证与收尾

- [x] 更新 platform runtime、frontend、daemon wiki 和相关 active specs。
- [x] 运行架构门禁、typecheck、相关测试、全量测试与 build。
- [x] 完成代码审查并修复发现。
- [x] 按 iteration knowledge 标准记录可复用结论并归档已完成 spec。
