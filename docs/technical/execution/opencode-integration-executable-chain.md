# 计划：确保 Task Hub ↔ OpenCode 链路可执行（Default Project）

## Summary

目标：让用户在默认指挥室（`default`）下，能够完成以下完整链路，并在 UI 中可验证：

1. 从角色池引入角色（Invite Agent）
2. 创建任务并分配给某个角色（Create Task + Assign）
3. 人类在聊天室 @ 角色进行对话（Chat Mention）
4. 系统按“人物=OpenCode Session”的模型，首次激活时获取真实 `sessionID (ses_...)`，后续复用该会话继续执行

约束：不使用 mock CLI；必须对接真实 `opencode`。

---

## Current State Analysis（基于仓库现状）

### 现有关键实现点

- 单端口开发模式：`pnpm dev` 通过 [`server-dev.js`](file:///workspace/server-dev.js) 在 `:3000` 同时启动 Next + Socket.io daemon，避免浏览器端 `localhost:4000` 无法访问的问题。
- Socket 客户端默认同源连接：[`taskHubStore.ts`](file:///workspace/src/store/taskHubStore.ts#L1-L6) 使用 `io()`；也支持 `NEXT_PUBLIC_DAEMON_URL` 覆盖。
- 后端 daemon：[`backend/daemon.js`](file:///workspace/backend/daemon.js)
  - `terminal:start` → `spawn('opencode', ['run', prompt, '--format','json', ...])`
  - `readline` 逐行解析 NDJSON
  - 捕获 `sessionID` 并 emit `agent:session`
- 前端 session 存储：[`taskHubStore.ts`](file:///workspace/src/store/taskHubStore.ts)
  - `selectedProjectId: 'default'`
  - `agentSessions.default[agentId] = 'ses_...'`
  - `activateAgent()`：当未激活时触发一次 `terminal:start` 以获取 session
  - `addTask()`：创建任务后自动激活 assignee
  - `addChatMessage()`：人类消息中 `@agent` 会触发激活（仅未激活时）

### 现状问题（导致“链路不可执行”的主要风险）

1. **“激活”与“执行任务/对话”尚未统一**  
   当前 `activateAgent()` 只负责“拿 session”，但用户真实意图是：分配任务/对话时，不仅拿 session，还要把内容作为该人物在该项目里的工作上下文的一部分（即继续该 session 进行一次实际 run）。

2. **缺少明确的“对话路由到人物”的动作语义**  
   用户视角只有“任务/人物/对话”。目前只有 `@mention` 会触发激活，但未形成“给人物发消息 → 人物回应”的明确链路（尤其是在人物已激活情况下）。

3. **任务推进（状态流转）没有触发执行**  
   `TaskDetailPanel` 的状态按钮目前仅修改状态，不会触发“让人物开始干活”的执行动作；同时调试按钮默认隐藏，这会让用户感觉“没有入口”。

---

## Proposed Changes（确保链路可执行的改造方案）

### A. 统一三类动作到一个入口：`dispatchToAgent()`

在 [`src/store/taskHubStore.ts`](file:///workspace/src/store/taskHubStore.ts) 增加一个单一动作（名称示例）：

- `dispatchToAgent({ projectId, agentId, referencedTaskId?, prompt, purpose })`

行为：

1. 若 `(projectId, agentId)` 尚无 session：
   - 触发一次 `opencode run`（不带 `--session`），prompt 采用“激活 + 首条指令”的合并模板
   - 从 NDJSON 捕获 `sessionID` 并持久化
2. 若已有 session：
   - 触发一次 `opencode run --session <ses_...>`，把 prompt 作为继续会话的一轮输入

目的：把“激活”和“执行”合并为同一条可理解的行为：**给人物发一条指令**。

### B. 让“创建任务/分配人物/对话 @ 人物/任务 Start”都走 `dispatchToAgent()`

#### 1) 创建任务（New Task）

文件：[`src/components/task-hub/NewTaskDialog.tsx`](file:///workspace/src/components/task-hub/NewTaskDialog.tsx) + store

- `addTask()` 仍创建任务
- 随后调用 `dispatchToAgent()`，prompt 模板建议：
  - `You are {agentName}. You are assigned TASK-xxx: {title}. {description}. Reply with your plan and next steps.`

#### 2) 重新分配人物（Update Task assignee）

文件：[`taskHubStore.ts`](file:///workspace/src/store/taskHubStore.ts)

- `updateTask()` 若 `agentId` 变化，调用 `dispatchToAgent()` 给新 assignee 发送“接手任务”的指令。

#### 3) 聊天 @ 人物

文件：[`src/components/task-hub/GlobalChatRoom.tsx`](file:///workspace/src/components/task-hub/GlobalChatRoom.tsx) + store

- 当前 `addChatMessage()` 已能解析 mentions
- 改为：对 `@agent` 的人类消息调用 `dispatchToAgent()`（不只是激活）。  
  这样用户一句话就能驱动人物真正执行/回应。

#### 4) 任务 Start（状态切到 `in_progress`）

文件：[`src/components/task-hub/TaskDetailPanel.tsx`](file:///workspace/src/components/task-hub/TaskDetailPanel.tsx) + store

- 当用户点 `Start`（或切到 `in_progress`）时触发 `dispatchToAgent()`，prompt 为“开始执行该任务”
- 这样即使没有 “Run Opencode” 按钮，用户也能通过任务语义驱动执行。

### C. 事件与 UI 可观测性（让用户知道发生了什么）

#### 1) Session 激活提示（系统消息）

文件：[`taskHubStore.ts`](file:///workspace/src/store/taskHubStore.ts)

- 当收到 `agent:session` 并落库后，向 `chatMessages` 插入一条系统消息（例如 agentId=该角色 or system），内容：`[default] {agentId} session activated: ses_...`
- 目的：用户能够确认“首次激活确实拿到了 session”

#### 2) 终端命令可见

后端已在 `terminal:data` 首行写入 `$ opencode run ...`，保留即可，用来验证第二次执行是否带了 `--session ses_...`。

---

## Assumptions & Decisions

- 项目/指挥室：当前仅实现 `selectedProjectId='default'`，不做 UI 切换（按你的要求）。
- sessionId 来源：完全由 opencode NDJSON 输出提供（`sessionID` / `part.sessionID`），不由 Hub 生成。
- 角色激活时机：当“分配任务”或“对话 @ 角色”或“任务 Start”发生时激活，并直接把该动作的 prompt 作为第一轮输入。
- 不使用 mock：后端始终使用 `spawn('opencode', ...)`。

---

## Verification（必须可复现的验收步骤）

### 1) 启动

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:3000`。

### 2) 创建任务 → 触发人物执行

1. 点击 New Task
2. 输入 title/description，Assign To 选择一个未激活人物（例如 zhongli），Create Task
3. 预期：
   - 终端区出现 `$ opencode run ... --format json`（第一次不带 `--session`）
   - 聊天区出现“session activated: ses_...” 的系统提示

### 3) 再次对同一人物发消息 → 复用 session

1. 在 Global Chat 输入：`@zhongli 请继续 TASK-xxx，给出下一步`
2. 预期：
   - 终端区出现 `$ opencode run ... --session ses_... --format json`
   - chat 中出现 zhongli 的回复事件（text/tool_use 映射）

### 4) 任务 Start 驱动执行（无 Run 按钮也能跑）

1. 打开某任务详情，点击 Start
2. 预期：同样触发一次 `dispatchToAgent()`（若未激活则激活并执行；若已激活则继续会话执行）

