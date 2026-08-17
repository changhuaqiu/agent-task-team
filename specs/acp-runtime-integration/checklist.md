# ACP 运行时统一接入验收清单

## 协议与架构

- [x] OpenCode、Claude、Codex 都通过同一个 `AcpBackend` 接入。
- [x] OpenCode 标记为 `native`；Claude、Codex 标记为 `adapter`。
- [x] daemon 中没有按厂商解析私有 stdout 的逻辑。
- [x] Catalog 是 launcher、版本和验证能力的唯一事实源。

## 行为

- [x] 三种运行时均能创建会话并流式返回文本。
- [x] 支持时可恢复会话；不支持时返回明确能力错误或受控降级。
- [x] tool call、tool result、thinking、plan、done 与 error 可持久化和展示。
- [x] 同一 `toolCallId` 的 tool call 与多个 result update 始终显示相同工具名。
- [x] cancel 能中止执行并回收连接及子进程。
- [ ] permission 支持允许、拒绝和需要确认，不存在默认静默全授权。
- [x] 自主交付的代码修改授权只产生受管 Invocation 内的 `allow_once`，外部 Git/PR 副作用仍分别受合同字段约束，且请求与决策可审计。
- [x] 认证失败、适配器缺失、协议不兼容和异常退出都有可定位错误。

## 验证与文档

- [x] `src/test-helpers/acp/` mock ACP 集成测试通过，生产 server 树不承载测试 runtime。
- [x] OpenCode 真实 smoke test 通过。
- [x] Claude 真实 smoke test 通过。
- [x] Codex 真实 smoke test 通过。
- [x] 相关单元测试、集成测试、类型检查和构建通过。
- [x] `architecture/cli-integration.md` 与 `docs/wiki/04-backend-daemon.md` 已同步。
- [x] 所有 legacy backend 和迁移旗标已删除。
- [x] 跨平台进程启动由唯一 `AcpBackend` 直接拥有，不保留单调用者 pass-through spawn 模块。

## 健壮性

- [x] adapter 实际执行命令与 Catalog 版本一致且精确锁定。
- [x] 默认权限拒绝；显式 allow_once 可用；策略错误时拒绝。
- [x] kill/timeout/spawn error/process exit/output overflow 均在有界时间内解析结果。
- [x] 消费者提前停止读取事件时，运行会被取消并回收。
- [x] 全局并发、事件队列、单事件、总输出和 stderr 均有上限。
- [x] stderr 诊断经过脱敏，不记录 prompt、token 或完整凭据。
- [x] `write EPIPE` 等握手失败不会抢先丢弃随后到达的子进程 stderr 与退出码。
- [x] 临时 runtime 配置不污染项目目录，cleanup 可重复调用。
- [x] daemon shutdown 会终止所有活跃 ACP 进程。
- [x] 不支持 resume 的 backend 不会因失败重复执行 prompt。
- [x] 有 ACP 活动的长 turn 不会在启动后固定 300 秒被终止。
- [x] 真正无活动的 turn 仍会在 idle timeout 后回收。
- [x] hard max turn timeout 可终止持续产生更新但不结束的异常进程。
- [x] 小写 runtime 原生工具不会触发平台自定义工具执行。
- [x] 连续 ACP 文本 chunk 在历史消息中只形成一个逻辑文本段，工具边界前后不误合并。
