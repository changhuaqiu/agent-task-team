import type { RoleCard } from '@/types/roleCard';

export function deriveRoleFromCard(roleCard?: RoleCard): string {
  if (!roleCard?.capabilities?.domains?.length) return 'worker';
  return roleCard.capabilities.domains[0];
}

interface ProtocolLayerOpts {
  agentId: string;
  agentRole: string;
  projectPath: string;
  hasTaskAssignment: boolean;
  isPlanner: boolean;
}

export function buildProtocolLayer(opts: ProtocolLayerOpts): string {
  const constraints = `## 任务协作协议

### 你的身份
- agentId: ${opts.agentId} | Role: ${opts.agentRole}

### 任务看板路径
.ath/TASKS.md（直接编辑此文件管理任务）

### TASKS.md 格式
\`\`\`markdown
# 任务看板

| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
|----|-------|-------|------|-------|--------|---------|-------------|
| TASK-001 | 示例任务 | P1 | backend | luigi | doing | - | types.ts |
| TASK-002 | 依赖任务 | P1 | frontend | peach | todo | TASK-001 | component.tsx |

## 风险 / 阻塞

| ID | Task | Type | Summary | Status |
|----|------|------|---------|--------|
| R1 | TASK-001 | gate_fail | 类型定义不兼容 | open |
\`\`\`

### 列说明
- Phase: 所属阶段（P1, P2, ...）
- Role: 任务角色（planner, backend, frontend, testing, security, devops）
- Agent: 负责人 agentId（未分配用 \`-\`）
- Status: todo / doing / review / done / blocked
- Depends: 依赖的任务 ID，多个用逗号分隔（无依赖用 \`-\`）
- Deliverable: 产出物文件路径（未填写用 \`-\`）

### 状态流转
todo → doing → review → done / blocked

### 规则
1. 先读 .ath/TASKS.md 查看全部任务
2. 有分配给你的 → 将 Status 改为 doing → 执行
3. Role 匹配且 todo 的 → 也可以认领
4. 完成后 → Status 改为 review + Deliverable 填产出路径
5. 阻塞 → Status 改为 blocked，在表格下方加风险行
6. 遇到风险 → 在"风险 / 阻塞"区域新增一行
7. 任务行变化会自动生成群聊通知；只有需要对方执行新动作时才用「@agent 请/需要 + 动作 + 具体交付物」发起 A2A 交接
8. 纯 @mention、通知 @agent、@agent 已完成/已写入 TASKS.md 不会唤醒对方；系统会用任务通知同步状态

### 禁止
- 不改其他 Agent 的任务行
- 不跳过 review 直接标 done

### 资源位置
- 任务看板: .ath/TASKS.md
- 完成标准: .ath/PROTOCOLS.md
- 角色映射: .ath/ROLES.md
- 项目上下文: .ath/PROJECT.md`;

  let guidance = '';

  if (opts.isPlanner) {
    guidance = '\n\n调度职责：读取 .ath/TASKS.md，按优先级分配任务（填 Agent 列），新增风险行到风险区域。';
  } else if (opts.hasTaskAssignment) {
    guidance = '\n\n你被分配了任务。读取 .ath/TASKS.md 确认，完成后更新 Status 和 Deliverable。';
  } else {
    guidance = '\n\n自检 .ath/TASKS.md，认领 Role 匹配的 todo 任务。没有则按用户指令执行。';
  }

  return constraints + guidance;
}
