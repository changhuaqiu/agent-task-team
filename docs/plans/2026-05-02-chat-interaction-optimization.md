# 聊天页面交互优化实施报告

## 概述

聊天页面存在两大类问题：**Agent 消息管道断裂**（agent 无法顺利返回信息）和**消息展示体验差**（一次对话信息展示不完整）。本文档基于对 `src/store/taskHubStore.ts`、`src/server/daemon.ts`、`src/components/task-hub/` 全链路代码审查，以及 [multica-ai/multica](https://github.com/multica-ai/multica) 同类项目的对比分析，给出 8 个具体修复任务。

每个任务包含：问题定位（文件+行号）、根因分析、修复方案、验证标准。任务之间无硬依赖，可并行执行。

---

## 任务一览

| # | 任务 | 文件 | 严重度 | 类型 |
|---|------|------|--------|------|
| T1 | 自动滚动尊重用户位置 | `GlobalChatRoom.tsx` | 🔴 Critical | UX |
| T2 | Daemon 发送 'done' 事件 | `daemon.ts` | 🔴 Critical | 管道 |
| T3 | Stream 超时保护（看门狗） | `taskHubStore.ts` | 🔴 Critical | 管道 |
| T4 | Silent 'Agent busy' 错误触发 dequeue | `taskHubStore.ts` | 🟡 High | 管道 |
| T5 | forwardAgentEvent 加错误处理 | `daemon.ts` | 🟡 High | 管道 |
| T6 | CliOutputBlock 可展开 | `CliOutputBlock.tsx` | 🟡 High | UX |
| T7 | 流式内容防抖 | `taskHubStore.ts` | 🟢 Medium | 性能 |
| T8 | Agent 消息分组默认展开策略优化 | `GlobalChatRoom.tsx` | 🟢 Medium | UX |

---

## T1: 自动滚动尊重用户位置

**严重度**: 🔴 Critical
**文件**: `src/components/task-hub/GlobalChatRoom.tsx`
**问题行**: 40-44

### 现状

```typescript
// 当前实现：每次 chatMessages 变化都强制跳到底部
useEffect(() => {
  if (scrollRef.current) {
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }
}, [chatMessages]);
```

### 问题

- 每次流式内容更新（每个 socket event）都触发 scrollTop 赋值
- 用户上翻查看历史消息时被强制拉回底部
- 无 smooth scroll，体验生硬

### 修复方案

参考 Multica 的 `useAutoScroll` 模式，用 ResizeObserver + MutationObserver 代替 useEffect：

```typescript
// 新增 hook: src/hooks/useAutoScroll.ts
import { useEffect, useRef, type RefObject } from 'react';

export function useAutoScroll(ref: RefObject<HTMLElement | null>) {
  const stickRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const scrollToBottom = () => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    };

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      // 距底部 50px 以内时视为"贴底"
      stickRef.current = scrollHeight - scrollTop - clientHeight < 50;
    };

    const onContentChange = () => {
      if (stickRef.current) scrollToBottom();
    };

    // 监听子元素尺寸变化（流式内容增长）
    const ro = new ResizeObserver(onContentChange);
    for (const child of el.children) ro.observe(child);

    // 监听新消息添加
    const mo = new MutationObserver(onContentChange);
    mo.observe(el, { childList: true, subtree: true });

    el.addEventListener('scroll', onScroll, { passive: true });
    scrollToBottom(); // 初始滚动

    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, [ref]);
}
```

### 改动点

1. 新建 `src/hooks/useAutoScroll.ts`
2. `GlobalChatRoom.tsx` 删除原来的 useEffect（40-44行），替换为：

```typescript
import { useAutoScroll } from '@/hooks/useAutoScroll';
// 在组件内：
useAutoScroll(scrollRef);
```

### 验证

- [ ] Agent 流式输出时自动滚到底部
- [ ] 用户手动上翻后，不被拉回底部
- [ ] 用户滚回底部后，恢复自动跟随
- [ ] 新消息到来时，如果用户在底部则跟随

---

## T2: Daemon 发送 'done' 事件

**严重度**: 🔴 Critical
**文件**: `src/server/daemon.ts`

### 问题

当前 daemon 的 agent 事件循环结束后，**只依赖 `terminal:exit` 事件来关闭流**。客户端 `taskHubStore.ts:1868-1871` 有 `type === 'done'` 的处理分支，但 daemon 从未发送过这个事件。

如果进程异常退出且 `terminal:exit` 未触发（如 socket 断开），流消息永远卡在 `isStreaming: true`。

### 修复方案

在 daemon 的事件循环中，当 backend 返回的 async generator 完成时，显式发送 `done` 事件。

找到 daemon 中读取 backend 事件的位置（大约在 `forwardAgentEvent` 循环之后），添加：

```typescript
// 在事件循环结束后，发送 done 事件
socket.emit('agent:event', {
  taskId,
  agentId,
  type: 'done',
  content: '',
  sessionId: currentSessionId,
  conversationId: sessionConvId,
});
```

同时在 `terminal:exit` handler（客户端 `taskHubStore.ts:1967`）中添加幂等保护：

```typescript
// terminal:exit handler 中已有的 completeStreamMessage 调用保留
// 但在 completeStreamMessage 内部加判断：
completeStreamMessage: (agentId) => {
  const activeId = get().activeStreamMessageId[agentId];
  if (!activeId) return; // 已经 complete 过，跳过
  // ... 后续逻辑不变
}
```

### 验证

- [ ] Agent 正常完成后，客户端先收到 `type: 'done'` → 流关闭
- [ ] `terminal:exit` 随后到达 → `completeStreamMessage` 幂等跳过
- [ ] 如果 `terminal:exit` 丢失，`done` 事件仍能关闭流

---

## T3: Stream 超时保护（看门狗）

**严重度**: 🔴 Critical
**文件**: `src/store/taskHubStore.ts`

### 问题

如果 agent 进程崩溃且 `terminal:exit` 和 `done` 都没触发，流消息永远卡在 `isStreaming: true`（显示永久脉冲圆点），Agent 状态卡在 `busy`，无法 dispatch 新消息。

### 修复方案

在 `ensureStreamMessage` 创建流消息时启动定时器，超时后自动关闭流并标记 Agent 为 idle。

```typescript
// 在 ensureStreamMessage 函数中添加：
ensureStreamMessage: (agentId, conversationId) => {
  // ... 原有创建逻辑 ...

  // 启动看门狗（60 秒无更新则超时）
  if (streamWatchdogs[agentId]) clearTimeout(streamWatchdogs[agentId]);
  streamWatchdogs[agentId] = setTimeout(() => {
    const state = get();
    if (state.activeStreamMessageId[agentId]) {
      console.warn(`[watchdog] Stream for ${agentId} timed out, auto-completing`);
      get().completeStreamMessage(agentId);
      // 恢复 agent 状态
      useTaskHubStore.setState((s) => ({
        agentStatus: { ...s.agentStatus, [agentId]: 'idle' },
        activeRunsByAgent: { ...s.activeRunsByAgent, [agentId]: undefined },
      }));
    }
  }, 60_000); // 60 秒

  return id;
},
```

在 `appendToStreamMessage` 中重置定时器：

```typescript
appendToStreamMessage: (messageId, patch) => {
  // ... 原有逻辑 ...

  // 重置看门狗
  const agentId = Object.entries(get().activeStreamMessageId).find(
    ([_, id]) => id === messageId
  )?.[0];
  if (agentId && streamWatchdogs[agentId]) {
    clearTimeout(streamWatchdogs[agentId]);
    streamWatchdogs[agentId] = setTimeout(/* 同上 */, 60_000);
  }
},
```

在 `completeStreamMessage` 中清除定时器：

```typescript
completeStreamMessage: (agentId) => {
  if (streamWatchdogs[agentId]) {
    clearTimeout(streamWatchdogs[agentId]);
    delete streamWatchdogs[agentId];
  }
  // ... 原有逻辑 ...
},
```

需要在 store 文件顶部声明：

```typescript
const streamWatchdogs: Record<string, ReturnType<typeof setTimeout>> = {};
```

### 验证

- [ ] 正常流程下看门狗不触发
- [ ] 模拟进程崩溃（不触发 done/terminal:exit），60 秒后流自动关闭
- [ ] 超时后 Agent 状态恢复为 idle
- [ ] 超时后可正常 dispatch 新消息

---

## T4: Silent 'Agent busy' 错误触发 dequeue

**严重度**: 🟡 High
**文件**: `src/store/taskHubStore.ts`
**问题行**: 1984-1996

### 现状

```typescript
socket.on('agent:error', ({ agentId, message, reasonCode }) => {
  if (message === 'Agent is busy, message queued') {
    // 静默返回 —— 排队消息永远不会被自动发送
    return;
  }
  // ...
});
```

### 问题

Daemon 拒绝 dispatch 时（agent 正忙），客户端只更新了 pendingDispatches 状态但**不触发 dequeue**。排队消息永远不会自动发送，除非用户手动操作或 agent 下一个 `terminal:exit` 触发 dequeue。

更糟糕的是，如果 agent 在 daemon 侧已经空闲（进程退出但 terminal:exit 没到达客户端），排队的消息会永远积压。

### 修复方案

```typescript
socket.on('agent:error', ({ agentId, message, reasonCode }) => {
  if (message === 'Agent is busy, message queued') {
    // 不只是静默返回，而是确保 pending 状态已更新
    // 并且在 agent 空闲时尝试 dequeue
    const state = useTaskHubStore.getState();
    const pending = state.pendingDispatches[agentId];
    if (pending && pending.length > 0) {
      // 延迟 1 秒后重试（等当前 agent 任务完成）
      setTimeout(() => {
        const currentState = useTaskHubStore.getState();
        const agentStatus = currentState.agentStatus[agentId];
        if (agentStatus === 'idle') {
          currentState.dequeueNextPending(agentId);
        }
      }, 1000);
    }
    return;
  }
  // ... 原有错误处理 ...
});
```

### 验证

- [ ] 连续发两条消息给同一 agent，第一条执行中，第二条自动排队
- [ ] 第一条完成后，第二条自动 dequeue 执行
- [ ] Agent 忙时收到 error 后，1 秒后检查状态并重试

---

## T5: forwardAgentEvent 加错误处理

**严重度**: 🟡 High
**文件**: `src/server/daemon.ts`
**问题行**: 340-376

### 问题

`forwardAgentEvent()` 函数中 `socket.emit()` 和 `messageRepo.append()` 都没有 try-catch。socket 断开或 DB 写入失败时，事件静默丢失，无任何日志或重试。

### 修复方案

```typescript
async function forwardAgentEvent(event: AgentEvent, taskId: string, agentId: string, /* ... */) {
  try {
    // 发送到客户端
    socket.emit('agent:event', {
      taskId, agentId, type: event.type, content: event.content,
      tool: event.tool, usage: event.usage, sessionId: event.sessionId,
      conversationId: sessionConvId,
    });
  } catch (err) {
    console.error(`[daemon] Failed to emit agent:event for task ${taskId}:`, err);
  }

  // 持久化到 DB
  if (event.type === 'text' && event.content) {
    try {
      await messageRepo.append({
        conversationId: sessionConvId,
        taskId,
        senderType: 'agent',
        senderId: agentId,
        content: event.content,
        contentType: 'text',
      });
    } catch (err) {
      console.error(`[daemon] Failed to persist message for task ${taskId}:`, err);
    }
  }

  // 同理处理 tool_use 等其他类型
}
```

### 验证

- [ ] 正常流程不受影响
- [ ] Socket 断开时控制台有错误日志，不崩溃
- [ ] DB 写入失败时控制台有错误日志，后续事件继续处理

---

## T6: CliOutputBlock 可展开

**严重度**: 🟡 High
**文件**: `src/components/task-hub/CliOutputBlock.tsx`
**问题行**: 约 152 行（`maxHeight: 200`）

### 现状

```typescript
<div style={{ maxHeight: 200, overflowY: 'auto' }}>
  {events.map((event, i) => <ToolRow ... />)}
</div>
```

### 问题

- 固定 200px 高度截断长输出
- 无展开/收起按钮
- 嵌套滚动区域（CliOutputBlock 内部滚动 + 页面滚动）

### 修复方案

```typescript
export function CliOutputBlock({ events, isStreaming }: CliOutputBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const COLLAPSED_HEIGHT = 200;
  const needsExpand = events.length > 5 || /* 估算内容高度 */ false;

  return (
    <div className="mt-2">
      <div
        className="overflow-hidden transition-[max-height] duration-200"
        style={{ maxHeight: expanded ? 'none' : COLLAPSED_HEIGHT }}
      >
        {events.map((event, i) => (
          <ToolRow key={i} event={event} />
        ))}
      </div>

      {needsExpand && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full text-[9px] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--accent))] py-1 text-center border-t border-[hsl(var(--border-subtle))] transition-colors"
        >
          ▼ 展开全部 ({events.length} 条)
        </button>
      )}
      {expanded && (
        <button
          onClick={() => setExpanded(false)}
          className="w-full text-[9px] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--accent))] py-1 text-center border-t border-[hsl(var(--border-subtle))] transition-colors"
        >
          ▲ 收起
        </button>
      )}
    </div>
  );
}
```

如果事件数量 > 5，默认折叠并显示展开按钮。流式状态下（`isStreaming`）自动展开。

### 验证

- [ ] 少量 tool events（<=5）正常显示，无展开按钮
- [ ] 大量 tool events 默认折叠，显示数量和展开按钮
- [ ] 流式状态下自动展开
- [ ] 点击展开/收起正常工作

---

## T7: 流式内容防抖

**严重度**: 🟢 Medium
**文件**: `src/store/taskHubStore.ts`
**问题行**: 1487

### 现状

```typescript
// 每个socket event直接拼接，无防抖
content: patch.content != null ? m.content + patch.content : m.content,
```

### 问题

高频 socket event（如 CLI 快速输出）导致每个 event 触发一次 React 重渲染。长输出可能产生数百次重渲染，造成 UI 闪烁和卡顿。

### 修复方案

在 store 外部维护一个 content buffer，用 requestAnimationFrame 批量刷新：

```typescript
// 在 store 文件顶部
const streamBuffer: Record<string, string> = {};
let bufferFlushScheduled = false;

function scheduleBufferFlush() {
  if (bufferFlushScheduled) return;
  bufferFlushScheduled = true;
  requestAnimationFrame(() => {
    bufferFlushScheduled = false;
    const state = useTaskHubStore.getState();
    for (const [messageId, pending] of Object.entries(streamBuffer)) {
      if (!pending) continue;
      // 批量应用到 store
      applyBufferedContent(state, messageId, pending);
      delete streamBuffer[messageId];
    }
  });
}
```

在 `appendToStreamMessage` 中改为缓冲：

```typescript
appendToStreamMessage: (messageId, patch) => {
  if (patch.content != null) {
    // 不直接 set，而是写入 buffer
    streamBuffer[messageId] = (streamBuffer[messageId] || '') + patch.content;
    scheduleBufferFlush();
  }
  // toolEvent 和其他字段仍然直接 set（频率低）
  if (patch.toolEvent) {
    set(/* 原有 toolEvent 逻辑 */);
  }
},
```

### 验证

- [ ] 快速流式输出时 UI 不闪烁
- [ ] 最终内容完整（无丢字）
- [ ] Tool events 正常显示

---

## T8: Agent 消息分组默认展开策略优化

**严重度**: 🟢 Medium
**文件**: `src/components/task-hub/GlobalChatRoom.tsx`
**问题行**: 238-245

### 现状

```typescript
<MessageGroup
  messages={group.messages}
  defaultExpanded={isLatestGroup}  // 只有最新组展开
/>
```

### 问题

- 旧消息全部折叠，用户需要手动展开每组才能看到历史
- 包含 `isStreaming: true` 消息的组也可能被折叠

### 修复方案

```typescript
<MessageGroup
  messages={group.messages}
  defaultExpanded={
    isLatestGroup || 
    group.messages.some(m => m.isStreaming)  // 有流式消息的组始终展开
  }
/>
```

同时在 `MessageGroup.tsx` 中添加"全部展开/收起"的能力：

```typescript
interface MessageGroupProps {
  messages: ChatMessage[];
  themeColor: string;
  agentEmoji: string;
  agentName: string;
  defaultExpanded: boolean;
  forceExpand?: boolean;  // 新增：外部控制
}

export function MessageGroup({ messages, ..., forceExpand }: MessageGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // 外部强制展开
  useEffect(() => {
    if (forceExpand && !expanded) setExpanded(true);
  }, [forceExpand]);
  
  // ... 其余不变
}
```

### 验证

- [ ] 有流式消息的组自动展开
- [ ] 最新组始终展开
- [ ] 旧组默认折叠

---

## 实施建议

### 执行顺序

```
第一批（管道修复，可并行）:  T2 + T3 + T4 + T5
第二批（UX 修复，可并行）:   T1 + T6
第三批（优化，可并行）:      T7 + T8
```

### 风险点

- T3（看门狗）的超时时间需根据实际 Agent 执行时长调整，建议从 60 秒开始
- T7（防抖）需要确认 `requestAnimationFrame` 在所有环境下可用（Electron/浏览器均可）
- 所有管道修复（T2-T5）修改后需端到端测试：发送消息 → agent 执行 → 消息流式返回 → 完成

### 测试验证

每个 task 完成后验证：
1. 发送普通消息给 agent → 收到回复 ✅
2. 发送长任务给 agent → 流式输出正常 ✅
3. 连续发多条给同一 agent → 排队和 dequeue 正常 ✅
4. 模拟 agent 崩溃 → 看门狗超时关闭流 ✅
5. 上翻查看历史 → 不被拉回底部 ✅
6. 长 tool 输出 → 可展开查看 ✅
