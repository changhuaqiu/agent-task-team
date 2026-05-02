# 统一集成配置中心 Spec

## Why
当前系统已经具备多 CLI 运行时雏形，但配置能力仍主要围绕 `opencode` 单点展开，导致认证、Provider、渠道与运行时之间缺少统一抽象。需要一套独立的配置中心，把“多运行时 + 多认证 + 多渠道”的能力收拢成一致的信息架构与数据模型。

## What Changes
- 新增独立的“账户与集成配置中心”，统一管理运行时、凭据、Provider Profiles、Channels 与 Routing Policy
- 将现有设置抽屉降级为“系统摘要 + 快速检测 + 进入配置中心入口”
- 建立统一的数据模型：`CliRuntime`、`Credential`、`ProviderProfile`、`ChannelConfig`、`RoutingPolicy`
- 将 `opencode` 从系统中心能力调整为一个可配置 runtime，不再作为唯一特殊执行链路
- 扩展 daemon 启动契约，从只依赖 `engine` 演进为支持 `runtimeId / providerProfileId / channel / authContextId`
- **BREAKING**：新的配置入口将替代“在设置抽屉中直接承载复杂集成配置”的旧交互模式

## Impact
- Affected specs:
  - 系统设置与初始化
  - CLI 执行链路
  - 认证与外部集成
  - 路由策略与默认执行逻辑
- Affected code:
  - `src/components/task-hub/SettingsDrawer.tsx`
  - `src/app/settings/integrations/page.tsx`
  - `src/components/settings/*`
  - `src/store/taskHubStore.ts`
  - `src/server/daemon.ts`
  - `src/pages/api/opencode/status.ts`
  - `src/pages/api/opencode/bridge/status.ts`
  - `src/pages/api/daemon/init.ts`

## ADDED Requirements
### Requirement: 独立配置中心
系统 SHALL 提供一个独立于业务工作台的“账户与集成配置中心”，用于统一管理运行时、认证、Provider 与渠道配置。

#### Scenario: 用户进入配置中心
- **WHEN** 用户从设置入口选择“打开账户与集成配置”
- **THEN** 系统打开一个独立页面或等价的大面板，而不是继续在业务设置抽屉中堆叠复杂配置项

### Requirement: 统一运行时抽象
系统 SHALL 将 CLI 执行能力抽象为可配置 runtime，而不是围绕 `opencode` 写死业务逻辑。

#### Scenario: 查看已登记 runtime
- **WHEN** 用户进入 `CLI Runtimes` 分区
- **THEN** 系统展示各 runtime 的类型、模式、可用性、版本、能力标签与探测结果

#### Scenario: runtime 平级展示
- **WHEN** 系统同时支持 `opencode`、`claude`、`codex`、`mock`
- **THEN** 它们以平级 runtime 展示，而不是将 `opencode` 作为唯一中心入口

### Requirement: 统一认证模型
系统 SHALL 提供统一的认证对象模型，用于承接 API Key、OAuth、CLI Session、Bearer Token、Bridge Secret 等不同认证方式。

#### Scenario: 管理凭据
- **WHEN** 用户进入 `Credentials` 分区
- **THEN** 系统允许新增、查看、编辑、删除本地凭据记录，并显示其状态与适用范围提示

### Requirement: 渠道与 Provider 解耦
系统 SHALL 将 `Channel` 与 `ProviderProfile` 作为独立对象建模，并允许通过路由策略进行绑定。

#### Scenario: 配置渠道默认执行策略
- **WHEN** 用户为某个 channel 指定默认 runtime 和 provider profile
- **THEN** 系统将该绑定保存在 Routing Policy 中，而不是散落在各功能模块的局部配置里

### Requirement: daemon 执行上下文扩展
系统 SHALL 支持在执行链路中携带 runtime / provider / channel / auth 上下文，而不只依赖单一 `engine` 参数。

#### Scenario: 启动 agent 执行
- **WHEN** 前端发起一次新的 agent 执行请求
- **THEN** 请求载荷可包含 `runtimeId`、`providerProfileId`、`channel`、`authContextId` 等上下文标识

## MODIFIED Requirements
### Requirement: 设置抽屉
系统 SHALL 将设置抽屉定位为“系统摘要、快速检测与跳转入口”，而不是复杂配置的主要承载面。

#### Scenario: 用户打开设置抽屉
- **WHEN** 用户点击设置按钮
- **THEN** 抽屉展示 daemon / bridge / mock 等摘要状态、快速检测动作，以及进入配置中心的明确入口
- **AND** 不要求用户在抽屉中完成完整的账户、Provider、渠道与路由配置

### Requirement: OpenCode 集成
系统 SHALL 保留 `OpenCode Local` 与 `OpenCode Bridge` 两种能力，但将其纳入统一 runtime 模型中管理。

#### Scenario: 使用 OpenCode 能力
- **WHEN** 用户启用本地或 bridge 形式的 OpenCode
- **THEN** 系统将其视为可选 runtime，而不是业务流程对 `opencode` 的硬编码依赖

## REMOVED Requirements
### Requirement: 设置抽屉作为主要集成配置面板
**Reason**: 抽屉适合承载状态摘要与快速操作，但不适合承载多 runtime、多认证、多渠道的复杂配置关系。
**Migration**: 将原先位于抽屉中的复杂配置逐步迁移到独立配置中心；抽屉仅保留摘要、检测与入口。

### Requirement: 执行链路仅以 engine 作为唯一运行选择
**Reason**: 单一 `engine` 无法表达 runtime、provider、credential、channel 之间的真实绑定关系。
**Migration**: 在兼容现有 `engine` 的基础上，逐步扩展到 `runtimeId / providerProfileId / channel / authContextId`。
