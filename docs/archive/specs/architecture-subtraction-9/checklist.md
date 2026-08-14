# Acceptance Checklist

- [x] `src/server/db/schema.ts` 已删除，`migrate.ts` 是唯一 schema/migration 事实源。
- [x] `drizzle-orm`、`drizzle-kit`、`@types/chokidar` 已从 manifest 和 lockfile 删除。
- [x] 数据库迁移/repository 与文件监听测试通过。
- [x] frozen install、TypeScript、全量测试和生产构建已记录。
- [x] 独立复审无 Critical/Important。
