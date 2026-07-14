# Platform Harness Loop Checklist

## 架构

- [x] 浏览器不是 Task Wakeup/A2A 续接的唯一执行者。
- [x] Coordinator 不依赖具体 ACP 或 CLI 实现。
- [x] Runtime Port 不决定 Task 业务状态。
- [x] 现有 repository、gateway 和 AgentEvent 被复用，没有平行事实源。

## 行为

- [x] `owner_ready` 无浏览器也能派发。
- [x] duplicate trigger 被幂等拦截。
- [x] busy 返回 deferred，不丢失、不重复执行。
- [x] runtime/profile/context 错误均有稳定 reason code。
- [x] runtime success 不自动推进 Task gate。
- [x] A2A pass 可提交同一 Coordinator。

## 兼容

- [x] `terminal:start` 仍可工作。
- [x] 无服务端 profile 时可显式回退浏览器兼容路径。
- [x] legacy backend 与 ACP 分支都只需实现 Runtime Port。
- [x] 客户端收到 `handledByHarness` 时不会双派发。

## 验证

- [x] Coordinator 单元测试通过。
- [x] Wakeup/A2A 集成测试通过。
- [x] 现有 control-plane、task-flow、session 测试通过。
- [x] TypeScript 检查通过。
- [x] Next.js production build 通过。
