# Agent Task Hub — 端到端深度审计报告

> 审计日期: 2026-05-15
> 测试结果: 641 passed / 8 failed / 54 files
> 审计范围: 全项目代码、数据模型、状态管理、服务端、UI 组件、测试覆盖

---

## 一、当前测试状态

| 指标 | 数值 |
|------|------|
| 测试文件 | 54 |
| 通过用例 | 641 |
| 失败用例 | 8 |
| 通过率 | 98.8% |

**失败测试明细:**

1. **`manual-verify.test.ts` — 场景2**: Mario @luigi → worklist entry + dispatch 失败，`luigiDispatches` 为空数组
2. **`manual-verify.test.ts` — 场景4**: CJK 名字触发 dispatch 失败，同上
3. **`manual-verify.test.ts` — 场景8**: chain budget 超限拦截未生效
4. **`MiniKanban`**: `TouchSensor` 在 jsdom/test 环境中不可用，导致组件渲染崩溃

**结论**: A2A 核心链路的集成测试有 3 个 case 失败，说明 mention → dispatch 的核心路径存在回归问题。

---

## 二、Bug 清单（按严重程度排序）

### P0 — 崩溃 / 数据丢失

| # | 位置 | 问题 | 影响 |
|---|------|------|------|
| B1 | `taskHubStore.ts:996-1033` | `loadFromServer` localStorage 迁移：逐条 POST 失败后仍删除本地数据 | 用户首次启动时的历史消息可能永久丢失 |
| B2 | `taskHubStore.ts:443,464,470` | `mapMessagesToState` 中 `JSON.parse` 无 try/catch | 服务端返回畸形 JSON 时整个 hydration 崩溃，页面白屏 |
| B3 | `TaskDetailPanel.tsx:340` | `artifactIcons[art.type]` 对未知类型返回 `undefined` 导致 React 渲染崩溃 | 用户看到包含未知 artifact 类型的任务时页面崩溃 |
| B4 | `AgentBindingPanel.tsx:97,100,193` | `profile?.prompt.roleCard` — 若 `prompt` 为 undefined 则抛 TypeError | Agent 无 prompt 配置时绑定面板崩溃 |
| B5 | `worktree-manager.ts` | Shell 命令拼接无转义，存在 **命令注入** 漏洞 | 恶意输入可执行任意系统命令 |
| B6 | `worktree-manager.ts` | `resolvePath` 路径遍历无 `realpath` 校验 | 攻击者可读写工作目录外文件 |
| B7 | `daemon.ts` tmux 模式 | session 名称和命令直接拼入 shell，**命令注入** | 远程触发可控制服务器 |
| B8 | `schema.ts` | `task.agentId`、`chatMessage.conversationId`、`chatMessage.taskId`、`invocation.taskId` 均无外键约束 | 数据库中可存在大量孤立行，删除 conversation 不级联清除关联数据 |

### P1 — 状态不一致 / 运行时错误

| # | 位置 | 问题 | 影响 |
|---|------|------|------|
| B9 | `taskHubStore.ts:390-433` | `applyConversationTeamPack` 存在竞态：fetch 完成后 selectedConversationId 可能已变 | TeamPack 应用到错误项目 |
| B10 | `taskHubStore.ts:1167` | `loadFromServer` 出错后仍标记 `hasHydrated: true` | 页面以空/残缺数据运行，用户无感知 |
| B11 | `taskHubStore.ts:1420-1561` | `addChatMessage` 多步操作无事务性：本地状态 / socket emit / 服务端持久化可能部分成功 | 消息存在但 agent 未收到；或 agent 收到但 UI 未显示 |
| B12 | `agentStore.ts:98` | `AGENT_ROSTER` 是模块级 `let` 变量，不在 Zustand 状态内 | 组件不 re-render；`teamRuntimeCache` 缓存失效检测遗漏此变更 |
| B13 | `daemonStore.ts:45` | `streamBuffer` 无上限，若 `completeStreamMessage` 未被调用则内存泄漏 | 长时间运行后内存持续增长 |
| B14 | `taskStore.ts:360-361` | `confirmBreakdown` 用 `tasks.length` 生成 TASK ID，删除任务后 ID 可能碰撞 | 重复 Task ID 导致数据混乱 |
| B15 | `taskStore.ts:413` | `confirmBreakdown` 内部 `roleMap` 与实际 agent/role 配置不同步 | 任务分配到错误角色 |
| B16 | `taskStore.ts:442` | `confirmBreakdown` 硬编码 `agentId: 'mario'` | 即使 Mario 不在 roster 中也强制分派给它 |
| B17 | `roleLayer.ts:33` | `roleCard.allowedActions.includes(...)` 若 `allowedActions` 为 undefined 则抛异常 | 含自定义 RoleCard 的 agent 执行时报错 |
| B18 | `teamPackLayer.ts:52-58` | `teamPack.rules.maxIterations` 若 `rules` 为 undefined 则抛异常 | TeamPack 无 rules 字段时 prompt 生成崩溃 |
| B19 | `projectStatusLayer.ts:14-18` | `STATUS_LABELS` 缺少 `in_review` 和 `blocked` 状态 | 这两种状态的任务在 prompt 中显示为 `undefined` |
| B20 | `ProjectCreateDialog.tsx:190` | `TEAM_MODE_CONFIG[pack.teamMode]` 对未知 teamMode 返回 undefined | 创建使用自定义 TeamMode 的项目时崩溃 |

