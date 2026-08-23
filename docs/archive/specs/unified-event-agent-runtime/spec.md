# 统一事件、身份与 Agent Runtime

> Status: implemented
> Date: 2026-08-23
> Branch: `codex/unified-event-agent-runtime`
> Long-term design: `docs/technical/execution/unified-event-agent-runtime.md`
> Archived: 2026-08-23

## 1. 目标

参考 Buzz 已验证的统一事件与 Agent runtime seam，直接替换本项目平行的事件/身份/Socket
协议和浅层 runtime 编排，形成一个共享事件语义核、一个项目展示通道和一个 Agent Runtime 深模块。

## 2. 冻结决策

1. 不考虑历史客户端或旧 Socket 协议迁移，不双写、不保留 no-op listener。
2. 领域表仍是事实源；统一事件信封不引入全量 Event Sourcing。
3. Platform Event 与 Project View Event 共享 identity/scope/causality 语义，但持久可靠性不同。
4. Presentation 必须显式区分 durable 与 transient；断线只对 durable 事实做快照对账。
5. 浏览器项目运行展示只消费 `project:view`。
6. Agent Runtime 接收已裁决 `InvocationDispatchPlan`，内部拥有 envelope、reservation、ACP lifecycle、
   session、permission、event normalization、cancel 和 cleanup。
7. Runtime completion 不等于 Task/Delivery completion。
8. payload catalog 保持领域所有，不建立 Buzz 式巨型中央 kind registry。

## 3. 范围

包含：共享 `IdentityRef` / `EventEnvelope`；Platform Event 与 Project View 契约重构；旧项目 Socket
通道删除；Project View consumer 合并；Agent Runtime 模块提取与调用链重接；测试、架构门禁、
长期文档和 wiki 同步。

不包含：迁移旧浏览器；远端多节点 transport；更换 ACP SDK；改变 Task/Gate/A2A/Delivery 状态机；
复制 Buzz 代码、品牌或资产。

## 4. 依赖

- `specs/system-control-plane/`
- `specs/frontend-architecture-refactor/`
- `specs/acp-runtime-integration/`
- `docs/technical/execution/platform-runtime-event-model.md`
- `docs/technical/execution/platform-harness-state-machine-design.md`

冲突时以 owner 唯一、WebUI 被动投影、Runtime fail-closed 和 Durable Effect Outbox 为硬约束。

## 5. 退出条件

- `checklist.md` 全部通过；
- 旧 Socket 项目运行通道生产者与消费者为零；
- Platform/Event View 共用统一 identity/scope/causality；
- Invocation Pipeline 只依赖 Agent Runtime Interface；
- ACP 生命周期与 event normalization 位于 Agent Runtime 模块树；
- 相关测试、typecheck、全量测试和 build 通过，或准确记录与本分支无关的稳定基线失败；
- 设计、wiki、相关 specs 与代码一致。

## 6. 风险

- 一次删除旧通道会暴露遗漏 producer：用全仓静态扫描和项目视图回归阻止。
- 大 Store 修改可能改变展示：将旧 handler 原样收敛到一个 Project View reducer，再独立深挖 Store。
- daemon 拆分可能改变异常时序：先锁定 reservation/ACK/single-terminal 测试，再移动 implementation。
