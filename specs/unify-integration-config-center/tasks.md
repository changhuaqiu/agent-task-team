# Tasks

- [x] Task 1: 梳理并固化统一配置模型
  - [x] 在 `taskHubStore` 中建立最小可用的配置对象：`CliRuntime`、`Credential`、`ProviderProfile`、`ChannelConfig`、`RoutingPolicy`
  - [x] 明确现有 `opencodeStatus`、`opencodeBridge`、`daemonConnection` 向统一模型的映射关系
  - [x] 确认本地持久化范围，避免把业务态与配置态混杂

- [x] Task 2: 实现配置中心页面骨架
  - [x] 新增独立配置中心页面路由
  - [x] 提供分区导航与基础布局
  - [x] 先落地 `CLI Runtimes` 与 `Credentials` 两个分区

- [x] Task 3: 将现有运行时检测能力接入配置中心
  - [x] 复用现有 OpenCode 本地探测能力
  - [x] 复用现有 Bridge 检测能力
  - [x] 复用现有 daemon 重连与状态展示能力
  - [x] 将 Mock Runtime 开关纳入 runtime 分区管理

- [x] Task 4: 收缩设置抽屉职责
  - [x] 保留 daemon / bridge / mock 等摘要信息
  - [x] 保留快速检测动作
  - [x] 增加进入配置中心的主入口
  - [x] 移除“设置抽屉承担完整配置中心职责”的交互假设

- [x] Task 5: 实现凭据管理的最小闭环
  - [x] 支持新增、编辑、删除本地凭据记录
  - [x] 支持展示凭据类型、状态、适用范围提示
  - [x] 为后续 `Provider Profiles / Channels` 预留引用关系

- [x] Task 6: 扩展 daemon 执行上下文契约
  - [x] 设计兼容现有 `engine` 的 payload 扩展方式
  - [x] 增加 `runtimeId / providerProfileId / channel / authContextId` 的数据通路
  - [x] 保持现有执行链路可回退、可兼容

- [ ] Task 7: 第二阶段配置对象接入
  - [ ] 新增 `Provider Profiles` 分区
  - [ ] 新增 `Channels` 分区
  - [ ] 新增 `Routing Policy` 分区
  - [ ] 让默认聊天 / 执行 / 评审 runtime 可配置

- [x] Task 8: 验证与验收
  - [x] 确认配置中心页面可访问，且从设置抽屉可以跳转进入
  - [x] 确认 `CLI Runtimes` 与 `Credentials` 分区可完成最小闭环交互
  - [x] 确认 OpenCode 已从“唯一特殊逻辑”转为统一 runtime 之一
  - [x] 运行 `pnpm build` 并通过

# Task Dependencies
- Task 2 依赖 Task 1
- Task 3 依赖 Task 2
- Task 4 依赖 Task 2
- Task 5 依赖 Task 1 与 Task 2
- Task 6 依赖 Task 1
- Task 7 依赖 Task 1、Task 5、Task 6
- Task 8 依赖 Task 2-7
