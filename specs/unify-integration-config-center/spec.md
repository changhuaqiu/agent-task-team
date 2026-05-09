# 统一集成配置中心 Spec

## Why
当前系统已经具备多 CLI 运行时雏形，但配置能力仍主要围绕 `opencode` 单点展开，导致认证、Provider、渠道与运行时之间缺少统一抽象。需要一套独立的配置中心，把“多运行时 + 多认证 + 多渠道”的能力收拢成一致的信息架构与数据模型。

## What Changes
- 在现有设置抽屉中收口“模型账号”和“角色卡”两类配置
- 将账号认证模型统一到 `Account` 对象，支持 `oauth / api_key`
- 扩展 daemon 启动契约，使其可携带 `engine / runtimeId / channel / authContextId / accountId`
- 为后续更完整的配置中心预留方向，但本阶段不承诺完整的独立页面与全量配置对象
- **BREAKING**：配置与执行环境不再围绕单一 `opencode` 写死，账号绑定与执行引擎选择成为当前主路径

## Current Implementation Status

当前实现状态需要与代码事实同步理解：

- **已实现**
  - 设置抽屉已经演进为两个实际分区：`模型账号` 与 `角色卡`
  - 独立配置中心入口已落地：`src/app/settings/integrations/page.tsx`
  - 配置中心展示账号、角色素材、技能、团队套件与执行环境探测结果
  - `ProviderProfile / ChannelConfig / RoutingPolicy` 已作为持久化前端配置对象落地
  - 配置中心支持编辑供应商档案、使用场景渠道和默认聊天 / 执行 / 评审路由策略
  - 账号新增、编辑、删除、验证 API 已落地
  - 角色卡列表、详情、编辑与账号绑定已落地
  - 执行链路已支持 `engine / runtimeId / accountId / authContextId` 等扩展参数通路
  - daemon 已支持 `opencode / claude / codex` 三类主要 backend，并保留 `gemini / mock` 的回退路径
- **部分实现**
  - `runtimeId / channel / authContextId` 已进入 payload 与 daemon，并已有前端配置对象，但还没有强制所有执行入口读取 routing policy
  - 统一运行时目录展示执行环境健康状态，不提供自定义 runtime 安装管理

因此，本 Spec 当前的配置对象与页面层已完成；剩余工作是把 routing policy 更深地接入所有执行入口。

## Impact
- Affected specs:
  - 系统设置与初始化
  - CLI 执行链路
  - 认证与外部集成
  - 路由策略与默认执行逻辑
- Affected code:
  - `src/components/task-hub/SettingsDrawer.tsx`
  - `src/store/taskHubStore.ts`
  - `src/server/daemon.ts`
  - `src/pages/api/accounts/*`
  - `src/pages/api/daemon/init.ts`
  - `src/server/accounts-file.ts`
  - `src/server/credentials.ts`

## ADDED Requirements
### Requirement: 设置抽屉承载账号与角色卡配置
系统 SHALL 在当前设置抽屉中提供“模型账号”和“角色卡”两类配置能力，作为当前已落地的编辑入口。

#### Scenario: 用户打开设置
- **WHEN** 用户点击页面右上角设置按钮
- **THEN** 系统在抽屉中展示“模型账号”和“角色卡”两个分区
- **AND** 用户可以在当前抽屉内完成账号和角色卡的基础管理

### Requirement: 账号模型
系统 SHALL 提供统一的账号对象模型，用于承接 API Key 与 OAuth 两种当前已落地的认证方式。

#### Scenario: 管理模型账号
- **WHEN** 用户进入 `模型账号` 分区
- **THEN** 系统允许新增、查看、编辑、删除并验证账号
- **AND** OAuth 模式只要求账号名称和模型
- **AND** API Key 模式要求 `Base URL`、`API Key` 和模型

### Requirement: 角色卡与账号绑定
系统 SHALL 支持把角色卡与可用账号绑定，使执行时可以按 agent 选择可用账号。

#### Scenario: 角色卡关联账号
- **WHEN** 用户编辑某个角色卡
- **THEN** 系统允许为角色卡绑定一个或多个账号
- **AND** agent 在执行时可从绑定账号中解析可用引擎

### Requirement: daemon 执行上下文扩展
系统 SHALL 支持在执行链路中携带 runtime / provider / channel / auth 上下文，而不只依赖单一 `engine` 参数。

#### Scenario: 启动 agent 执行
- **WHEN** 前端发起一次新的 agent 执行请求
- **THEN** 请求载荷可包含 `runtimeId`、`providerProfileId`、`channel`、`authContextId` 等上下文标识

### Requirement: 独立配置中心状态总览
系统 SHALL 提供 `/settings/integrations` 独立页面，作为配置对象的状态总览与轻量编辑入口。

#### Scenario: 用户打开配置中心
- **WHEN** 用户访问 `/settings/integrations`
- **THEN** 系统展示模型账号、角色素材、技能、团队套件与执行环境状态
- **AND** 页面允许用户编辑供应商档案、使用场景渠道和默认执行策略
- **AND** 账号编辑、角色素材编辑、技能导入和团队套件编辑仍保留在工作台设置抽屉中，避免复制两套编辑流程

### Requirement: 供应商档案、渠道与路由策略
系统 SHALL 提供 `ProviderProfile`、`ChannelConfig` 与 `RoutingPolicy` 三类配置对象，并通过 Zustand persist 持久化。

#### Scenario: 用户配置默认执行路径
- **WHEN** 用户在配置中心修改默认聊天、任务执行或代码评审的执行环境
- **THEN** 对应的 `ChannelConfig` 或 `RoutingPolicy` 会被更新并持久化
- **AND** 页面可引用已存在的模型账号和供应商档案

## MODIFIED Requirements
### Requirement: 设置抽屉
系统 SHALL 将设置抽屉定位为“当前配置入口 + 账号管理 + 角色卡管理”，而不是早期的运行时实验区。

#### Scenario: 用户打开设置抽屉
- **WHEN** 用户点击设置按钮
- **THEN** 抽屉以“模型账号 / 角色卡”为主
- **AND** 抽屉提供前往独立配置中心总览页的入口

### Requirement: OpenCode 集成
系统 SHALL 保留 `OpenCode Local` 与 `OpenCode Bridge` 两种能力，同时允许执行链路扩展到其他 CLI backend。

#### Scenario: 使用 OpenCode 能力
- **WHEN** 用户启用本地或 bridge 形式的 OpenCode
- **THEN** 系统将其视为可选 runtime，而不是业务流程对 `opencode` 的硬编码依赖

## REMOVED Requirements
### Requirement: 配置中心复制所有深层编辑流程
**Reason**: 账号密钥、角色素材、技能导入和团队套件编辑已有成熟入口，复制会制造双源状态。
**Migration**: 独立配置中心负责状态总览、供应商档案、渠道和默认策略；深层对象编辑继续在设置抽屉完成。
