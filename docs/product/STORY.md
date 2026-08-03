---
topics: [product-story, user-outcomes, optimization, evidence]
doc_kind: product-story
created: 2026-08-02
updated: 2026-08-03
---

# Agent Task Hub 产品故事

这里记录产品优化带给用户的真实变化。

它不是代码变更日志，也不替代 spec、技术设计或测试报告。技术文档回答“系统如何实现”，故事文档回答“用户原来遇到什么、现在有什么不同、我们凭什么确认它真的变好了”。

## 维护规则

当一次优化产生用户可感知的效果时，交付前必须在本文件增加或更新一条故事。每条故事至少包含：

- 原来的用户处境，而不是内部错误码的堆叠；
- 优化后的可感知变化；
- 能复核的效果证据；
- 尚未改变的边界或历史记录；
- 对应 spec、产品文档或技术设计的链接。

只有直接覆盖所述用户效果的证据，才能支持“已经改善”：例如针对性自动化测试、真实界面观察或实际运行链验证。构建通过只能作为可交付性的辅助证据，不能单独证明用户体验已经改善。未验证目标不进入本故事文档，应留在 spec、计划或任务清单中。

---

## 2026-08-02：被唤醒的队友终于会回来

### 原来的处境

用户在群聊里 `@` Agent，平台看起来已经接纳任务，但 Agent 迟迟不回来。界面有时还会因为任务状态不兼容而崩溃，消息输入框随之消失。即使后台在周期恢复，同一批过期动作也可能反复阻断后续工作。

对用户来说，这不是三个技术故障，而是同一个体验：**任务像被系统吞掉了，既不能继续交付，也无法判断团队是否还在工作。**

### 优化后的变化

- 聊天页面能够稳定打开，消息输入框保持可见；
- 看板把受管任务状态转换为用户界面能够理解的“待处理、进行中、评审中、已完成”等状态，不再因为内部状态词崩溃；
- Claude Agent 唤醒时直接使用已安装并锁定版本的 ACP 适配器，避免在每次唤醒中临时启动包管理器；
- Claude 原生后台子代理仍由父会话承接，子任务输出不会落到平台无法管理的后台等待中；
- 恢复批次遇到过期工作时会取消该动作并继续处理仍有效的队友任务，不再让一个过期动作卡住整批恢复。

### 已验证的效果

- 生产服务重建并重启后，浏览器中的聊天输入区和看板正常渲染且没有错误；
- 旧看板使用的状态投影没有暴露非法状态；
- 重启后一次由调度器触发的 Claude 唤醒正常完成，未再出现 `write EPIPE`；
- 真实 Claude ACP 烟测完成并返回可见文本；
- 相关回归测试、TypeScript 检查和 Webpack 生产构建通过。

### 仍然保留的边界

历史失败记录仍会保留用于审计，因此旧消息中可能继续看到过去的 `acp_startup_failed`。它表示曾经发生过故障，不代表重启后的新唤醒仍在失败。故事中的效果以新 invocation 和当前界面状态为准。

### 设计与实现依据

- [唤醒恢复实施归档](../archive/specs/wakeup-recovery/spec.md)
- [群聊任务图与状态投影](../technical/execution/group-chat-task-graph.md)
- [统一 ACP 执行链](../technical/execution/opencode-integration-executable-chain.md)
- [Platform Harness 状态机](../technical/execution/platform-harness-state-machine-design.md)

---

## 2026-08-03：自主 Agent 不再卡在无人回答的权限确认

### 原来的处境

用户已经在创建自主交付时允许团队修改代码，但 Claude 真正调用 Write、Edit 或 Bash 时，平台仍把权限请求按默认拒绝处理。无人值守会话里没有人能点击“允许”，于是 Agent 会报告自己无法写文件、无法运行测试；用户只能到每个项目手工添加 `.claude/settings.local.json`，同一份授权被迫配置两次。

### 优化后的变化

- 创建自主交付时给出的“允许改代码”会随 WorkContract 到达当前 Agent，并转成当前 Invocation 内的单次 ACP 授权；
- 项目内 Write/Edit、白名单内测试/构建/检查命令，以及父会话承接的 Claude 原生 Task/Agent 子任务可以在无人值守模式继续执行；
- 通用 shell、Git/网络命令不会由“允许改代码”放开；push、创建 PR、合并仍经受信平台动作分别检查原有授权；
- 每次权限请求和允许/拒绝结果都进入 Runtime Event 流，排障时可以直接确认工作是被 Agent 放弃还是被平台策略拦截。

### 已验证的效果

- 权限策略、ACP backend 回调和 Runtime Event 审计的 37 项针对性回归测试通过；
- 使用真实 Claude ACP 在没有项目级 Claude 权限文件的临时目录中，成功完成 Write 创建文件、Bash 调用 Node 读取文件并返回结果，期间平台收到 `edit` 与 `execute` 请求并逐次选择 `allow_once`；
- TypeScript 检查、受影响文件 ESLint 和 Next.js 生产构建通过。

### 仍然保留的边界

没有自主 WorkContract 或没有“允许改代码”时，权限请求继续默认拒绝。文件编辑的真实路径必须位于当前项目工作目录；执行只允许直接调用约定的 test/build/lint 命令，通用 shell 与外部交付动作走受信平台能力。平台从不自动选择 `allow_always`；每次请求重查 Work Authority，历史或已替换 Invocation 的授权不能复用。这里信任的是 Agent 与当前项目代码；对恶意仓库的网络、凭据和文件系统隔离仍需要部署级执行沙箱。

### 设计与实现依据

- [自主交付产品契约](business/2026-07-19-autonomous-delivery-contract.md)
- [ACP 运行时统一接入规范](../../specs/acp-runtime-integration/spec.md)
- [统一 ACP 执行链](../technical/execution/opencode-integration-executable-chain.md)
