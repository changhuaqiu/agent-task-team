# Acceptance Checklist

- [x] Message repository 三个死读方法删除。
- [x] Observation/Payload/Proof 三个自用读方法删除。
- [x] Payload put 返回的 redaction/truncation/size 行与持久化结果一致。
- [x] Proof append 返回 row 并继续投影 Team Log。
- [x] Message conversation/history/context 正式读取保持。
- [x] Observation conversation projection 与 scoped payload list 保持。
- [x] Proof envelope/conversation/domain-key 查询保持。
- [x] 架构守卫阻止六个旧 interface 回流。
- [x] 文档、类型、定向、build 与全量结果精确记录。
- [ ] 独立复审为 Critical 0 / Important 0。