### P2 — UX / 可用性问题

| # | 位置 | 问题 | 影响 |
|---|------|------|------|
| B21 | `ClientHome.tsx:24-26` | `loadFromServer().then(() => connectDaemon())` 无 `.catch()` | 初始化失败无错误提示 |
| B22 | `ProjectCreateDialog.tsx:87-101` | `createConversation` 失败后对话框仍关闭，用户输入丢失 | 创建失败无感知，需重新输入 |
| B23 | `TaskDetailPanel.tsx:416-426` | 删除任务无确认对话框 | 误点击直接删除 |
| B24 | `SettingsDrawer.tsx:1033-1039` | 删除 Account 无确认对话框 | 同上 |
| B25 | `GlobalChatRoom.tsx:83` | Task 引用正则 `#TASK-\d{3}` 只匹配 3 位数字 | 1 位、2 位或 4 位以上的 Task 编号无法识别 |
| B26 | `GlobalChatRoom.tsx:397` | textarea 高度用 `split('\n').length * 20` 计算，不考虑自动换行 | 长行消息高度计算错误 |
| B27 | `ProjectRightPanel.tsx:44-45` | `SyncStatusBar` 的相对时间不随时间更新 | "刚刚同步" 永远不变 |
| B28 | `AgentBindingPanel.tsx:296` | 使用 `--bg-secondary` CSS 变量但未在 globals.css 中定义 | 颜色渲染为无效值 |

---

## 三、数据模型一致性审计

### 前后端类型不匹配

| 前端字段 | 数据库字段 | 差异 | 风险 |
|---------|-----------|------|------|
| `Task.phaseId` | 不存在 | 前端使用但 DB 从未创建此列 | phase 信息仅存于内存，刷新丢失 |
| `ChatMessage.agentId` | `sender_id` + `sender_type` | 语义合并，类型不同 | 映射错误可能导致消息归属错乱 |
| `Task.artifacts` (强类型) | `artifacts` (TEXT/JSON) | 无 schema 校验 | 畸形 JSON 静默进入系统 |
| `Conversation.breakdownStatus` | 不存在 | 仅客户端 localStorage 持久化 | 多设备不同步 |
| DB `claimed_at`, `started_at`, `completed_at` 等 (migration v4) | repo 层 `TaskRow` 未包含 | 有数据但代码读不到 | 调度状态丢失 |

### 数据库 Schema 问题

| 问题 | 详情 |
|------|------|
| 无 CHECK 约束 | `task.status`, `conversation.status`, `invocation.status` 等枚举列无 CHECK，可插入非法值 |
| 无外键约束 | `chatMessage.conversationId`, `taskId`, `invocation.taskId`, `agent.roleCardId` 均无 REFERENCES |
| 缺少索引 | `task.agentId`, `chatMessage.senderId`, `agent_event.taskId`, `task.status` 无索引 |
| 冗余索引 | `agent_binding` 表 uniqueIndex + index 使用相同列 |
| 死列 | `conversation.participants` 定义但从未使用 |
| 迁移无回滚 | 所有迁移仅支持 forward，无 down migration |
| 迁移不幂等 | ALTER TABLE 语句若中途失败，版本号仍被记录为已应用 |

