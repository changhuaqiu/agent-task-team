# Agent 间通信 (A2A) 设计

> 日期：2026-05-04
> 状态：已确认
> 范围：agent-to-agent @mention 消息 + 任务交接通信

## 问题

当前 agent 间没有真正的通信机制。Mario 在 `.ath/TASKS.md` 表格里写 `@luigi` 只是"写文档"，不是派活。Luigi 不会收到通知，看板不会刷新，跨 agent 通信链路没有建立。

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 通信级别 | 任务交接 + @mention 自由消息 | 两种场景都需要 |
| 存储载体 | SQLite 专用 `agent_mailbox` 表 | 零新依赖，持久化，独立演进 |
| 用户可见性 | 全部可见 | 方便 debug，保持透明 |
| 触发时机 | agent 回复结束后扫描 | 目标 agent 拿到完整上下文 |
| 忙碌处理 | 排队等完成后自动 dispatch | 复用现有 `enqueueDispatch()` |
| 上下文传递 | 发送方回复 + 任务上下文 | 平衡理解质量和 token 消耗 |
| 架构方案 | Daemon 内建 A2A 模块 | 最快落地，零新依赖 |

## 数据模型

### `agent_mailbox` 表

```sql
CREATE TABLE agent_mailbox (
  id TEXT PRIMARY KEY,              -- sortable ID
  conversation_id TEXT NOT NULL,    -- 所属项目/会话
  from_agent_id TEXT NOT NULL,      -- 发送方 agent
  to_agent_id TEXT NOT NULL,        -- 接收方 agent
  trigger_message_id TEXT,          -- 触发此投递的 chat_message ID
  task_id TEXT,                     -- 关联任务（nullable）
  content TEXT NOT NULL,            -- 发送方的回复内容
  context_snapshot TEXT,            -- JSON: 任务上下文快照
  status TEXT NOT NULL DEFAULT 'pending',  -- pending → delivered → processed / expired
  chain_depth INTEGER NOT NULL DEFAULT 0,
  a2a_from TEXT,                    -- 上游 agent（用于提示）
  source TEXT NOT NULL DEFAULT 'a2a',  -- 'a2a' 标识来源
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversation(id),
  FOREIGN KEY (from_agent_id) REFERENCES agent(id),
  FOREIGN KEY (to_agent_id) REFERENCES agent(id)
);
```

`agent_mailbox` 是路由和投递记录，不是消息内容。agent 的输出已存在 `chat_message`（`sender_type='agent'`）。mailbox 只管"谁给谁发了什么、投递状态如何"。

## 模块结构

高内聚低耦合。A2A 逻辑集中在 `src/server/a2a/`，daemon 通过单一接口调用。

```
src/server/a2a/
  ├── index.ts          # AgentMessenger 类，唯一出口
  ├── scanner.ts        # @mention 解析和提取
  ├── mailbox.ts        # agent_mailbox 表的 CRUD
  ├── router.ts         # 路由决策、链深度检查、ping-pong 防护
  ├── queue.ts          # 排队和自动 dispatch（复用 enqueueDispatch）
  └── types.ts          # 内部类型定义
```

### 依赖方向

```
daemon → AgentMessenger.onAgentResponse()
              │
              ▼
         scanner → router → mailbox → queue
```

daemon 不直接 import scanner、mailbox、router。A2A 内部实现变更不影响 daemon。

### AgentMessenger 接口

```typescript
interface ResponseContext {
  conversationId: string;
  taskId?: string;
  chainDepth: number;
}

class AgentMessenger {
  // agent 回复结束后，daemon 调用此方法
  async onAgentResponse(agentId: string, response: string, ctx: ResponseContext): Promise<void>
}
```

## 核心流程

