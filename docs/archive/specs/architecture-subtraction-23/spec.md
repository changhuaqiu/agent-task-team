# Architecture Subtraction — Round 23

> Status: implemented
> Date: 2026-08-15

## Goal

删除 ContextManager 内部的 Legacy Tier Adapter 与 BudgetGuard 的 P0–P4 `priority` 兼容，让现有 Tier 内容直接以原生 `ContextFragment` 进入 Registry，并让 `ContextArtifact.delivery` 成为预算选择的唯一元数据事实源。

## Evidence

- `renderAllTiers()` 先生成带 `tier/importance/scope/private/source` 的 `ContextAssemblyPart`，`ContextManager.legacyPartToFragment()` 再把它包装为 `legacy.*` Fragment。
- Registry 把这些临时 Fragment 归一化为 Artifact 后，ContextManager 又通过 `legacyPartByFragmentId` 恢复成原来的 BudgetPart；这条往返不增加过滤、权限或内容能力。
- `context-registry.ts` 为临时 `legacy.*` kind 维护专属 lifecycle、source owner、consistency 与 skill 分支，形成第二套身份映射。
- `BudgetPart.priority`、`ContextReport.layers.priority` 只剩兼容声明与自测，没有生产消费者；正式选择已经使用 `tier + importance + required`。
- `SkillSummary.files` 被 Context Planner 填充，但 ContextManager 的 Skill layer 与工具提取都不读取它。

## Contract

1. 四个 Tier renderer 继续负责内容拼装，但 `renderAllTiers()` 直接产出结构化 `ContextFragment[]`；ContextManager 不再拥有 legacy 包装或反包装逻辑。
2. 现有内容、渲染顺序、scenario cluster、省略规则、required 语义、scope/visibility 与预算相对顺序保持不变。
3. 原生 Fragment 使用稳定的 id/kind/producer；Registry 根据原生 kind 生成 lifecycle、consistency、delivery channel 与 importance，`source.owner` 直接来自可信 producer。
   内建 seed id 为保留身份，注册 Contributor 不得覆盖用户输入、A2A 或 bootstrap；复合 bootstrap 使用诚实的 `context-bootstrap` owner。
4. BudgetGuard 只接受必填 `tier` 与 `importance`；删除 `priority` 推导、默认 importance 以及无消费者的 `p0Intact` 报告兼容字段。
5. 外部 `ContextContributor` interface、`assembleContext()` 深模块入口、Snapshot manifest 和 runtime transport 不变。
6. 删除未消费的 `SkillSummary.files` 及 Context Planner 映射，不影响 Skill 正文、resource refs 或工具目录。

## Exit Criteria

- 生产代码无 `LegacyTierContributor`、`legacyPartToFragment`、`ContextAssemblyPart`、`legacy-tier-adapter`、`legacy-assembly-v1` 或 `legacy.*` context kind。
- BudgetPart 与 ContextReport 不再声明或输出 `priority/p0Intact`。
- SkillSummary 不再携带未消费的 `files`。
- 架构测试锁定 Tier 只产出原生 Fragment、BudgetGuard 无旧优先级入口。
- 当前事实文档只描述 Fragment → Registry → Artifact → Budget 的单向管线。
- 冻结安装、TypeScript、定向测试、构建、全量测试和独立复审完成。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit --pretty false`：通过。
- 定向回归：21 files / 171 tests 通过；最终聚焦复跑 2 files / 40 tests 通过。
- `pnpm build`：通过；仅保留既有 Next.js NFT tracing warning。
- 全量：204 files / 1514 tests 通过，2 files / 2 tests 跳过；唯一失败为稳定基线 `src/server/autonomous-delivery/control-runtime.test.ts:131`。
- 独立复审先发现 2 Important / 1 Minor；修复 seed id 覆盖、bootstrap lineage 与文档后最终 Critical 0 / Important 0 / Minor 0，Ready Yes。
