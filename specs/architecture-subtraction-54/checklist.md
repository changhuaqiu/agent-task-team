# Checklist

- [ ] `refreshContextFiles` 与两个无消费者 sidecar 文件名零生产残留。
- [ ] `activeDirs` 假状态零生产残留。
- [ ] `resolveProjectWorkdir` 只作为 private implementation。
- [ ] 路径编码测试穿过 `resolveWorkdir` 正式 interface。
- [ ] Workdir metadata 与 GC 行为保持。
- [ ] Worktree create/list/remove/migration 与外部 repository 行为保持。
- [ ] 内部 DTO/helper/constant 不在 public export surface。
- [ ] 定向、tsc、build 与全量验证已记录。
- [ ] 独立复审无 Critical / Important。
