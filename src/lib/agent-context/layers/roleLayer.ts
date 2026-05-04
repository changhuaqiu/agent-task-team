import type { RoleCard } from '@/types/roleCard';

const FORMAT_LABELS: Record<string, string> = {
  structured_list: '结构化列表',
  report: '报告',
  checklist: '检查清单',
};

export function buildRoleLayer(agent: { id: string; name: string }, roleCard?: RoleCard): string {
  if (!roleCard) return '';
  const parts: string[] = [];

  if (roleCard.persona?.introduction) {
    parts.push(roleCard.persona.introduction);
  }

  const constraints: string[] = [];
  if (roleCard.responsibilities.length) {
    constraints.push(`- 职责：${roleCard.responsibilities.join('、')}`);
  }
  if (roleCard.nonResponsibilities.length) {
    constraints.push(`- 非职责：${roleCard.nonResponsibilities.join('、')}`);
  }
  if (roleCard.forbiddenActions.length) {
    constraints.push(`- 禁止：${roleCard.forbiddenActions.join('、')}`);
  }
  if (roleCard.requiresEvidence) {
    constraints.push('- 评审/建议必须附带具体证据和文件引用');
  }
  if (roleCard.outputFormat !== 'freeform') {
    constraints.push(`- 输出格式：${FORMAT_LABELS[roleCard.outputFormat] ?? roleCard.outputFormat}`);
  }
  if (roleCard.allowedActions.includes('can_propose_only') && !roleCard.allowedActions.includes('can_modify_code')) {
    constraints.push('- 只能提出建议，不能直接修改代码');
  }
  if (roleCard.requiresConfirmation.length) {
    constraints.push(`- 以下操作需用户确认：${roleCard.requiresConfirmation.join('、')}`);
  }
  if (constraints.length > 0) {
    parts.push('## 角色约束\n' + constraints.join('\n'));
  }

  if (roleCard.persona?.voice) {
    parts.push(`## 语气风格\n${roleCard.persona.voice}`);
  }
  if (roleCard.persona?.mindset) {
    parts.push(`## 思维模式\n${roleCard.persona.mindset}`);
  }
  if (roleCard.persona?.habits) {
    parts.push(`## 工作习惯\n${roleCard.persona.habits}`);
  }
  if (roleCard.persona?.collaboration) {
    parts.push(`## 协作风格\n${roleCard.persona.collaboration}`);
  }

  // Planner-specific dispatch instructions
  if (roleCard.category === 'planner') {
    parts.push(`## 分派职责
你是项目统筹，核心职责：
1. 将用户目标分解为 PHASE → TASK，每个 TASK 粒度控制在单角色可独立完成
2. 分派时参考团队花名册的领域和技能匹配
3. 如果 Advisor 给出了建议分派，优先采纳；有异议时说明理由
4. 每个 TASK 输出格式：TASK: <描述> @<agentId>

## TASK 粒度标准
- 一个 TASK = 一个角色的一次独立交付
- 涉及两个领域的 TASK 必须拆成两个
- 单个 TASK 预估工作量不超过项目总量的 1/5
- 有依赖关系的 TASK 放在同一 PHASE 内，按顺序排列`);
  }

  return parts.join('\n\n');
}
