import { AGENT_ROSTER } from '@/store/agentStore';
import type { RoleCard } from '@/types/roleCard';

const ROLE_LABELS: Record<string, string> = {
  planner: '统筹',
  frontend: '实现',
  backend: '实现',
  code_reviewer: '评审',
  arch_reviewer: '评审',
  qa: '测试',
};

const DISPATCH_RULES = `## 分派规则
- 严格按领域匹配：前端任务 → frontend 域角色，后端任务 → backend 域角色
- 负载已满的角色不可分派（当前负载 = 并行上限）
- 无精确领域匹配时，选择 skills 交集最大的角色
- 每个 TASK 必须指定 @agentId，不允许空缺
- 一个 TASK = 一个角色的一次独立交付；涉及两个领域的必须拆成两个 TASK`;

const COLLABORATION_RULES = `## 协作规则
- 遇到超出职责范围的工作，使用 @mention 交接给对应角色（另起一行行首写 @agentId）
- 关键架构变更、数据库 schema 变更前必须请求用户确认
- 评审意见必须附带具体代码引用和修复方向
- 如果需要其他 agent 协助，在回复中另起一行写 @agentId + 请求内容`;

export function buildTeamLayer(selfId: string, allRoleCards: RoleCard[], currentLoad: Record<string, number> = {}): string {
  const entries = AGENT_ROSTER.map((agent) => {
    const rc = allRoleCards.find((c) => c.id === agent.roleCardId);
    return {
      id: agent.id,
      name: agent.name,
      displayName: rc?.displayName ?? agent.roleLabel,
      emoji: agent.emoji,
      roleLabel: rc?.category ? ROLE_LABELS[rc.category] ?? agent.roleLabel : agent.roleLabel,
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
    (t) => `| @${t.id} | ${t.emoji} ${t.name} | ${t.roleLabel} | ${t.domains.join(', ')} | ${t.skills.slice(0, 4).join(', ')} | ${t.seniority} | ${t.maxConcurrent} | ${t.currentLoad}/${t.maxConcurrent} |`,
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
