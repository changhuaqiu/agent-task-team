# Architecture Subtraction — Round 52

> Status: active
> Date: 2026-08-15

## Goal

收窄 A2A、ACP、自主交付与角色卡安全扫描的假公共面：把仅在定义文件内部使用的 42 个类型改为模块私有类型，并把只有一个实现、一个调用方的 `SecurityScanner` 接口与 singleton wrapper 压成直接扫描函数。正式运行端口、持久化、事件、权限与安全规则保持不变。

## Evidence

- 全仓符号调用图确认 42 个 exported type/interface 只在各自定义文件中出现，没有生产、测试、脚本、barrel、动态索引或序列化消费者。
- A2A 的 Collaboration/Command Guard/Human Command、ACP backend/setup/permission/MCP 与 Autonomous Delivery 的正式 class/function/port 仍有真实跨模块消费者，不在删除范围。
- `SecurityScanner` 只有 `securityScanner` 一个实现，`securityScanner.scan()` 只有 `role-card-import.ts` 一个生产调用方；接口对象没有 adapter、状态、远程边界或替换点。
- 角色卡导入的 prompt injection、credential/JWT/SSH、危险命令和异常内容规则均可由直接函数原样表达。

## Contract

1. 仅移除无外部消费者的 named type exports；模块内部结构类型、返回值和运行时对象形状不变。
2. 保留正式 injected ports 与多实现/测试 adapter，不因同轮收窄而删除真实扩展边界。
3. 删除 `SecurityScanner` interface 与 `securityScanner` singleton；角色卡导入直接调用 `scanRoleCardContent(content)`。
4. 安全扫描的 pattern、warning、critical、passed 语义和导入失败处理保持不变。
5. 架构守卫锁定 42 个实现类型不重新导出，并阻止旧 scanner interface/object 回流。

## Exit Criteria

- 42 个实现专用类型不再出现在所属模块的 public export surface。
- 旧 `SecurityScanner` 与 `securityScanner.scan` 在生产源码中为零。
- 安全扫描行为测试、A2A/ACP/Autonomous Delivery 定向测试、tsc、build、全量测试与独立复审完成并记录。

## Verification

- `pnpm install --offline --frozen-lockfile` 通过，安装 719 个冻结依赖包。
- 实现前定向回归执行 20 files / 148 tests：19 files / 147 tests 通过；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 实现后完整影响面定向执行 21 files / 156 tests：20 files / 155 tests 通过；同一稳定基线失败原样复现。排除该稳定失败文件后，20 files / 154 tests 全部通过。
- 新增 `security-scanner.test.ts`，真实验证普通内容放行、API key/JWT/SSH/危险命令阻断，以及超长/重复字符告警。
- `pnpm exec tsc --noEmit` 通过。
- `pnpm build` 通过；仅保留既有 whole-project NFT tracing warning。
- 非并行全量测试执行完成：206 files / 1519 tests 通过，2 files / 2 tests 跳过；唯一失败仍为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`，该文件生产代码不在本轮 diff。
- 独立复审待执行。
