# Acceptance Checklist

- [ ] `taskGraphRepo` 不再公开四个仅供自身使用的 lookup 方法。
- [ ] 三个写入方法的返回值与错误语义保持不变。
- [ ] `getGraph()` 的 bindings 聚合与排序保持不变。
- [ ] `getCommitByIdempotencyKey` 与幂等恢复保持，commit row 只有一个类型名。
- [ ] schema、migration、API、revision 与 Task Authority 规则未改变。
- [ ] 架构守卫阻止被删方法和同义类型回流。
- [ ] 文档、TypeScript、定向测试、构建与全量结果精确记录。
- [ ] 独立复审为 Critical 0 / Important 0。
