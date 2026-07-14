# 验收清单 — CLI 中转层

## Phase 1（解阻塞）
- [ ] Windows 下 `opencode` 不再 `spawn ENOENT`（cross-spawn 解析 `.cmd`）
- [ ] `claude` / `opencode` / `codex` 三 backend 的 spawn **全部走 `cliBridge.spawnCli()`**，无残留原生 `spawn` 调用 CLI
- [ ] Unix（Mac/Linux）行为不变（透传，回归测试通过）
- [ ] 三 backend 各自 `capabilities` getter 返回正确常量
- [ ] 唯一新增依赖为 `cross-spawn`（+ `@types/cross-spawn`）

## Phase 2（能力路由）
- [ ] `daemon` 调 `execute` 前过 `checkCapabilities`
- [ ] resume 不支持时（codex）→ 静默开新会话 + 警告日志
- [ ] systemPrompt 不支持时（codex）→ 拼进 prompt 头 + 警告
- [ ] maxTurns 不支持时 → 剔除 + 警告
- [ ] 警告日志含 `engine` + 被降级字段 + 动作（结构化，可检索）
- [ ] 现有 dispatch / a2a 流程不破坏

## 接口与契约
- [ ] `AgentBackend.execute()` 签名不变（向后兼容）
- [ ] `AgentBackend.capabilities` 为 `readonly` getter
- [ ] `CapabilitySet` 字段与 spec 5.2 矩阵一致
- [ ] `CliBridge.spawnCli` 返回原生 `ChildProcess`（不破坏 claude stream-json 事件流）

## 跨平台
- [ ] Windows：`.cmd` 解析、PATH 注入正确
- [ ] Unix：透传，无回归
- [ ] opencode 的 go-binary / PTY 策略保留（仅在底层 spawn 走中转）

## 文档与规范
- [ ] `docs/wiki/01-architecture.md` 已加「CLI 中转层」章节
- [ ] 遵循 `docs/standards/technical.md`
- [ ] 无根目录散落 markdown

## 非目标确认（未越界）
- [ ] 未新增第 4 种 CLI 适配
- [ ] 未改 CLI 安装逻辑（cli-probe 仅 Phase 3 并入接口）
- [ ] Windows PTY 若 Phase 3 评估不可行，明确记录并保留非 PTY 降级
