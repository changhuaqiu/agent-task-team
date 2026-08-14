# Architecture Subtraction — Round 16

> Status: implemented
> Date: 2026-08-15

## Goal

删除未进入任何生产组装链、只由自身测试证明存在的 `scopeGuard` 兼容模块，把项目作用域与可见性事实收口到当前真正执行的 `ContextManager` intake 和 Context Registry。

## Evidence

- `scopeGuard()`、`hasScopeViolation()`、`legacyScopeGuard()` 与 `assertVisibility()` 的生产调用数均为 0，只有 `scopeGuard.test.ts` 直接测试这些接口。
- `scopeGuard.ts` 唯一生产消费者是 `historyLayer.ts` 对六行 `filterByProjectId()` 包装的调用；该包装等价于一行数组过滤。
- `ContextRecord/filterVisible` 也只有同名测试消费者；这是被 Context Artifact/Registry 取代后残留的第二套可见性模型。
- 当前 `ContextManager` 已在 intake 对 project/message/task 做 fail-closed 校验，Context Registry 再按 project/global scope 与 agent/role/team visibility 机械过滤。
- 活动 `context-manager` 规格和长期文档仍把未接线的 `scopeGuard` 描述为当前保护层，造成“测试绿但生产没有经过该接口”的假能力。

## Contract

1. 生产作用域 owner 只保留两层：`ContextManager` intake 拒绝错项目/无项目输入；Context Registry 归一化并过滤 scope/visibility。
2. history layer 只保留其本地、可见的 conversation 过滤，不再依赖单函数兼容模块。
3. 删除 `scopeGuard.ts`、旧 `contextRecord.ts` 与只验证这些无消费者接口的测试。
4. 活动 `context-manager` 规格、当前技术文档与架构图必须描述真实 owner，不再声称 `scopeGuard` 已接线。
5. ContextManager、Context Registry、history/task layer 的现有跨项目和可见性行为必须保持并由其真实接口测试覆盖。

## Exit Criteria

- 全仓无 `scopeGuard` / `legacyScopeGuard` / `assertVisibility` / `filterByProjectId` / `filterVisible` 生产符号。
- ContextManager intake 与 Context Registry 的项目/可见性测试通过。
- 当前事实文档和活动规格只指向真实生产链。
- 冻结安装、类型、定向测试、构建、全量测试与独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit`：通过。
- 定向测试：4 files / 59 tests 通过，覆盖 ContextManager intake、Registry、history 与 context planner 真实接口。
- `pnpm run build`：通过（仅保留既有 Turbopack 动态路径追踪 warning）。
- `pnpm test`：1504 passed / 2 skipped / 1 failed；唯一失败为基线同样复现的 `src/server/autonomous-delivery/control-runtime.test.ts:131` human-resume fixture，和本轮无关。
- 独立复审：Critical 0 / Important 0；指出的两处架构图旧命名已修正。
