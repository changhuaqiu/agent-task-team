# CLI / 渠道 / 认证 配置中心设计稿

> 状态：设计稿，非完整落地现状
> 更新：2026-05-02
>
> 当前代码已落地的是“模型账号 + 角色卡 + daemon 扩展参数通路”，并没有独立配置中心页面，也没有完整的 `Provider Profiles / Channels / Routing Policy`。阅读本稿时，请以 `specs/unify-integration-config-center/`、`src/components/task-hub/SettingsDrawer.tsx` 和当前代码实现为准。

## 1. 当前代码事实

### 1.1 已落地能力

- 设置抽屉当前主入口是：`模型账号`、`角色卡`
- 账号支持新增、编辑、删除、验证
- OAuth 与 API Key 两种模式已按不同表单逻辑落地
- 角色卡支持浏览、详情、编辑与账号绑定
- daemon 执行请求已支持 `engine / runtimeId / channel / authContextId / accountId` 参数通路
- daemon 已有 `opencode / claude / codex` 三类主要 backend

### 1.2 未落地能力

- 独立配置中心页面
- 完整的 `CLI Runtimes` 管理界面
- 完整的 `Provider Profiles` 管理
- 完整的 `Channels` 管理
- 完整的 `Routing Policy` 管理
- 独立 `gemini` backend

## 2. 当前问题

当前项目虽然已经开始支持多 CLI 和账号绑定，但配置层仍存在几个缺口：

1. 用户能管理账号，却不能看到完整 runtime 目录
2. daemon 已有扩展参数，但前端没有对应的完整对象模型
3. `provider / channel / routing` 仍停留在设计阶段
4. 设置抽屉承担了“已落地入口”和“未来设计想象”两种角色，容易误导后续开发

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
- `mode`：`local` / `bridge`
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

当前未落地。

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
- `fallbacks[]`

当前未落地。

## 5. 目标信息架构

### 阶段一：当前已落地入口

设置抽屉内：

- `模型账号`
- `角色卡`

### 阶段二：独立配置中心

未来独立页面可拆为：

- `CLI Runtimes`
- `Accounts`
- `Provider Profiles`
- `Channels`
- `Routing Policy`

## 6. 与当前代码的衔接关系

当前应这样理解：

- `SettingsDrawer.tsx`：当前真实配置入口
- `Account`：当前真实落地的配置对象
- `RoleCard`：当前真实落地的协作对象
- `runtimeId / channel / authContextId`：当前只是参数通路或未来对象挂载点

不应这样理解：

- 不应把本文档中的独立页面视为当前已存在页面
- 不应把 `Provider Profiles / Channels / Routing Policy` 视为当前已实现对象
- 不应把 `gemini` 视为当前已独立支持的 runtime

## 7. 后续实施建议

1. 先补 runtime catalog 的真实 store 与 API
2. 再补独立配置中心页面骨架
3. 再补 `Provider Profiles / Channels / Routing Policy`
4. 最后将设置抽屉收缩为摘要 + 跳转入口

## 8. 当前结论

- 这份文档保留为“目标设计稿”
- 当前实现事实以 `specs/unify-integration-config-center/` 为准
- 如果代码继续演进，必须先更新该 spec，再更新本文档
