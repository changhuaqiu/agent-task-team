# Acceptance Checklist

- [ ] 零消费者 `getContract` 删除。
- [ ] `getContractRow` 仅为 private helper。
- [ ] `listActiveAuthoritiesForTask` 仅为 private helper。
- [ ] issue/idempotency 与 authority epoch fencing 保持。
- [ ] close/task lifecycle 与 Outcome admission 保持。
- [ ] permission policy 与 dispatch contract 保持。
- [ ] 架构守卫阻止公共 interface 回流。
- [ ] 文档、类型、定向、build 与全量结果记录。
- [ ] 独立复审为 Critical 0 / Important 0。
