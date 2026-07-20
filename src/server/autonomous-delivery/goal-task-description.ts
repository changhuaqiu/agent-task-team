import type { GoalContract } from './types';

export function buildGoalTaskDescription(contract: GoalContract): string {
  const sections = [
    contract.goal,
    '',
    '验收标准：',
    ...contract.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
  ];

  sections.push(
    '',
    '这是自主交付任务。请自行拆解、分派、评审、验证和收口；只有出现系统无法安全处理的例外才请求用户决策。',
  );
  return sections.join('\n');
}
