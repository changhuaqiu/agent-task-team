# Acceptance Checklist

- [ ] Message repository 三个死读方法删除。
- [ ] Observation/Payload/Proof 三个自用读方法删除。
- [ ] Payload put 返回的 redaction/truncation/size 行与持久化结果一致。
- [ ] Proof append 返回 row 并继续投影 Team Log。
- [ ] Message conversation/history/context 正式读取保持。
- [ ] Observation conversation projection 与 scoped payload list 保持。
- [ ] Proof envelope/conversation/domain-key 查询保持。
- [ ] 架构守卫阻止六个旧 interface 回流。
- [ ] 文档、类型、定向、build 与全量结果精确记录。
- [ ] 独立复审为 Critical 0 / Important 0。
