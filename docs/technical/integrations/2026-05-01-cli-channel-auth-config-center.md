# CLI / 认证配置设计

> 状态：当前实现事实
> 更新：2026-08-15

## 1. 用户配置入口

设置抽屉是唯一配置入口，按用户对象分为：

- 模型账号
- 运行环境
- 技能

不再提供独立“配置中心”总览。Agent 身份、工作指令、技能选择与执行偏好直接在 Agent 对象中管理；Agent Team 在 Agents 页面只引用既有 Agent，不在设置中复制成员配置。

## 2. 当前对象模型

### 2.1 Account

账号是认证事实源，包含 provider、认证方式、Base URL、模型列表、启用状态和验证状态。OAuth 与 API Key 使用不同字段：Anthropic/OpenAI 可使用 ACP Adapter 明确复用的主机 OAuth；映射到 OpenCode 的 Google、Kimi、OpenCode、Other 必须使用 API Key。OpenCode-compatible provider 还必须提供 Base URL，Google 可使用默认地址。API Key 账号只有在密钥非空、至少配置一个模型且验证状态为 `valid` 时才能进入执行解析；provider、Base URL、密钥或模型变化会立即把状态重置为 `pending`。

### 2.2 Agent / Skill / Agent Team

- Skill 是可安装并绑定到 Agent 的能力包。
- Agent Definition 直接保存身份、工作指令、Skill 引用、运行环境选择、模型账号/模型、权限与执行偏好。
- Agent Team 只保存已有 Agent 的引用与协作关系，不复制工作指令、账号、Skill 或 Runtime 快照。
- 历史 `RoleCard` / `TeamPackRole` 字段只允许作为存储迁移兼容，不能再进入创建、执行解析或 Prompt 编译。

项目运行时从当前 Agent Definition 解析实际执行配置；Agent Team 不成为第二个执行配置源。

### 2.3 Runtime

daemon 通过本机 CLI 命令探测 OpenCode、Claude、Codex 等运行时的可用性，并在执行时通过 ACP Catalog 创建对应 backend。运行时选择来自项目团队成员的实际绑定和服务端解析，不由浏览器 localStorage 中的平行 routing 对象决定。

## 3. 删除的平行模型

早期页面曾在前端维护 `ProviderProfile`、`ChannelConfig`、`RoutingPolicy`，但 daemon、dispatch、ACP 和项目执行链均不读取这些对象。它们已连同 `/settings/integrations` 页面删除，避免：

- 向用户暴露 runtime、channel、routing 等实现概念；
- 同一账号或模型选择出现两套入口；
- localStorage 配置看似生效、实际不影响执行；
- 为尚不存在的策略 seam 维护平行事实源。

如果未来确实需要默认路由，必须先在服务端建立被所有执行入口消费的权威事实源，再设计用户界面；不得先添加仅前端持久化的配置对象。

## 4. 保留边界

- daemon 的 `engine / runtimeId / accountId` 执行参数通路继续保留，它们属于内部执行契约。
- 浏览器不发送执行账号或 runtime；Invocation Planner 只把已裁决的单一 `accountId` 放入服务端 `InvocationDispatchPlan`，不携带 provider、channel、auth context 或账号候选数组。
- 用户通过 Agent 的运行环境、账号和模型选择表达意图，不直接编辑底层 routing 参数。
- Google、Kimi、OpenCode 与 Other API Key 账号的“测试连接”和正式 Agent 执行共用同一份临时 OpenCode provider/model/env 配置；不再运行 Gemini/Kimi 私有 CLI，也不存在 `echo ok` 假验证。临时配置在验证完成或失败后清理。浏览器解析、服务端规划、评估快照恢复和 daemon 最终启动边界都会复核同一 readiness，避免计划生成后的账号变化继续执行。上述 provider 的厂商 OAuth 登录态不能安全交给 OpenCode，创建、变更、验证与 Runtime selection 均失败关闭。Anthropic/OpenAI OAuth 只因 Claude/Codex ACP Adapter 明确复用主机登录态而保留。

历史实施材料见 `docs/archive/specs/unify-integration-config-center/`；后续事实以本文件、设置抽屉和服务端运行链路为准。
