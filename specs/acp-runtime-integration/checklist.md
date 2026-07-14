# ACP 运行时统一接入验收清单

## 协议与架构

- [ ] OpenCode、Claude、Codex 都通过同一个 `AcpBackend` 接入。
- [ ] OpenCode 标记为 `native`；Claude、Codex 标记为 `adapter`。
- [ ] daemon 中没有按厂商解析私有 stdout 的逻辑。
- [ ] Catalog 是 launcher、版本和验证能力的唯一事实源。

## 行为

- [ ] 三种运行时均能创建会话并流式返回文本。
- [ ] 支持时可恢复会话；不支持时返回明确能力错误或受控降级。
- [ ] tool call、tool result、thinking、plan、done 与 error 可持久化和展示。
- [ ] cancel 能中止执行并回收连接及子进程。
- [ ] permission 支持允许、拒绝和需要确认，不存在默认静默全授权。
- [ ] 认证失败、适配器缺失、协议不兼容和异常退出都有可定位错误。

## 验证与文档

- [ ] mock ACP 集成测试通过。
- [ ] OpenCode 真实 smoke test 通过。
- [ ] Claude 真实 smoke test 通过。
- [ ] Codex 真实 smoke test 通过。
- [ ] 相关单元测试、集成测试、类型检查和构建通过。
- [ ] `architecture/cli-integration.md` 与 `docs/wiki/04-backend-daemon.md` 已同步。
- [ ] 所有 legacy backend 和迁移旗标已删除。

