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

  return parts.join('\n\n');
}
