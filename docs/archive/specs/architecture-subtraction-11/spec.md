# Architecture Subtraction — Round 11

> Status: implemented
> Date: 2026-08-15

## Goal

删除独立配置中心及其只在前端自循环的 Provider Profile、Channel、Routing Policy 假控制面，让设置抽屉成为账号、角色素材、技能和团队套件的唯一用户入口。

## Evidence

- `/settings/integrations` 重复展示设置抽屉已经拥有的账号、角色、技能、团队套件信息。
- `ProviderProfile`、`ChannelConfig`、`RoutingPolicy` 只被独立页面、页面测试和 Zustand localStorage 使用；daemon、dispatch、ACP 和项目运行时零读取。
- 页面把这些对象标为“已接入”，同时明确写着“下一阶段应把这些策略接入所有执行入口”。
- `terminal:start` 仍保留同层的 provider、channel、auth context 与账号候选数组字段，但 daemon 不读取它们。
- 项目 UX 规则禁止在主界面暴露 runtime、channel、routing 等实现概念，也禁止重复配置选择。

## Contract

1. 删除 `/settings/integrations` 页面、展示 Module 与专属测试。
2. 删除 `integrationConfig.ts` 及 TaskHub store 中三类假配置状态、更新函数和默认值。
3. store 持久化版本升级并清除旧 localStorage 中的僵尸键。
4. 删除 `terminal:start` 中无消费者的 provider、channel、auth context 与账号候选数组字段，只保留真实执行参数。
5. 设置抽屉保留账号、角色素材、技能、团队套件四个真实入口，不再链接第二套页面。
6. 同步配置设计与前端当前事实文档。

## Exit Criteria

- 全仓无 Provider Profile、Channel Config、Routing Policy 的运行状态或 UI。
- `terminal:start` 不再收发同层无消费者字段。
- 构建路由不再包含 `/settings/integrations`。
- 冻结安装、类型、store/settings 定向测试、全量测试和生产构建完成。
- 独立复审无 Critical/Important。

## Verification

- `pnpm install --offline --frozen-lockfile`：通过。
- `pnpm exec tsc --noEmit`：通过。
- store、团队、聊天与两条 `terminal:start` 发送路径定向测试：51/51 通过。
- `pnpm build`：通过，静态页面为 6 个，路由清单不再包含 `/settings/integrations`。
- `pnpm test`：1470 通过、2 跳过、1 个既有基线失败；唯一失败为 `src/server/autonomous-delivery/control-runtime.test.ts:131`，与本轮无关。
- 独立复审：Critical 0、Important 0；协议字段、迁移、唯一设置入口与文档事实均已复核。
