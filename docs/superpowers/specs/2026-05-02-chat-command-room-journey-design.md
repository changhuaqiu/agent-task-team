# 聊天作战指挥室 — 用户旅程优化设计

> 日期: 2026-05-02
> 状态: 待实现
> 范围: 中间列聊天面板（ProjectChatPanel / GlobalChatRoom / ChatMessageItem / AgentBar）
> 约束: 三列布局不变、JRPG 像素风格不变、Agent 人设不变、任务 6 状态模型不变

---

## 1. 现有旅程地图

聊天作战指挥室（中间列）的用户旅程分为 7 个阶段：

| # | 阶段 | 触发 | 用户看到 | 用户行为 |
|---|------|------|---------|---------|
| 0 | 未选项目 | 打开应用 | "请选择一个项目" 提示，输入框 disabled | 去左侧创建项目 |
| 1 | 空聊天 | 选中项目 | 空白点阵背景，AgentBar（可能有 Agent），输入框启用 | 输入第一条指令 |
| 2 | Jean 拆解 | 用户发消息 | Header "⚔️ Jean 正在拆解…"，Jean 回复含阶段拆解卡片（勾选 + Agent 分配 + 确认按钮） | 勾选任务 → 确认 |
| 3 | 确认拆解 | 点确认 | Header "N 阶段 · M 任务 · 待确认"，任务创建到 Store，看板更新 | 等待 / 追加指令 |
| 4 | 执行中 | Agent 开始工作 | Header 计数变化，右侧看板更新，聊天几乎无反馈 | 监控进度 |
| 5 | 审批请求 | Agent 提交产出 | 带 同意/拒绝 按钮的审批消息 | 审查后决策 |
| 6 | 日常使用 | 持续对话 | 消息滚动，@提及高亮，任务引用链接，意图徽章 | 指挥 / 追问 / 调整 |

---

## 2. 问题诊断

| # | 问题 | 阶段 | 严重度 |
|---|------|------|--------|
| P1 | 输入框未选项目时 disabled，零入口 | 0 | 高 |
| P2 | 冷启动无引导，只有灰色文字 | 0 | 高 |
| P3 | 选中项目后聊天空白，不知道第一步做什么 | 1 | 高 |
| P4 | Jean 介入触发机制不明确 | 2 | 中 |
| P5 | 拆解卡片信息密度高，无批量操作 | 2 | 中 |
| P6 | 确认后缺乏反馈，不确定 Agent 是否自动开始 | 3 | 高 |
| P7 | 执行过程在聊天中完全不可见 | 4 | 高 |
| P8 | 多 Agent 并行时信息混乱 | 4 | 中 |
| P9 | 审批缺乏上下文，拒绝无反馈通道 | 5 | 高 |
| P10 | 消息积累后无搜索/筛选/折叠 | 6 | 中 |

---

## 3. 优化方案

### 方向 1：冷启动优化（P1, P2, P3）

#### 改动 1.1：解锁输入框
- 移除 `GlobalChatRoom` 中 textarea 的 `disabled={!selectedConversationId}`
- `ProjectChatPanel` Header 空状态文案改为 "作战指挥室"（取代 "请选择一个项目"）

#### 改动 1.2：首次发消息自动创建项目
- `addChatMessage` 中检测：若无 `selectedConversationId`，自动调用 `addConversation` 创建项目
- 项目标题从消息内容中提取（取前 20 字符或首个逗号前）
- 创建后自动选中该项目
- Guard：仅当 `chatMessages.length === 0` 且无任何 conversation 时触发，避免误触已有项目场景

#### 改动 1.3：上下文感知的空状态
- 未选项目时：显示 "作战指挥室" + "描述你想构建的东西，或 @Agent 下达具体指令" + 快捷建议气泡
- 选中项目但无消息：
  - 有目标无任务 → "@Jean 可以帮你拆解任务" + 目标摘要
  - 有任务无消息 → 任务概况卡片 + "@Keqing 继续执行"
  - Agent 未绑定账号 → "Agent 需要绑定账号才能出战" + 快捷设置入口

#### 改动 1.4：快捷建议可点击填充
- 快捷建议气泡点击后自动填充到输入框（不发送）
- 建议内容随项目状态动态变化

### 方向 2：执行可见性（P7, P8）

#### 改动 2.1：AgentBar 显示实时工作状态
- 正在工作的 Agent 卡片增加：蓝色边框 + 脉冲动画 + 当前任务标题（截断显示）
- 空闲 Agent 显示灰色 "空闲" 标签
- 数据来源：从 Store 中查找 `status === 'in_progress'` 且 `agentId` 匹配的任务

#### 改动 2.2：新增 `progress` 消息类型
- ChatMessage 的 `intent` 字段新增值 `progress`
- 进度消息由 **daemon 事件流** 驱动，通过 socket 事件自动创建：
  - `task.status_changed` → in_progress 时发送 "开始" 消息
  - `run.progress` 事件发送 "进度更新" 消息（带步骤数据）
  - `task.status_changed` → done 时发送 "完成" 消息
