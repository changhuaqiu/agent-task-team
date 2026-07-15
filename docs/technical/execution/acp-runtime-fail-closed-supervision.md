# 024 · ACP Runtime 使用 Fail-Closed 与有界监督

> 状态：accepted
> 日期：2026-07-15

## 背景

ACP 将平台与 OpenCode、Claude、Codex 的协议统一，但同时引入了 SDK、stdio、adapter 和多层子进程边界。原实现的权限自动批准、无界事件缓存、依赖 `close` 解析取消结果、未锁定的 `npx` 实际参数和项目目录 fallback config，会在异常 agent、慢消费者、网络停顿或上游漂移时放大风险。

OpenClaw 的运行时实现提供了可复用的工程原则：活跃 run 可取消、会话和并发有上限、超时执行 bounded cleanup、流式输出有字符预算、授权与配置异常 fail-closed。项目只采用这些监督原则，不复制其 Gateway 架构。

## 决策

1. `AcpBackend` 成为每轮 ACP 子进程的唯一生命周期 owner，并通过一次性 finalize 收敛所有终态。
2. 调用方取消和超时先发送 ACP cancel，再执行 TERM/KILL 分级回收；结果解析不依赖 `close` 必然到达。
3. 权限默认拒绝，只允许显式 `allow_once` 或注入策略；策略异常同样拒绝。
4. 对并发 run、队列、事件、累计输出和 stderr tail 建立硬上限，超限返回稳定 reason code。
5. adapter launcher 的实际参数必须精确包含 Catalog 版本；Catalog 在使用前运行时校验。
6. Runtime 临时配置只能写入受控临时目录并由幂等 cleanup 回收。
7. daemon 关闭时终止所有活跃 run；只有真正尝试过 resume 的调用才可进行 fresh-session 恢复。

## 替代方案

- 继续依赖 adapter 自行退出：无法约束失联、协议卡死或进程树泄漏。
- 只增加更多 timeout：不能解决权限、输出过载、供应链漂移和结果悬挂。
- 引入 OpenClaw Gateway：超出当前平台边界，也会形成第二套控制面。

## 后果

- 默认权限从隐式授权变为显式授权，部署需要配置运行策略。
- 异常路径获得稳定终态和可定位 reason code，但超限运行会被主动终止。
- 临时目录和子进程回收成为测试门禁。

## 退出条件

若未来 ACP SDK 提供完整的进程监督、权限策略、输出背压和生命周期终结契约，可在兼容测试证明等价后下沉部分实现；平台层的 fail-closed 与资源上限不能取消。
