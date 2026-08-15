# Acceptance Checklist

- [x] `account-auth.ts` 是账号可执行候选字段与 readiness 的唯一 owner。
- [x] Team Runtime Profile resolver 只额外要求账号 `id`，不复制字段集合。
- [x] `RuntimeAccountProvider` 与 `RuntimeAccountInput` 生产残留为零。
- [x] 浏览器 Store、Invocation Pipeline 与 Evaluation Snapshot 的账号选择行为不变。
- [x] 历史 engine 迁移、runtime selection、daemon 执行复核与凭据边界未改变。
- [x] 架构守卫阻止重复别名和输入 interface 回流。
- [ ] 文档、TypeScript、定向测试、构建与全量结果精确记录。
- [ ] 独立复审为 Critical 0 / Important 0。
