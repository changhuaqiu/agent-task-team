# Architecture Subtraction — Round 55

> Status: active
> Date: 2026-08-15

## Goal

删除只写不读的 `.session.json` 文件旁路，让 ACP 会话身份、恢复与封存只由 SQLite `sessionRepo` 拥有；同时收窄 GC sidecar，只保留垃圾回收真正消费的完成时间。

## Evidence

- `WorkdirManager.writeSessionMeta()` 只有 daemon 一个生产调用方；`readSessionMeta()` 没有任何生产调用方，只有直接自测。
- `.session.json` 没有 watcher、迁移、启动恢复、State API 或 runtime reader；写入结果不参与任何后续决策。
- daemon、State API、Runtime Message Projection 与浏览器投影已经统一消费 `sessionRepo` 的逻辑会话、runtime session id、profile、message count 与 sealed 状态。
- `.gc_meta.json` 被 `WorkdirManager.gc()` 真实读取；其中只有 `completedAt` 参与 TTL 判断，冗余 `taskId` 从文件路径已经可得且从未读取。
- 修改前定向基线：3 files / 108 tests 通过。

## Contract

1. 会话身份、恢复、runtime id 确认、失败封存与消息计数的唯一持久化 owner 是 `sessionRepo`。
2. WorkdirManager 不写、不读 `.session.json`，也不暴露 SessionMeta 文件 DTO。
3. daemon 观察 runtime session 后继续发布实时事件，并按既有成功边界确认数据库 session；不得再增加可在 turn 完成后失败的同步文件写入。
4. `.gc_meta.json` 仍由 WorkdirManager 拥有，只保存 GC 真正需要的 `completedAt`；历史文件多出的 `taskId` 可被宽松 JSON 读取，无需迁移。
5. 架构守卫扫描生产 TS/TSX，阻止 `.session.json`、`writeSessionMeta`、`readSessionMeta` 与 `SessionMeta` 回流。

## Exit Criteria

- 生产源码中不存在 `.session.json`、`writeSessionMeta`、`readSessionMeta` 或 `SessionMeta`。
- sessionRepo 的创建、绑定、确认、恢复、封存与投影测试保持通过。
- GC sidecar 创建、TTL 删除与保留行为保持通过，文件不再写入冗余 taskId。
- 活动 ACP 规格、daemon/wiki、运行目录说明与长期架构减法文档同步。
- 定向测试、TypeScript、build、全量测试与独立复审完成并记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：719 packages。
- 修改前定向：3 files / 108 tests 通过。
- 其余待实现后回填。
