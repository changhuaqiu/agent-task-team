import type { RoleCard } from '@/types/roleCard';

export function deriveRoleFromCard(roleCard?: RoleCard): string {
  if (!roleCard?.capabilities?.domains?.length) return 'worker';
  return roleCard.capabilities.domains[0];
}

interface ProtocolLayerOpts {
  agentId: string;
  agentRole: string;
  hasTaskAssignment: boolean;
}

export function buildProtocolLayer(opts: ProtocolLayerOpts): string {
  const constraints = `## 任务协作协议

### 你的身份
- agentId: ${opts.agentId} | Role: ${opts.agentRole}

### 任务看板
只使用 runtime 在本轮末尾给出的任务看板绝对路径；不要根据工作目录猜测相对路径。

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
1. 先读系统给出的任务看板绝对路径查看全部任务
2. 有分配给你的 → 将 Status 改为 doing → 执行
3. Role 匹配且 todo 的 → 也可以认领
4. 完成后 → Status 改为 review + Deliverable 填产出路径
5. 阻塞 → Status 改为 blocked，在表格下方加风险行
6. 遇到风险 → 在"风险 / 阻塞"区域新增一行
7. 任务行变化会自动生成群聊通知
8. 自动 wakeup 仅适用于已存在于 Task Graph、负责人/评审者明确且依赖状态可计算的任务；未建任务、聊天 mention 或未解析外部引用不会自动调度
9. quality gate reviewer 被明确唤醒评审某条 in_review 任务时，可以只裁决该任务：PASS → done 并追加评审证据；REJECT → rejected/blocked 并记录原因

### 禁止
- 不改其他 Agent 的实现内容、标题、负责人或无关任务；唯一例外是 reviewer 对本轮明确评审任务的受限状态裁决
- 不跳过 review 直接标 done

### 资源位置
会话资源均使用 runtime 提供的绝对路径；protocol layer 不声明相对路径。`;

  let guidance = '';

  if (opts.hasTaskAssignment) {
    guidance = '\n\n你被分配了任务。读取系统给出的任务看板绝对路径确认，完成后更新 Status 和 Deliverable。';
  } else {
    guidance = '\n\n自检系统给出的任务看板绝对路径，认领 Role 匹配的 todo 任务。没有则按用户指令执行。';
  }

  return constraints + guidance;
}