---

## 四、安全性审计

| 严重程度 | 漏洞 | 文件 |
|---------|------|------|
| **严重** | Shell 命令注入 — 用户输入拼入 shell 命令未转义 | `worktree-manager.ts` |
| **严重** | 路径遍历 — `resolvePath` 未校验 `realpath` | `worktree-manager.ts` |
| **严重** | tmux 模式命令注入 — session 名称和命令直接拼入 shell | `daemon.ts` |
| **高** | SSRF — `opencodeBridgeUrl` 直接用于 HTTP 请求 | `daemon.ts` |
| **中** | `dispatchToAgent` 全程通过 `any` 访问状态，无类型校验 | `daemonStore.ts` |
| **中** | `execution-envelope-repo.ts` nonce 仅 12 字节，非密码学安全 | `execution-envelope-repo.ts` |
| **中** | SQLite 外键默认 OFF，REFERENCES 约束形同虚设 | `db/schema.ts` |

---

## 五、性能问题

| 位置 | 问题 | 复杂度 | 建议 |
|------|------|--------|------|
| `taskHubStore.ts` `updateChatMessageStatus` | 遍历所有会话的所有消息查找单条 | O(C×M) | 用 Map 按 ID 索引 |
| `taskStore.ts` `getTaskById` | `tasks.find()` 线性扫描 | O(n) | 用 Map |
| `task-graph-repo.ts` `listActionsForTask` | 全表扫描后 JS 过滤 | O(n) | 加 WHERE 条件 |
| `team-pack-repo.ts` `list()` | N+1 查询 (每个 TeamPack 单独查角色) | O(N) | JOIN 查询 |
| `daemonStore.ts` `streamBuffer` | 无上限增长 | 内存泄漏 | 加 LRU 或 TTL |
| `taskStore.ts` `taskCounter` | 模块级共享变量 | 测试污染 | 用 store 内部状态 |
| `taskHubStore.ts` `selectPendingCount` | 每次渲染遍历所有 dispatch keys | O(n) | 用 selector 缓存 |

---

## 六、无障碍性 (Accessibility) 审计

| 类别 | 问题 | 涉及组件 |
|------|------|---------|
| 对话框 | 所有 dialog/drawer 缺少 `aria-modal="true"` | TaskDetailPanel, SettingsDrawer, ProjectCreateDialog, RoleCardEditor, RoleCardDetailDrawer |
| 标签页 | 所有 tab bar 缺少 ARIA 语义 (`role="tablist"/"tab"`, `aria-selected`) | SettingsDrawer, ProjectRightPanel, RoleCardDetailDrawer |
| 按钮 | close/edit/delete 按钮缺少 `aria-label` | 几乎所有对话框和面板 |
| 折叠面板 | 无 `aria-expanded` | CliOutputBlock, RoleCardEditor Collapsible |
| 键盘焦点 | 所有对话框无焦点陷阱，用户可 Tab 到背景元素 | 所有 dialog/drawer |
| 触控目标 | ProjectRightPanel toggle 宽仅 24px (WCAG 要求 44px) | ProjectRightPanel |
| 语言混用 | "CLI Trace" 英文，其余中文 | CliOutputBlock |

---

## 七、测试覆盖缺口

### 已覆盖模块（641 个 case）

| 模块 | 测试文件数 | 质量 |
|------|-----------|------|
| DB Repositories | ~12 | 高 — 使用真实内存 SQLite |
| A2A 协议 | ~5 | 中 — 3 个 case 失败 |
| Store 扩展 | ~4 | 中 |
| Prompt Composer | 1 | 中 |
| Worktree Manager | 1 | 中 |

### 未覆盖模块（0 测试）

