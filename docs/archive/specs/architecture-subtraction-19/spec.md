# Architecture Subtraction — Round 19

> Status: implemented
> Date: 2026-08-15

## Goal

收敛 phase 持久化的公开 interface：保留 `/api/phases` 作为阶段读取与写入的唯一 Pages API，删除 `/api/mutations` 中重复的 `phase.upsert` / `phase.delete` 分支，让 phase 数据只有一个 transport owner。

## Evidence

- `/api/phases` 已同时实现 GET、POST、DELETE，并直接调用 `phaseQueries`。
- WebUI 的唯一 phase 写入调用方 `taskStore` 仍绕到通用 `/api/mutations`；`/api/phases` 的 POST/DELETE 没有生产消费者。
- `/api/phases` GET 仍被启动水合使用：`/api/state` 不返回 phases，因此该 route 不能整体删除。
- `phase.upsert` / `phase.delete` 除 `taskStore` 与 mutation handler 外没有其他生产消费者，也没有独有领域规则。
- 消息读取与写入当前没有重复公开写入口，不属于本轮范围。

## Contract

1. `/api/phases` 是 phase CRUD 的唯一公开 interface，继续复用 `phaseQueries` 持久化实现。
2. `taskStore.upsertPhase()` 直接 POST `/api/phases`；`removePhase()` 直接 DELETE `/api/phases?id=...`。
3. `/api/mutations` 不再声明或接受 `phase.upsert` / `phase.delete`。
4. 不改变 phase 本地 optimistic 更新、数据库结构或 `Phase` 数据模型。
5. 用 route 行为测试保护 GET/POST/DELETE，用 mutation 负向测试防止旧动作回流。

## Exit Criteria

- 生产代码中无 `phase.upsert` / `phase.delete` mutation 调用或 handler case。
- `/api/phases` GET/POST/DELETE 行为与错误路径有自动化覆盖。
- 当前架构文档明确 phase 独立 route 的所有权，mutation 命令数从 14 收敛到 12。
- 冻结安装、TypeScript、定向测试、构建、全量测试与独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- 定向测试：5 files / 75 tests 通过，覆盖 store 写入、Phase route + SQLite、旧 mutation 拒绝、phaseQueries 与架构防回流。
- `pnpm run build`：通过；仅保留既有 Turbopack 动态路径追踪 warning。
- `pnpm test`：200 files / 1507 tests 通过，2 files / 2 tests 跳过；唯一失败为基线稳定复现的 `src/server/autonomous-delivery/control-runtime.test.ts:131` human-resume fixture，与本轮无关。
- 独立复审：Critical 0 / Important 0 / Minor 0，Ready Yes。
