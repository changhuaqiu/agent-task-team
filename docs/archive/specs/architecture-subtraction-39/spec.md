# Architecture Subtraction — Round 39

> Status: implemented
> Date: 2026-08-15

## Goal

收窄 Task Graph repository 的公开 interface：删除只被 repository 自身调用一次的 `getEdgeById`、`getArtifactById`、`getBindingById` 与 `listBindings`，让写入方法直接返回其持久化结果，聚合读取只通过 `getGraph()` 暴露 bindings；同时删除 `TaskGraphCommitRow` → `TaskGraphCommitRecord` 的同文件重命名层。

## Evidence

- 全仓生产、测试、脚本与当前文档均没有 repository 外部调用四个 lookup 方法。
- 三个 `get*ById` 只在对应 `addEdge`、`addArtifact`、`bindMessage` 的末尾调用一次；没有第二个 adapter、校验或错误归一化。
- `listBindings` 只被同一对象的 `getGraph()` 调用；正式读模型是 `TaskGraphView`，不是独立 binding 列表 interface。
- `TaskGraphCommitRow` 与导出的 `TaskGraphCommitRecord` 逐字等价；`getCommitByIdempotencyKey` 是真实命令幂等恢复入口，必须保留。

## Contract

1. Task Graph repository 保留真实调用方需要的 commit/mutate/action/edge/artifact/binding 写入、领域查询与 `getGraph()` 聚合读取。
2. `addEdge`、`addArtifact` 与 `bindMessage` 的返回字段、持久化顺序和错误行为不变。
3. `getGraph()` 的 bindings 内容与排序保持 `created_at ASC, id ASC`。
4. `getCommitByIdempotencyKey` 继续返回公开 `TaskGraphCommitRecord`；只删除内部同义类型名。
5. 不改变 schema、migration、Task Graph API、浏览器 projection、幂等摘要、revision 或 Task Authority 规则。

## Exit Criteria

- 四个自用 lookup 方法不再属于 `taskGraphRepo` interface，且全仓无调用残留。
- commit row 只保留一个公开类型名。
- repository、command service、group-chat flow、engineering collaboration 与架构守卫测试通过。
- 冻结安装、TypeScript、构建、全量测试和独立复审完成并精确记录。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过，719 packages，lockfile 未变。
- 基线定向命令（Task Graph repository、command service、group-chat flow、engineering collaboration、architecture guard）：5 files / 61 tests 通过。
- 实现后同一定向命令：5 files / 62 tests 通过；新增防回流守卫。
- `pnpm exec tsc --noEmit`：通过。
- `pnpm build`：通过；保留既有 Next.js NFT tracing warning。
- `pnpm test -- --run --reporter=dot`：执行完成；205 files / 1519 tests 通过，2 files / 2 tests skipped，1 file / 1 test failed。唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`；不将全量 suite 误记为全绿。
- 独立复审：Critical 0 / Important 0 / Minor 0，Ready: Yes；复审方独立重跑定向命令，5 files / 62 tests 通过，并确认工作树与 base→HEAD `git diff --check` 干净。
