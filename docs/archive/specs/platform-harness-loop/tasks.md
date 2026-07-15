# Platform Harness Loop Tasks

## P1 契约与服务端上下文

- [x] 定义 Harness trigger/plan/outcome/runtime port。
- [x] 实现 conversation runtime/profile resolver。
- [x] 实现 repository-backed ContextManager providers。
- [x] 为配置缺失和上下文失败定义 reason code。

## P2 Coordinator

- [x] 实现幂等、busy 判断、plan 构建和 Runtime Port 调用。
- [x] 记录 proof 和 compatibility fallback。
- [x] 增加纯单元测试。

## P3 daemon 接入

- [x] 将现有 terminal execution 暴露为 Runtime Port。
- [x] 保留 `terminal:start` 兼容入口。
- [x] Task Wakeup 和 Autonomy Guard 优先提交 Coordinator。
- [x] A2A dispatch 接入 Coordinator 回调。

## P4 验证与收敛

- [x] 新增无浏览器 wakeup 集成测试。
- [x] 新增幂等、busy、fallback、A2A 测试。
- [x] 保留浏览器兼容测试。
- [x] 更新长期技术文档和目标架构图。
- [x] 运行定向测试、全量测试、类型检查和 build。
