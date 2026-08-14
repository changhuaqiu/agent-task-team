# Architecture Subtraction — Round 9

> Status: implemented
> Date: 2026-08-15

## Goal

删除没有消费者的平行 Drizzle schema/tooling 层，使数据库事实只由 `better-sqlite3`、`migrate.ts` 与 repositories 维护；同时删除 Chokidar 自带类型后遗留的旧类型包。

## Evidence

- `src/server/db/schema.ts` 共 1436 行，但全仓没有 import、运行入口、生成脚本或测试消费者。
- 真实建库和升级由 `src/server/db/migrate.ts` 执行，repositories 直接使用 `better-sqlite3`。
- `drizzle-kit` 没有配置文件、package script、CI 或文档化命令入口。
- `drizzle-orm` 仅被孤立的 `schema.ts` 引用。
- Chokidar 5 自带 TypeScript 声明，`@types/chokidar` 没有消费者。

## Contract

1. 删除孤立 `src/server/db/schema.ts`。
2. 删除 `drizzle-orm`、`drizzle-kit` 与 `@types/chokidar`。
3. 长期文档和活动规格只把 `migrate.ts` 视为数据库 schema/migration 事实源。
4. 不改变数据库文件、迁移序列、repository 查询或文件监听行为。

## Exit Criteria

- 全仓无 Drizzle 运行/工具依赖和当前事实引用。
- frozen install、TypeScript、数据库/监听定向测试、全量测试与生产构建完成。
- 独立复审无 Critical/Important。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit`：通过。
- 数据库/repository/文件监听定向测试：99/99 通过。
- `pnpm build`：通过。
- 全量测试：1471 通过、2 跳过、1 个与基线一致的既有 `control-runtime` 人工恢复用例失败。
- 独立复审：Critical 0、Important 0、Minor 0，Ready。