```
1. Mario 完成回复，CLI 输出结束
2. daemon.forwardAgentEvent() 持久化到 chat_message
3. daemon 调用 messenger.onAgentResponse('mario', fullResponse, ctx)
4. scanner: 从 fullResponse 提取 @mention → [{target:'luigi', position}]
5. router: 检查链深度 < 阈值, ping-pong 计数, 目标是否有效
6. mailbox: 写 agent_mailbox 记录（status=pending）
7. 判断 Luigi 是否忙碌：
   ├── 空闲 → 立即 dispatch
   │         queue: 调用 daemonStore.enqueueDispatch()（source='a2a'）
   │         prompt 注入 a2a 上下文
   │         mailbox: 更新 status=delivered
   └── 忙碌 → 排队
             queue: 调用 daemonStore.enqueueDispatch()
             terminal:exit 时 dequeueNextPending() 自动执行
```

## 排队机制

复用现有 `daemonStore.enqueueDispatch()` 和 `dequeueNextPending()`，不做两套队列。

- A2A dispatch 的 `source` 字段为 `'a2a'`（现有为 `'user'`）
- UI 在排队卡片上区分来源："Mario 转交" vs "用户发送"
- 优先级：用户消息 > A2A 消息
- `dequeueNextPending()` 逻辑不变，按优先级取下一个

## @mention 扫描规则

| 规则 | 说明 |
|------|------|
| 行首匹配 | 只扫描行首的 `@name`，跳过代码块后的行内 mention |
| 代码块跳过 | ` ``` ` 包裹的内容不扫描 |
| 最长匹配 | `@luigi` 优先于 `@l`，避免前缀冲突 |
| 自提及过滤 | agent 不会因写了自己的名字而触发 |
| 目标上限 | 单次回复最多触发 2 个 agent |
| 深度上限 | 链深度 ≤ 10 |

解析来源从 `agentStore` 的 `AGENT_ROLES` 拿 agent 列表和 mention patterns。

不复用现有 `mention-parser.ts`（那是给用户消息的全文匹配，规则不同）。

## 安全机制

### Ping-Pong 防护

| 同对 agent 连续互 @ 次数 | 动作 |
|-------------------------|------|
| ≥ 2 | 注入警告到 agent prompt |
| ≥ 4 | 阻止投递，不 dispatch，通知用户 |

有实质工作重置：tool_use 调用或输出 >200 字符不算 ping-pong。

### 链深度熔断

- 深度 > 10 自动终止
- 写系统消息通知用户介入

### 忙碌优先级

- 用户 dispatch 优先于 A2A dispatch

### 超时清理

- `status=pending` 超过 30 分钟 → `expired`
- daemon 启动时清理一次

## PromptComposer 集成

新增 `src/lib/agent-context/layers/a2aLayer.ts`。

仅在 `source === 'a2a'` 时注入，普通 dispatch 返回空字符串。

插入位置：`taskContext` layer 之后。

注入内容示例：

```
═══ 跨角色协作消息 ═══
来自：Mario（架构规划）
消息内容：
  [Mario 的完整回复]

当前任务上下文：
  任务：实现用户认证 API
  状态：in_progress
  前序决策：已确定使用 JWT + Redis session 双模式

请根据以上信息继续工作。
═════════════════════
```

## UI 变更

### 聊天流

A2A 触发的回复和普通回复一样展示在聊天流中。加一个灰色标签区分来源：

```
[Mario → Luigi]  ← 灰色小标签
  Luigi 的回复内容...
```

### 排队卡片

现有排队 UI 加 `source` 标识：

```
🔵 Luigi — "实现登录接口"         ← 用户发送
🔀 Luigi ← Mario — "接口设计需调整" ← A2A 转交
```

### Mailbox 可视化

当前不做。后续迭代可加独立页面查看投递记录。

## daemon 改动点

daemon.ts 只改两处：

1. **agent 回复结束后**：在 `forwardAgentEvent` 完成后加 `messenger.onAgentResponse()`
2. **agent 进程退出后**：`terminal:exit` handler 中 `dequeueNextPending()` 已有逻辑不变，A2A 排队项自然被消费

## 测试策略

| 模块 | 测试方式 |
|------|---------|
| scanner | 单元测试：各种 @mention 模式的提取和过滤 |
| router | 单元测试：链深度、ping-pong、目标上限 |
| mailbox | 单元测试：CRUD + 状态转换 |
| queue | 集成测试：忙碌排队 → 空闲自动 dispatch |
| 端到端 | Mario @Luigi → Luigi 收到消息并回复 |
