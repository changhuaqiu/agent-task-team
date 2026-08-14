# Acceptance Checklist

- [x] 空 `refreshRuntimeCatalog()` 与无消费者 `getAvailableRuntime()` 已删除。
- [x] `enableMockRunner` 状态、setter、UI 旁路与持久化已删除。
- [x] `terminal:start` 不再发送 `allowMockRunner`。
- [x] 生产 engine、runtime map 与 planner 不再声明 mock runtime。
- [x] store v8 迁移清除旧 `enableMockRunner` 键。
- [x] daemon runtime 推送与测试 mock adapter 保持不变。
- [x] TypeScript、定向测试、全量测试和生产构建已记录。
- [x] 独立复审无 Critical/Important。
