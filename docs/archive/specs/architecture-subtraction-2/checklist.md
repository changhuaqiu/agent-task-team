# Acceptance Checklist

- [x] 删除文件不属于 Next.js/CLI/配置/测试 Adapter 隐式入口。
- [x] 核心符号与路径搜索没有当前事实残留。
- [x] `pnpm exec tsc --noEmit --pretty false` 通过。
- [x] 受影响架构测试 9/9 通过。
- [x] `pnpm build` 通过。
- [x] 全量测试 1467/1471 通过；ACP subprocess 超时单独重跑 17/17 通过，唯一稳定失败仍为既有 `control-runtime` human-resume。
- [x] 独立复审无 Critical/Important。
