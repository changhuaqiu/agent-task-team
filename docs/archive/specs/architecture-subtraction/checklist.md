# Acceptance Checklist

- [x] 清理前的所有保留 worktree 均已恢复为 clean；本轮变更只存在于专属 worktree。
- [x] Git 不再跟踪任意 `node_modules` 或 `dist` 文件。
- [x] `pnpm install --offline --frozen-lockfile` 可恢复依赖。
- [x] MCP 子包可重新生成 `dist`。
- [x] 删除的代码没有生产引用或残留当前文档引用。
- [x] 类型检查、针对性测试和生产构建通过；全量测试 1496/1498 通过，1 条历史失败稳定复现，1 条超时重跑通过。
- [x] 已注销 worktree 的 Git 注册和已合入分支已删除；Windows 锁定/超长路径导致的纯磁盘残留已在技术文档登记。