| 模块 | 风险等级 | 原因 |
|------|---------|------|
| **daemon.ts** (630 行) | **极高** | 核心调度器，所有执行路径未测试 |
| **agent/factory.ts + adapters** | **极高** | Agent 后端选择和启动逻辑 |
| **所有 UI 组件** (60+ 组件) | **高** | 零组件测试 |
| **security-scanner.ts** | **高** | 安全关键路径 |
| **control-plane/** | **中** | 新增控制面，尚在开发 |
| **chat-message-extensions** | **中** | 部分覆盖 |

### 测试质量问题

1. **MiniKanban 测试崩溃**: `TouchSensor` 在 jsdom 中不可用，说明测试环境配置缺少 `@dnd-kit` 的 mock
2. **Mock 过于简单**: 大部分 store 测试 mock 了整个状态，未覆盖真实数据流
3. **无错误路径测试**: 几乎所有测试只验证 happy path
4. **脆弱的 ID 生成**: `Date.now()` 在测试中可能碰撞

---

## 八、体验 (UX) 视角评估

### 信息架构

| 问题 | 建议 |
|------|------|
| 创建任务按钮在无项目时 disabled，但无提示 | 加 tooltip: "请先创建或选择一个项目" |
| Task 引用只支持 3 位数字 | 改为 `#TASK-\d+` |
| 状态转换按钮展示所有可能状态 | 应限制为合法转换 (pending → in_progress, in_review → done/rejected) |
| "删除任务" 无确认 | 加二次确认 |
| "删除 Account" 无确认 | 加二次确认 |
| 对话框关闭丢失数据 (ProjectCreateDialog) | 创建失败时保持对话框打开 |

### 交互一致性

| 问题 | 详情 |
|------|------|
| 确认对话框不一致 | TeamPack 删除用 `confirm()`，Account/Task 删除无确认 |
| 语言混用 | "CLI Trace" (英文) vs "运行中" (中文) vs "Project Board" (英文) |
| 技能内容全英文 | `presetSkills/` 中的技能提示词是英文，UI 全中文，体验割裂 |
| 编辑保存不可取消 | TaskDetailPanel 编辑字段 `onBlur` 自动保存，无撤销机制 |

### 视觉一致性

| 问题 | 详情 |
|------|------|
| 无暗色模式 | `globals.css` 仅定义 `:root`，无 dark mode |
| 无效 CSS 变量 | `--bg-secondary` 在 AgentBindingPanel 使用但未定义 |
| textarea 自动增长计算不准确 | 不考虑长行自动换行 |

---

## 九、架构层面观察

### 模块级状态泄漏

`AGENT_ROSTER`、`streamBuffer`、`taskCounter` 等关键状态存在于 Zustand 之外的模块级变量中：
- 不参与 Zustand 的 re-render 机制
- 不被 DevTools 追踪
- `teamRuntimeCache` 的缓存失效检测遗漏这些变更
- SSR 场景下跨请求污染

### 单体 Store 过大

`taskHubStore.ts` 有 **2149 行**，承担了所有 slice 组合，且 `set` 回调全部通过 `any` 访问：
- 无法在编译期捕获类型错误
- 难以理解和维护
- `addChatMessage` 单个方法 140 行，处理 7 种不同职责

### `simulateCliExecution` 代码重复

与 `dispatchToAgent` 有 90% 代码重复，违反 DRY。任何修复需要同步两处。

---

## 十、优先修复建议

### 立即修复 (P0)

1. **安全漏洞**: `worktree-manager.ts` 和 `daemon.ts` 的命令注入和路径遍历
2. **数据丢失风险**: `loadFromServer` localStorage 迁移的错误处理
3. **崩溃修复**: `artifactIcons[art.type]`、`profile?.prompt.roleCard`、`allowedActions.includes()` 的 null guard
4. **A2A 集成测试**: 修复 3 个失败的 manual-verify case

### 短期修复 (P1)

5. 补全缺失的数据库外键约束和 CHECK 约束
6. 为 `JSON.parse` 调用添加 try/catch
7. 修复 `AGENT_ROSTER` 模块级状态问题
8. 补全 `STATUS_LABELS` 的 `in_review` 和 `blocked`
9. 修复 Task ID 碰撞风险 (`confirmBreakdown`)

### 中期改进 (P2)

10. 补全 UI 组件的 ARIA 语义
11. 为关键操作添加确认对话框
12. 补全 daemon.ts 和 agent/factory 的测试覆盖
13. 修复 Task 引用正则为 `#TASK-\d+`
14. 添加关键数据库索引

---

*报告结束。共发现 28 个 Bug（8 P0, 12 P1, 8 P2）、7 个安全问题、7 个性能问题、10+ 无障碍性缺口、60+ 未覆盖组件。*