- 前端 store 的事件处理器负责创建 progress 消息，不需要 Agent 主动发
- ChatMessageItem 根据 `intent === 'progress'` 渲染进度条和步骤列表

#### 改动 2.3：同一 Agent 连续消息分组折叠
- 连续同一 Agent 的消息自动折叠为一组
- 组头部显示 Agent emoji + 名字 + 消息数 + 时间范围
- 默认展开最新一组，折叠旧组
- 左侧色条标识 Agent 主题色

### 补充：Jean 介入触发机制（P4）
- 当前行为：用户发消息后，系统通过意图检测（ideate/execute/review）判断路由
- 优化：在消息发送后，若项目 `breakdownStatus` 为空（未拆解），自动触发 Jean 拆解流程
- 若用户 @指定了其他 Agent，则优先走指定 Agent，不自动触发 Jean
- Header 的 breakdownStatus 指示器保持现有行为不变

### 方向 3：反馈与上下文（P5, P6, P9）

#### 改动 3.1：拆解卡片增加批量操作
- 每个阶段头增加 "全选" / "全不选" 按钮
- 每个阶段头增加 "确认此阶段" 独立按钮（可分阶段确认）
- 已确认的阶段显示绿色边框 + "✓ 已确认" 标记

#### 改动 3.2：确认后系统反馈消息
- 新增 `system` 消息类型（`agentId: 'system'`）
- 确认拆解后自动发送系统消息：
  - 创建的任务数量和阶段数量
  - 各阶段派发状态（已派发 / 等待前置阶段）
  - Agent 接收情况
  - "你可以随时 @Agent 追加指令或调整计划"

#### 改动 3.3：审批消息增加产出物预览
- 审批消息内嵌产出物文件列表（新增/修改/删除，用颜色区分）
- "展开完整 diff →" 入口，点击后展开 diff 视图
- 数据来源：从任务的 `artifacts` 字段提取

#### 改动 3.4：拒绝操作增加原因输入
- 点击 "拒绝" 后展开原因输入框（必填）
- 提交后原因写入任务的 `reviewNotes` 字段
- 消息底部显示 "已拒绝：{原因摘要}"

### 方向 4：消息管理（P10）

#### 改动 4.1：筛选/搜索工具条
- 消息列表上方增加可折叠工具条
- 筛选选项：
  - 按意图：全部 / 构思 / 执行 / 评审 / 进度 / 系统
  - 按 Agent：下拉选择或点击 AgentBar 中的 Agent
  - 仅用户消息
- 搜索：关键词匹配消息内容
- 工具条默认展开（消息 > 20 条时），可收起

#### 改动 4.2：日期分隔线
- 按天分组消息，插入日期分隔线（"── 今天 ──" / "── 昨天 ──" / "── 5月1日 ──"）

#### 改动 4.3：消息悬停操作条
- 鼠标悬停消息时，在消息气泡右上角显示操作条：
  - 📎 引用：将消息内容引用到输入框
  - 📋 复制：复制消息文本
  - 🔗 #TASK：跳转到关联任务详情面板

---

## 4. 改动汇总

| 方向 | 改动数 | 影响组件 | 新增类型 |
|------|--------|---------|---------|
| 1. 冷启动 | 5 | GlobalChatRoom, ProjectChatPanel, taskHubStore | — |
| 2. 执行可见性 | 5 | AgentBar, ChatMessageItem, taskHubStore | `progress` 消息 intent |
| 3. 反馈与上下文 | 4 | ChatMessageItem, taskHubStore | `system` 消息 agentId |
| 4. 消息管理 | 4 | GlobalChatRoom, ChatMessageItem | — |
| **合计** | **18** | **4 个组件** | **2 个新类型** |

---

## 5. 数据模型变更

### ChatMessage 扩展

```typescript
interface ChatMessage {
  // 现有字段...
  id: string;
  agentId: string;        // 新增 'system' 值
  content: string;
  intent?: string;         // 新增 'progress' 值
  timestamp: string;
  conversationId?: string;
  referencedTaskId?: string;
  isApprovalRequest?: boolean;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  // 新增字段
  progressData?: {
    taskId: string;
    type: 'start' | 'update' | 'complete';
    completedSteps: number;
    totalSteps: number;
    steps: { label: string; status: 'done' | 'in_progress' | 'pending' }[];
  };
  artifactPreview?: {
    files: { path: string; change: 'added' | 'modified' | 'deleted' }[];
  };
  rejectionReason?: string;
}
```

### 任务扩展（用于 AgentBar 状态查询）

```typescript
// 无 schema 变更，通过 selector 查询
const getAgentCurrentTask = (agentId: string) =>
  tasks.find(t => t.agentId === agentId && t.status === 'in_progress');
```

---

## 6. 实现优先级

1. **P0 — 冷启动**（方向 1）：改动人少，影响最大，解决用户第一步就走不通的问题
2. **P1 — 执行可见性**（方向 2）：核心痛点，啊哈时刻的延续
3. **P1 — 反馈与上下文**（方向 3）：确认和审批是日常高频操作
4. **P2 — 消息管理**（方向 4）：改善长期使用体验，优先级略低
