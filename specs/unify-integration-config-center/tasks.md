# Tasks

- [x] Task 1: 建立账号模型与基础服务端存储
  - [x] 提供 `Account` 模型与 provider / authMode 基础约束
  - [x] 落地账号文件存储与凭据存储
  - [x] 提供 `/api/accounts` 与 `/api/accounts/verify` 基础接口

- [x] Task 2: 在设置抽屉中落地当前配置入口
  - [x] 设置抽屉提供 `模型账号` 分区
  - [x] 设置抽屉提供 `角色卡` 分区
  - [x] 支持账号新增、编辑、删除与连接验证
  - [x] 支持角色卡列表、详情与编辑入口

- [x] Task 3: 打通账号到执行引擎的映射关系
  - [x] 建立 `provider -> engine` 的映射
  - [x] 支持从 agent / role card 绑定账号推导执行引擎
  - [x] 在执行链路中传入 `accountId`

- [x] Task 4: 扩展 daemon 执行上下文契约
  - [x] 保留兼容现有 `engine` 的 payload 方式
  - [x] 增加 `runtimeId / providerProfileId / channel / authContextId` 参数通路
  - [x] 保持 bridge / 本地 CLI / mock 路径兼容

- [x] Task 5: 将 OpenCode 从唯一特殊逻辑演进为 backend 之一
  - [x] daemon 支持多 CLI backend 工厂
  - [x] `opencode / claude / codex` 有独立 backend
  - [x] `gemini / mock` 当前仍使用回退实现

- [ ] Task 6: 独立配置中心页面
  - [ ] 新增 `src/app/settings/integrations/page.tsx`
  - [ ] 提供独立配置中心路由与页面骨架
  - [ ] 将抽屉与页面职责重新分层

- [ ] Task 7: 完整配置对象接入
  - [ ] 新增 `Provider Profiles`
  - [ ] 新增 `Channels`
  - [ ] 新增 `Routing Policy`
  - [ ] 让默认聊天 / 执行 / 评审 runtime 可配置

- [x] Task 8: 基础验证
  - [x] 账号配置可访问
  - [x] 角色卡配置可访问
  - [x] 执行链路支持 `accountId` 与扩展上下文参数
  - [x] `pnpm build` 已通过

# Task Dependencies
- Task 2 依赖 Task 1
- Task 3 依赖 Task 1 与 Task 2
- Task 4 依赖 Task 3
- Task 5 依赖 Task 4
- Task 6 依赖 Task 2
- Task 7 依赖 Task 4 与 Task 6
- Task 8 依赖 Task 2-5
