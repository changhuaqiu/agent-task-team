import { AGENT_ROSTER } from '@/store/agentStore';
import type { RoleCard } from '@/types/roleCard';

const ROLE_LABELS: Record<string, string> = {
  planner: '统筹',
  backend: '实现',
  code_reviewer: '质量',
  arch_reviewer: '架构',
};

const DISPATCH_RULES = `## 分派规则
- 实现任务 → Luigi（全栈开发），不分前后端
- 架构/schema/安全风险 → DK（架构工程）
- 评审+测试 → Peach（质量保障）
- 负载已满的角色不可分派（当前负载 = 并行上限）
- 每个 TASK 必须指定 @agentId，不允许空缺
- 一个 TASK = 一个角色的一次独立交付`;

const COLLABORATION_RULES = `## 协作规则
- 遇到超出职责范围且需要别人执行的新动作，才发起 A2A 交接
- A2A 必须使用平台 agent_submit_outcome 工具提交 handoff_to_agent 结构化结果
- 回复文本中的 @agent、通知、知会和完成说明都只是群聊信息，不会唤醒执行
- 关键架构变更、数据库 schema 变更前必须请求用户确认
- 评审意见必须附带具体代码引用和修复方向
- 如果需要其他 agent 协助，在 handoff branch 中明确目标、动作、交付物与证据引用`;

export function buildTeamLayer(selfId: string, allRoleCards: RoleCard[], currentLoad: Record<string, number> = {}): string {
  const entries = AGENT_ROSTER.map((agent) => {
    const rc = allRoleCards.find((c) => c.id === agent.roleCardId);
    return {
      id: agent.id,
      name: agent.name,
      emoji: agent.emoji,
      roleName: rc?.category ? ROLE_LABELS[rc.category] ?? rc.displayName : rc?.displayName ?? '',
      strengths: rc?.responsibilities.slice(0, 3) ?? [],
      domains: rc?.capabilities?.domains ?? [],
      skills: rc?.capabilities?.skills ?? [],
      seniority: rc?.capabilities?.seniority ?? 'mid',
      maxConcurrent: rc?.capabilities?.maxConcurrentTasks ?? 1,
      currentLoad: currentLoad[agent.id] ?? 0,
    };
  });

  const teammates = entries.filter((e) => e.id !== selfId);
  if (teammates.length === 0) return '';

  const header = '| @mention | 名字 | 角色 | 领域 | 核心技能 | 资历 | 并行上限 | 当前负载 |';
  const sep = '|----------|------|------|------|---------|------|---------|---------|';
  const rows = teammates.map(
    (t) => `| @${t.id} | ${t.emoji} ${t.name} | ${t.roleName} | ${t.domains.join(', ')} | ${t.skills.slice(0, 4).join(', ')} | ${t.seniority} | ${t.maxConcurrent} | ${t.currentLoad}/${t.maxConcurrent} |`,
  );

  return [
    `## 团队花名册`,
    '',
    header,
    sep,
    ...rows,
    '',
    DISPATCH_RULES,
    '',
    COLLABORATION_RULES,
  ].join('\n');
}
