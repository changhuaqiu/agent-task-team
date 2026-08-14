# Architecture Subtraction — Round 8

> Status: implemented
> Date: 2026-08-15

## Goal

将仓库包管理事实收敛到 pnpm，删除陈旧 npm lockfile 与重复直接依赖，并把纯类型包归位到开发依赖。

## Evidence

- `packageManager`、README、setup、workspace 与冻结安装门禁均使用 pnpm。
- 根 `package-lock.json` 自 2026-07-18 后未更新，仍声明第五轮已删除的 `express`，与当前 manifest 和 `pnpm-lock.yaml` 冲突。
- `highlight.js` 在源码、配置、脚本中没有直接引用；语法高亮通过 `rehype-highlight → lowlight → highlight.js` 传递获得。
- `@types/cross-spawn` 仅提供 TypeScript 编译类型，不属于生产运行依赖。

## Contract

1. 删除根 `package-lock.json`，仅保留 `pnpm-lock.yaml` 作为安装事实源。
2. 删除 `highlight.js` 直接依赖，保留 `rehype-highlight` 传递能力。
3. 将 `@types/cross-spawn` 从 dependencies 移到 devDependencies。
4. 同步运行手册与架构减法决策，不改变 Markdown 高亮或 ACP spawn 行为。

## Exit Criteria

- manifest、pnpm lockfile 和文档只声明一个包管理事实源。
- frozen pnpm install、类型、Markdown/ACP 相关测试、全量测试和生产构建完成。
- 独立复审无 Critical/Important。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit`：通过。
- ACP/CLI 定向测试：32/32 通过。
- `pnpm build`：通过。
- 全量测试：1471 通过、2 跳过、1 个与基线一致的既有 `control-runtime` 人工恢复用例失败。
- 独立复审：Critical 0、Important 0、Minor 0，Ready to merge。
