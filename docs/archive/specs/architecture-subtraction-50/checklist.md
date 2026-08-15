# Acceptance Checklist

- [x] ACP mock importable/spawnable 测试能力保持，正式 `AcpBackend` 行为不变。
- [x] GitHub Issue route/compiler/ingress fixture 统一从 test-helper 使用。
- [x] `src/server` 不再承载零生产入边的测试 double/fixture。
- [x] Daemon Store buffer、TokenBadge、Context contributor 行为保持。
- [x] Inbox/runtime event/default/limit/digest 行为保持。
- [x] Autonomous Delivery、Execution Envelope 与 Git verifier reason code/错误传播保持。
- [x] 二十三个同文件-only 符号不再属于公共 interface。
- [x] 架构守卫阻止测试 fixture 与内部 export 回流。
- [x] 文档、类型、定向、build 与全量结果记录。
- [x] 独立复审无 Critical / Important。
