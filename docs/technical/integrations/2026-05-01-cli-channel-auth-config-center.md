# CLI / 渠道 / 认证 配置中心设计稿

## 背景

当前仓库已经开始具备多 CLI 运行能力：

- `src/server/daemon.ts` 已有 `ENGINE_MAP`，支持 `opencode / claude / codex / mock`
- 前端 `SettingsDrawer.tsx` 仍主要停留在环境检测与 `opencode bridge` 配置
- 还没有统一的“认证 / 提供商 / 渠道 / 运行时”模型

参考 `clowder-ai` 的组织方式，最值得借鉴的是它把这类复杂度统一收进 **Hub → System Settings → Account Configuration**，集中管理：

- 模型 API keys
- OAuth
- Provider profiles
- 多渠道接入

参考来源：

- [clowder-ai README](https://github.com/zts212653/clowder-ai)
- [clowder-ai README raw](https://raw.githubusercontent.com/zts212653/clowder-ai/main/README.md)

## 目标

为 Agent Task Hub 设计一个独立的 **“账户与集成配置中心”**，统一管理：

1. CLI 运行时
2. 认证方式
3. Provider 配置
4. 渠道接入
5. 路由与默认策略

目标不是一次性把所有渠道做完，而是先建立一套可扩展的数据模型和页面结构，让后续多 CLI / 多认证 / 多渠道接入不再是“散点加功能”。

## 现状分析

### 当前已有基础

- 后端运行时抽象
  - `src/server/daemon.ts`
  - 已支持按 `engine` 路由 CLI
  - 已具备 timeout / graceful kill / bridge / session 的基础设施

- 前端设置页
  - `src/components/task-hub/SettingsDrawer.tsx`
  - 当前能力：
    - 检测 opencode
    - 检测 daemon
    - 配置 opencode bridge
    - mock runner 开关
    - 清空本地数据

- 前端状态
  - `src/store/taskHubStore.ts`
  - 当前配置状态主要是：
    - `opencodeStatus`
    - `opencodeBridge`
    - `daemonConnection`
    - `enableMockRunner`

### 当前问题

1. 配置对象粒度过粗  
   当前只有 `opencode bridge` 这种单点配置，没有“credential / provider profile / channel / runtime binding”这些中间层。

2. 认证能力无法扩展  
   现在没有统一认证模型，无法优雅支持：
   - API Key
   - OAuth
   - Bearer Token
   - CLI Session
   - Bridge Secret

3. 渠道与运行时耦合  
   后续如果接入 MCP / Feishu / Telegram / GitHub，会很容易把渠道逻辑散落到不同模块里。

4. 业务设置与系统设置混在一起  
   `SettingsDrawer` 更适合放“快速状态 / 快速检测 / 调试入口”，不适合承载完整的账户与集成配置。

## 核心设计原则

### 1. 渠道、认证、Provider、运行时分层

- `Channel`：消息/任务从哪里来，往哪里去
- `Credential`：如何认证
- `ProviderProfile`：接哪个提供商、用哪个模型、走哪个 endpoint
- `CliRuntime`：实际执行命令的本地或桥接运行时
- `RoutingPolicy`：默认把什么任务/渠道绑定到什么运行策略

### 2. 配置中心独立于业务主界面

- 主工作台只关心“项目 / 对话 / 看板 / 风险”
- 集成配置统一放在“配置中心”
- `SettingsDrawer` 仅保留：
  - 系统状态摘要
  - 快速检测
  - 进入配置中心按钮

### 3. 先支持最小闭环，再扩展

建议优先级：

1. `web` + `mcp` 两个渠道
2. `api_key` + `cli_session` 两类认证
3. `opencode / claude / codex` 三个 CLI runtime
4. `openai / anthropic / gemini / openrouter / kimi / glm / qwen / minimax / custom` provider profiles
5. 再扩展 Feishu / Telegram / GitHub / Voice

## 配置中心信息架构

## 入口

- Header 里的 `设置` 按钮打开 `SettingsDrawer`
- `SettingsDrawer` 顶部加入一个主按钮：
  - `打开账户与集成配置`

建议新增一个完整页面或大面板：

- `src/app/settings/integrations/page.tsx`
  - 或先实现为右侧全屏 Drawer / Modal，但信息结构按页面设计

## 页面结构

### Tab 1：CLI Runtimes

用途：查看和管理本地/桥接可用 CLI 运行时。

内容：

- Runtime 列表
  - 名称：`opencode / claude / codex / gemini / mock`
  - 类型：local / bridge / remote
  - 安装状态
  - 版本
  - 默认输出格式：`ndjson / stream-json / json`
  - 是否支持 session / MCP / tools

- 每个 runtime 的操作：
  - 检测安装
  - 测试运行
  - 设置默认 working mode

### Tab 2：Credentials

用途：统一管理认证材料。

内容：

- Credential 列表
  - 名称
  - 类型：API Key / OAuth / Token / CLI Session / Bridge Secret
  - 状态：valid / pending / expired / invalid
  - 作用域：适用于哪些 provider / channel / runtime

- 操作：
  - 新增凭据
  - 发起 OAuth
  - 粘贴 Token / API Key
  - 失效 / 轮换 / 删除

### Tab 3：Provider Profiles

用途：将“账号”和“运行配置”解耦。

内容：

- Provider Profile 列表
  - 名称：`anthropic-prod` / `openrouter-kimi` / `glm-cn` / `custom-staging`
  - Provider 类型
  - Model
  - Base URL
  - Credential 绑定
  - 是否默认

- 操作：
  - 新建 Profile
  - 绑定 credential
  - 测试请求

### Tab 4：Channels

用途：管理外部入口与出口。

内容：

- `web`
- `mcp`
- `github`
- `feishu`
- `telegram`
- `voice`
- `webhook`

每个 channel 的配置包括：

- enabled
- credential
- provider profile
- runtime
- webhook / callback / app metadata

### Tab 5：Routing Policy

用途：定义默认路由策略。

内容：

- 默认对话 provider profile
- 默认执行 CLI runtime
- 默认评审 runtime
- 渠道路由规则
  - GitHub review -> `codex-review-profile`
  - Web chat -> `opencode` or provider fallback
  - MCP dispatch -> `claude-runtime`

## 建议的数据模型

建议先在 `src/store/taskHubStore.ts` 中新增配置域，后续再抽到独立 store。

```ts
export type CredentialType =
  | 'api_key'
  | 'oauth'
  | 'bearer_token'
  | 'device_code'
  | 'cli_session'
  | 'bridge_secret';

export interface Credential {
  id: string;
  name: string;
  type: CredentialType;
  status: 'valid' | 'pending' | 'expired' | 'invalid';
  secretRef?: string;
  providerHints?: string[];
  channelHints?: string[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type ProviderKind =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'kimi'
  | 'glm'
  | 'minimax'
  | 'qwen'
  | 'custom';

export interface ProviderProfile {
  id: string;
  name: string;
  provider: ProviderKind;
  model?: string;
  baseUrl?: string;
  credentialId?: string;
  region?: string;
  organization?: string;
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
  isDefault?: boolean;
}

export type CliEngine =
  | 'opencode'
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'mock';

export interface CliRuntime {
  id: string;
  engine: CliEngine;
  mode: 'local' | 'bridge' | 'remote';
  installed: boolean;
  version?: string;
  command?: string;
  supportedAuth: CredentialType[];
  supportedFormats: Array<'ndjson' | 'stream-json' | 'json'>;
  supportsSession?: boolean;
  supportsMcp?: boolean;
  supportsTools?: boolean;
  health?: {
    checked: boolean;
    available: boolean;
    error?: string;
  };
}

export type ChannelKind =
  | 'web'
  | 'mcp'
  | 'github'
  | 'feishu'
  | 'telegram'
  | 'voice'
  | 'webhook';

export interface ChannelConfig {
  id: string;
  channel: ChannelKind;
  enabled: boolean;
  credentialId?: string;
  providerProfileId?: string;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
}

export interface RoutingPolicy {
  defaultChatProviderProfileId?: string;
  defaultExecutionRuntimeId?: string;
  defaultReviewRuntimeId?: string;
  byChannel: Partial<Record<ChannelKind, {
    providerProfileId?: string;
    runtimeId?: string;
  }>>;
}
```

## 与现有代码的映射关系

### 1. `opencodeStatus` -> `CliRuntime.health`

当前：

- `opencodeStatus.checked / available / version / error`

建议演进到：

- `cliRuntimes['opencode'].health`

### 2. `opencodeBridge` -> `CliRuntime(mode='bridge') + Credential(bridge_secret)`

当前：

- `opencodeBridge.url`
- `opencodeBridge.enabled`

建议演进到：

- 一个 `CliRuntime`：
  - `engine: 'opencode'`
  - `mode: 'bridge'`
  - `metadata.url`

- 可选配套 `Credential`：
  - `type: 'bridge_secret'`

### 3. `engine` 路由保留，但 payload 扩展

当前 `daemon.ts` 的 `terminal:start` payload：

```ts
{
  projectId,
  taskId,
  agentId,
  prompt,
  sessionId,
  allowMockRunner,
  opencodeBridgeUrl,
  engine
}
```

建议后续扩展为：

```ts
{
  projectId,
  taskId,
  agentId,
  prompt,
  sessionId,
  engine,
  runtimeId,
  providerProfileId,
  channel,
  authContextId
}
```

其中：

- `engine`：CLI 类型
- `runtimeId`：具体 runtime 配置
- `providerProfileId`：模型/endpoint/profile
- `channel`：调用来源
- `authContextId`：认证上下文引用

### 4. `SettingsDrawer` 角色调整

建议把 `SettingsDrawer.tsx` 收缩为：

- 系统摘要卡
  - daemon
  - 默认 runtime
  - 默认 provider
  - bridge 状态
- 快速检测按钮
- “打开配置中心”主按钮

而不是继续在这里扩展 provider/channel/auth 复杂配置。

## 页面结构草图

```text
Account Configuration
├─ Overview
│  ├─ Daemon status
│  ├─ Default execution runtime
│  ├─ Default chat provider
│  └─ Active channels
├─ CLI Runtimes
│  ├─ opencode (local / bridge)
│  ├─ claude
│  ├─ codex
│  └─ gemini
├─ Credentials
│  ├─ API Keys
│  ├─ OAuth sessions
│  ├─ CLI sessions
│  └─ Bridge secrets
├─ Provider Profiles
│  ├─ anthropic-prod
│  ├─ openrouter-kimi
│  ├─ glm-cn
│  └─ custom-staging
├─ Channels
│  ├─ web
│  ├─ mcp
│  ├─ github
│  ├─ feishu
│  └─ telegram
└─ Routing Policy
   ├─ default chat
   ├─ default execute
   ├─ default review
   └─ per-channel override
```

## 渐进式落地顺序

### Phase 1：配置模型落地

只做前端状态与页面框架，不接复杂后端：

- 在 store 中加入：
  - `credentials`
  - `providerProfiles`
  - `cliRuntimes`
  - `channelConfigs`
  - `routingPolicy`

- 新增配置中心页面骨架

### Phase 2：CLI Runtime 页面接入现有检测能力

- 把 `检测 Opencode`
- `检测 Bridge`
- `检测 Daemon`

迁移到配置中心的 Runtime / Overview 视图中

### Phase 3：Provider Profile + Credential

先只支持：

- `api_key`
- `cli_session`

先接：

- `openai`
- `anthropic`
- `gemini`
- `openrouter`
- `custom`

### Phase 4：Channel

优先支持：

- `web`
- `mcp`

然后再扩展：

- `github`
- `feishu`
- `telegram`

### Phase 5：Routing Policy

让 agent / 渠道 / provider / runtime 可以默认绑定。

## UI 设计建议

### 1. 不要做成“超级大表单”

推荐采用：

- 左侧导航
- 右侧内容区
- 每类对象列表 + 编辑抽屉/弹窗

### 2. 配置对象使用卡片+状态标签

例如 Runtime 卡片直接展示：

- engine
- mode
- installed
- supports session / MCP / tools
- latest check result

### 3. 新建配置统一使用独立弹层

和你在项目工作台里对“新建项目”的反馈一致：

- 列表负责选择
- `+` 负责进入独立配置页/弹层

## 对当前实现的具体建议

如果立即开始做，我建议最小实施范围如下：

1. 新建 `Account Configuration` 页面
2. 把 `SettingsDrawer` 缩成摘要 + 入口
3. 先实现两个 tab：
   - `CLI Runtimes`
   - `Credentials`
4. 把现有：
   - `opencodeStatus`
   - `opencodeBridge`
   - `daemonConnection`
   迁移为新页面中的 runtime / overview 视图

这是最稳的起点，因为：

- 能立刻统一当前分散配置
- 不需要立刻改动整个执行链路
- 又为多渠道、多认证方式打下结构基础

## 推荐下一步

建议紧接着做两份工作：

1. **前端 IA / 页面组件设计**
   - 配置中心页面结构
   - 各 tab 的列表/详情/新建弹层

2. **后端配置契约**
   - runtime / provider / credential / channel 的服务端存储与校验方式
   - `terminal:start` payload 扩展协议

