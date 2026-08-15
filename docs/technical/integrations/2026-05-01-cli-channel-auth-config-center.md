# CLI / 认证配置设计

> 状态：当前实现事实
> 更新：2026-08-15

## 1. 用户配置入口

设置抽屉是唯一配置入口，按用户对象分为：

- 模型账号
- 角色素材
- 技能
- 团队套件

不再提供独立“配置中心”总览。账号、角色、技能和团队信息不在第二个页面重复展示或编辑。

## 2. 当前对象模型

### 2.1 Account

账号是认证事实源，包含 provider、认证方式、Base URL、模型列表、启用状态和验证状态。OAuth 与 API Key 使用不同字段：Anthropic/OpenAI 可使用 ACP Adapter 明确复用的主机 OAuth；映射到 OpenCode 的 Google、Kimi、OpenCode、Other 必须使用 API Key。OpenCode-compatible provider 还必须提供 Base URL，Google 可使用默认地址。API Key 账号只有在密钥非空、至少配置一个模型且验证状态为 `valid` 时才能进入执行解析；provider、Base URL、密钥或模型变化会立即把状态重置为 `pending`。

### 2.2 RoleCard / Skill / TeamPack

- RoleCard 描述可复用的角色素材。
- Skill 是可安装并绑定到 Agent 的能力包。
- TeamPack 固化项目团队成员、角色快照、账号和 Skill 绑定。
- 项目通过 `conversation.team_pack_id` 选择 TeamPack；成员和 RoleCard/Account/Skill 配置直接属于 `TeamPackRole`，不维护平行的 Agent-TeamPack assignment 表。

这些对象均在设置抽屉中管理，项目运行时通过 TeamPack 与 Agent 绑定解析实际执行配置。

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
- 浏览器 `terminal:start` 只发送服务端真实消费的单一 `accountId`，不再附带无消费者的 provider、channel、auth context 或账号候选数组。
- 用户通过账号和 TeamPack 成员绑定表达意图，不直接编辑底层 routing 参数。
- Google、Kimi、OpenCode 与 Other API Key 账号的“测试连接”和正式 Agent 执行共用同一份临时 OpenCode provider/model/env 配置；不再运行 Gemini/Kimi 私有 CLI，也不存在 `echo ok` 假验证。临时配置在验证完成或失败后清理。浏览器解析、服务端规划、评估快照恢复和 daemon 最终启动边界都会复核同一 readiness，避免计划生成后的账号变化继续执行。上述 provider 的厂商 OAuth 登录态不能安全交给 OpenCode，创建、变更、验证与 Runtime selection 均失败关闭。Anthropic/OpenAI OAuth 只因 Claude/Codex ACP Adapter 明确复用主机登录态而保留。

历史实施材料见 `docs/archive/specs/unify-integration-config-center/`；后续事实以本文件、设置抽屉和服务端运行链路为准。
