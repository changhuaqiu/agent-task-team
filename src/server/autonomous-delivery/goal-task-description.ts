import type { GoalContract } from './types';

export function buildGoalTaskDescription(contract: GoalContract): string {
  const sections = [
    contract.goal,
    '',
    '验收标准：',
    ...contract.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`),
  ];

  if (contract.source?.kind === 'github_issue') {
    sections.push(
      '',
      '需求来源：',
      `- GitHub Issue：${contract.source.url}`,
      `- 仓库：${contract.source.repository}`,
      `- Issue：#${contract.source.issueNumber} ${contract.source.title}`,
    );
    if (contract.source.labels.length > 0) {
      sections.push(`- 标签：${contract.source.labels.join(', ')}`);
    }
    sections.push(
      '',
      'Issue 描述：',
      contract.source.description.trim() || '（Issue 未提供正文）',
    );
  }

  sections.push(
    '',
    '这是自主交付任务。请自行拆解、分派、评审、验证和收口；只有出现系统无法安全处理的例外才请求用户决策。',
  );
  return sections.join('\n');
}
