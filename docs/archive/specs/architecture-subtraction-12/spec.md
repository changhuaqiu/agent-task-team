# Architecture Subtraction — Round 12

> Status: implemented
> Date: 2026-08-15

## Goal

删除浏览器 store 中没有真实入口或服务端消费者的 runtime catalog / Mock Runner 兼容层，让运行时可用性只来自 daemon 推送，正式执行只走 ACP Catalog。

## Evidence

- `refreshRuntimeCatalog()` 是空实现，唯一调用不会产生状态或副作用。
- `getAvailableRuntime()` 没有任何调用方。
- `setEnableMockRunner()` 没有 UI、API 或脚本入口；`enableMockRunner` 只会从旧 localStorage 恢复。
- 两条 `terminal:start` 命令发送 `allowMockRunner`，但 daemon payload 类型与 handler 均不读取它。
- 正式 ACP Catalog 只支持 OpenCode、Claude、Codex；mock 仅作为自动化测试 adapter，不是产品 runtime。

## Contract

1. 删除空的 `refreshRuntimeCatalog()`、无消费者的 `getAvailableRuntime()` 及其唯一空调用。
2. 删除 `enableMockRunner` / `setEnableMockRunner` 状态和 TaskDetailPanel 的 mock 可用性旁路。
3. 删除两条 `terminal:start` 中无人消费的 `allowMockRunner` 字段。
4. 删除生产 `CliEngine`、runtime map 与 invocation planner 中指向已删除脚本的 mock runtime 身份。
5. store 持久化升级到 v8，并清除旧 `enableMockRunner` 键。
6. 保留测试内部的 mock ACP agent 与正式 `daemonRuntimes` 推送链路；通用 fixture 改用受支持 engine。
7. 同步 store、daemon 与架构减法当前事实文档。

## Exit Criteria

- 生产代码无前端 runtime catalog / Mock Runner 状态或协议旁路。
- 生产 engine / runtime 类型不再声明不可执行的 mock runtime。
- 真实运行时按钮只由 daemon 推送的可用性决定。
- v7 持久化数据升级后不再保留 `enableMockRunner`。
- 冻结安装、类型、定向测试、全量测试和生产构建完成。
- 独立复审无 Critical/Important。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit`：通过。
- store、terminal payload、账号绑定、Invocation fixture、团队与聊天定向测试：69/69 通过。
- `pnpm build`：通过，正式路由保持不变。
- `pnpm test`：1471 通过、2 跳过、1 个既有基线失败；唯一失败为 `src/server/autonomous-delivery/control-runtime.test.ts:131`，与本轮无关。
- 独立复审：Critical 0、Important 0；空调用图、持久化迁移、daemon runtime 推送与 ACP 测试 mock 边界均已复核。
