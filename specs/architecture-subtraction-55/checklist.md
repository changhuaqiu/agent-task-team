# Checklist

- [ ] `.session.json` 与对应读写 interface 零生产残留。
- [ ] sessionRepo 仍是 session lifecycle 唯一持久化 owner。
- [ ] daemon runtime session 实时事件与数据库确认边界保持。
- [ ] `.gc_meta.json` 只保存并消费 `completedAt`。
- [ ] 历史 GC metadata 无需迁移且仍可读取。
- [ ] 架构守卫阻止 filesystem session metadata 回流。
- [ ] 当前事实文档不再宣称 `.session.json` 承担续接。
- [ ] 定向、tsc、build 与全量验证已记录。
- [ ] 独立复审无 Critical / Important。
