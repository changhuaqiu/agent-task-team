# CLI / 渠道 / 认证 配置中心设计稿

> 状态：设计稿，非完整落地现状
> 更新：2026-05-02
>
> 当前代码已落地“模型账号 + 角色素材 + 独立配置中心 + Provider Profiles / Channels / Routing Policy + daemon 扩展参数通路”。原实施规格已归档至 `docs/archive/specs/unify-integration-config-center/`；当前事实以本稿、`src/components/settings/IntegrationSettingsPage.tsx` 和代码实现为准。

## 1. 当前代码事实

### 1.1 已落地能力

- 设置抽屉当前主入口是：`模型账号`、`角色卡`
- `/settings/integrations` 已作为独立配置中心页面落地
- 账号支持新增、编辑、删除、验证
- OAuth 与 API Key 两种模式已按不同表单逻辑落地
- 角色卡支持浏览、详情、编辑与账号绑定
- 配置中心展示账号、角色素材、技能、团队套件与执行环境状态；账号/角色/技能/团队套件的深层编辑流程仍保留在设置抽屉
- 配置中心支持编辑 `ProviderProfile / ChannelConfig / RoutingPolicy`
- daemon 执行请求已支持 `engine / runtimeId / channel / authContextId / accountId` 参数通路
- daemon 已有 `opencode / claude / codex` 三类主要 backend

### 1.2 未落地能力

- 完整的 `CLI Runtimes` 管理界面
- 将所有聊天 / 执行 / 评审入口强制接入 `RoutingPolicy`
- 独立 `gemini` backend

## 2. 当前问题

当前项目虽然已经开始支持多 CLI 和账号绑定，但配置层仍存在几个缺口：

1. 用户能看到执行环境健康状态，但还不能安装或管理自定义 runtime
2. daemon 已有扩展参数，前端已有配置对象，但部分执行入口尚未读取 routing policy
3. 设置抽屉仍承担账号/角色/技能/团队套件深层编辑，后续可继续收缩为摘要 + 跳转入口

## 3. 本文档的目标范围

本文档的作用不是描述“当前已经完成了什么”，而是定义未来统一配置中心的目标信息架构。

设计目标：

- 将配置对象拆为独立领域对象
- 让执行环境从“写死 engine”演进为“账号 + runtime + channel + routing”组合
- 给后续独立配置中心页面提供稳定蓝图

## 4. 目标对象模型

### 4.1 CliRuntime

表示一个可执行 runtime：

- `id`
- `engine`
- `mode`：`local`；远程 runtime 未来通过控制面正式接入，不复用已退役的 HTTP Bridge
- `label`
- `health`
- `version`
- `capabilities`

说明：当前代码只具备部分探测能力，还没有完整的前端模型与管理界面。

### 4.2 Account

表示用户可配置的账号对象：

- `id`
- `provider`
- `label`
- `authMode`
- `baseUrl?`
- `models[]`
- `status`

当前这是最接近真实落地的配置对象。

### 4.3 ProviderProfile

表示模型厂商能力描述：

- `id`
- `provider`
- `displayName`
- `models[]`
- `defaultModel`
- `accountIds`
- `enabled`

### 4.4 ChannelConfig

表示某一使用场景或接入渠道：

- `id`
- `name`
- `purpose`
- `defaultRuntimeId?`
- `defaultProviderProfileId?`

当前未落地。

### 4.5 RoutingPolicy

表示默认路由策略：

- `id`
- `scope`
- `runtimeId`
- `providerProfileId`
- `fallbackRuntimeIds[]`
- `enabled`

## 5. 目标信息架构

### 阶段一：当前已落地入口

设置抽屉内：

- `模型账号`
- `角色卡`

### 阶段二：独立配置中心

当前 `/settings/integrations` 作为独立配置中心，不复制设置抽屉中的深层编辑流程。页面当前拆为：

- `Accounts`
- `Provider Profiles`
- `Channels`
- `Routing Policy`
- `CLI Runtime health`

## 6. 与当前代码的衔接关系

当前应这样理解：

- `SettingsDrawer.tsx`：账号、角色素材、技能、团队套件的深层编辑入口
- `IntegrationSettingsPage.tsx`：配置中心总览和 routing 对象轻量编辑入口
- `Account`：当前真实落地的配置对象
- `RoleCard`：当前真实落地的协作对象
- `ProviderProfile / ChannelConfig / RoutingPolicy`：当前真实落地的前端配置对象
- `runtimeId / channel / authContextId`：执行请求参数通路

不应这样理解：

- 不应把配置中心理解为账号密钥或团队套件的第二套编辑系统
- 不应把 `gemini` 视为当前已独立支持的 runtime

## 7. 后续实施建议

1. 将普通聊天、任务执行和评审入口统一读取 `RoutingPolicy`
2. 补 runtime catalog 的真实 store 与 API
3. 最后将设置抽屉收缩为摘要 + 跳转入口

## 8. 当前结论

- 这份文档保留为“目标设计稿”
- 历史实施记录见 `docs/archive/specs/unify-integration-config-center/`
- 如果代码继续演进，必须先更新该 spec，再更新本文档
