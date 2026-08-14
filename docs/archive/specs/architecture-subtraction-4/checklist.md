# Acceptance Checklist

- [x] `opencodeBridgeUrl` 不再存在于运行代码，Socket `runtime:hello` 会拒绝 `bridge` 和未知 kind。
- [x] `bridge/` 与 `scripts/opencode-bridge-*` 不再存在。
- [x] package scripts 不再暴露 Bridge commands。
- [x] Next 路由表不再出现 `/api/opencode/status` 与 `/api/opencode/bridge/status`。
- [x] migration 76 删除旧 Bridge node/binding，同时保留 Remote node/binding。
- [x] OpenCode ACP 运行时、账号配置与 runtime probe 未受影响；相关套件 50/50 通过。
- [x] TypeScript 通过；影响面 69/69 通过；全量 1471/1474 通过，唯一失败为既有 `control-runtime` human-resume，另 2 项 skipped；生产构建通过。
- [x] 独立复审无 Critical/Important，结论 Ready。
