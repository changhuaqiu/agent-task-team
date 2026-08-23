# 统一事件、身份与 Agent Runtime 验收清单

## 事件与身份

- [x] 事件 id、project identity、actor、subject、correlation、causation 和 occurredAt 只有一套共享定义。
- [x] Platform Event 保留 durable stream sequence、aggregate 与 recordedAt。
- [x] Project View 明确标记 durable/transient，并能引用 canonical source event。
- [x] Agent、Runtime Node、Invocation 与 System 身份不会互相冒充。
- [x] 领域 payload catalog 仍由领域 owner 管理。

## 项目展示

- [x] 浏览器项目运行展示只注册 `project:view`。
- [x] 旧 task/dispatch/command Socket 通道没有生产者或消费者。
- [x] 错项目、非法 identity、未知 version 的事件不改变 Store。
- [x] Task revision 不回退，持久消息可由快照对账。

## Agent Runtime

- [x] Invocation Pipeline 只依赖 Agent Runtime Interface。
- [x] Runtime 内部拥有定向 envelope、原子 reservation、ACK 和 ACP turn normalization。
- [x] 远端 executor 未连接时 fail closed，不降级本地执行。
- [x] Agent/ACP update 只在 Runtime 内归一化成 canonical `runtime.*`。
- [x] 每次 accepted Invocation 只有一个 terminal lifecycle，资源在异常路径有界回收。
- [x] Runtime completion 不直接改变 Task、Gate、A2A 或 Delivery 事实。

## 质量

- [x] 静态架构测试通过。
- [x] 相关单元/集成测试通过。
- [x] TypeScript 类型检查通过。
- [x] 全量测试与生产 build 通过，或准确记录无关基线失败。
- [x] 长期文档、wiki、相关 specs 与实现一致。
- [x] 外部参考检查确认未复制 Buzz 源码、品牌或资产。
