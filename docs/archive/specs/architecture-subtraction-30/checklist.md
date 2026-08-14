# Acceptance Checklist

- [x] `resolveAgentEngine` 与 `providerToEngine` 不存在于生产代码。
- [x] Store 不再重导出 `PROVIDER_TO_ENGINE`。
- [x] TaskDetail 直接消费 `getAgentRuntimeProfile()`，profile 缺失时不猜测 OpenCode。
- [x] canonical account readiness、provider mapping、legacy engine 读取和正式派发保持可达。
- [x] 平行 resolver 自证测试删除，正式 Team Runtime/Store 测试继续覆盖真实 seam。
- [x] 架构守卫阻止恢复第二套浏览器执行资料解析。
- [x] 文档、TypeScript、定向测试与构建通过；全量结果精确记录。
- [x] 独立复审为 Critical 0 / Important 0 / Minor 0。
