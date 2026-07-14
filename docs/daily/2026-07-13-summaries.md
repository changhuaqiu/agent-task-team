# 今日总结 (2026-07-13/14)

## 核心：团队精简 6→4 人 + 全链路修复

### 一、团队精简（6→4 人组）
- 删除 toad（后端开发）→ 合并进 luigi（全栈开发）
- 删除 yoshi（QA测试）→ 合并进 peach（质量保障）
- 保留 mario（项目统筹）+ dk（架构工程）
- 删除 engineering-trio、research-team 两个团队套件（全部数据/提示词）
- workflow 5 阶段 → 4 阶段（quality_gate 合并 review_gate + test_gate）
- DB 数据迁移：343 toad 消息 → luigi、11 toad tasks → luigi

### 二、数据层清理
- `agentStore.ts`：FALLBACK_AGENTS 6→4，ROLE_MAP/ROLE_LABEL_MAP 删 preset-backend/preset-qa
- `presetTeamPacks.ts`：只留 default-team 4 人，删 engineering-trio + research-team
- `presetRoleCards.ts`：luigi '前端实现'→'全栈开发'，peach '代码评审'→'质量保障'
- `seed-agents.ts`：删 toad/yoshi seed
- `resolveCommunicationPolicy.ts`：4 人 communication matrix
- DB：agents 表 4 个、team_pack 1 个、team_pack_role 4 个

### 三、提示词层更新
- `teamPackLayer.ts`：HARNESS_STAGE_GUIDANCE 4 人 + workflow quality_gate
- `roleLayer.ts`：planner 提 Luigi、code_reviewer 合并 qa 职责、删 qa 分支
- `collaborationLayer.ts`：示例 @mention 泛化

### 四、前端层清理
- `globals.css`：删 toad/yoshi CSS 变量
- `PixelAvatar.tsx`、`ChatMessageItem.tsx`、`KanbanCard.tsx`、`AgentRosterModal.tsx`、`TaskCard.tsx`：删 toad/yoshi theme
- `AgentTheme` / `RuntimeAgentTheme` 类型：删 toad/yoshi

### 五、Bug 修复
- `.icon` 崩溃：`ProgressMessageCard` + `StatusDot` + `StatusBadge` 加 null check（Record 查不到 key 时不再崩溃）
- claude GLM：`assistant message` 加 `tool_use` block 解析（CLI Trace 卡片稳定）
- 消息排序：`addChatMessage` 加 timestamp sort
- 消息 limit：/api/state 100→1000
- 头像修复：`resolveTeamRuntime` 加 `emojiForRole` 推断（planner 🎯/coder 💻/reviewer 🔍）
- 聊天框消息无头像/名字：`ChatMessageItem` 改 `getEffectiveRoster()`
- agent session id 每次 @ 都变：移除 4 处 `seal('failed')`（失败保持 active，下次 resume）
- opencode prompt：改 stdin（避 Windows 命令行长度限制 8191 chars）
- A2A 持球超时：600s→1800s + env 可配
- ProgressMessageCard crash：TYPE_STYLES 未知 type 加 null guard
- ContextManager async 连锁修复：daemonStore dispatch + taskHubStore 三处加 await

### 六、CLI 中转层 + 上下文预算（前几日 TDD 成果，今日生效验证）
- `cliBridge.ts`：cross-spawn 平台中转（修 Windows opencode ENOENT）
- `capabilities.ts`：CapabilitySet + 4 CLI 能力声明
- `capabilityRouter.ts`：按能力降级（resume/systemPrompt/maxTurns/PTY）+ daemon 接入
- `relevance.ts`：keywordRelevance + recencyScore（GSSC Select）
- `ContextBudget.ts`：token 预算 + reserve
- `BudgetGuard.ts`：按层优先级裁剪（P0-P4）
- `historyLayer.ts`：GSSC 重写（Gather/Select/Compress 替代滑动窗口）
- `PromptComposer.ts`：集成 BudgetGuard

### 七、相关 spec
- `docs/archive/specs/cli-bridge-layer/`：已被 ACP 规格替代的 CLI 中转层设计
- `docs/archive/specs/context-budget-management/`：已并入 ContextManager 的上下文预算管理设计
- `specs/agent-session-stability/`：agent session 稳定性设计
- `specs/team-simplification/`：团队精简设计
- `docs/plans/2026-07-13-team-simplification.md`：实现计划

### 八、提交
- feat 分支：`feat/agent-context-and-cli-bridge`
- 已合并到 `main` 并 push 到远程 `changhuaqiu/agent-task-team`
- 26 个 TDD 测试全绿，build 通过
