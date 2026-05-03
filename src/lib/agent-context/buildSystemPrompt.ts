import type { RoleCard } from '@/types/roleCard';
import { buildTeamRoster } from './buildTeamRoster';

export interface SystemPromptContext {
  agentId: string;
  agentName: string;
  roleCard: RoleCard;
  allRoleCards: RoleCard[];
  projectName: string;
  projectPath: string;
}

function buildRoleIdentity(rc: RoleCard): string {
  const parts: string[] = [];

  if (rc.persona?.introduction) {
    parts.push(rc.persona.introduction);
  }

  const constraints: string[] = [];
  if (rc.responsibilities.length) {
    constraints.push(`- 职责：${rc.responsibilities.join('、')}`);
  }
  if (rc.nonResponsibilities.length) {
    constraints.push(`- 非职责：${rc.nonResponsibilities.join('、')}`);
  }
  if (rc.forbiddenActions.length) {
    constraints.push(`- 禁止：${rc.forbiddenActions.join('、')}`);
  }
  if (rc.requiresEvidence) {
    constraints.push('- 评审/建议必须附带具体证据和文件引用');
  }
  if (rc.outputFormat !== 'freeform') {
    const formatLabels: Record<string, string> = {
      structured_list: '结构化列表',
      report: '报告',
      checklist: '检查清单',
    };
    constraints.push(`- 输出格式：${formatLabels[rc.outputFormat] ?? rc.outputFormat}`);
  }
  if (rc.allowedActions.includes('can_propose_only') && !rc.allowedActions.includes('can_modify_code')) {
    constraints.push('- 只能提出建议，不能直接修改代码');
  }
  if (rc.requiresConfirmation.length) {
    constraints.push(`- 以下操作需用户确认：${rc.requiresConfirmation.join('、')}`);
  }

  if (constraints.length > 0) {
    parts.push('## 角色约束\n' + constraints.join('\n'));
  }

  return parts.join('\n\n');
}

function buildCollaborationRules(rc: RoleCard): string {
  return `## 协作规则

- 遇到超出职责范围的工作，使用 @mention 交接给对应角色（另起一行行首写 @agentId）
- 关键架构变更、数据库 schema 变更前必须请求用户确认
- 评审意见必须附带具体代码引用和修复方向
- 如果需要其他 agent 协助，在回复中另起一行写 @agentId + 请求内容`;
}

function buildProjectContext(projectName: string, projectPath: string): string {
  const parts: string[] = ['## 项目上下文'];
  if (projectName) {
    parts.push(`- 项目：${projectName}`);
  }
  if (projectPath) {
    parts.push(`- 工作目录：${projectPath}`);
  }
  parts.push('- 项目根目录有 CLAUDE.md / AGENTS.md 规范文件，请遵循');
  return parts.join('\n');
}

function buildIdentityConstant(agentId: string, agentName: string, rc: RoleCard): string {
  return `Identity: ${agentName} (@${agentId}, role=${rc.displayName})`;
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const sections: string[] = [];

  // ① Role identity + constraints
  sections.push(buildRoleIdentity(ctx.roleCard));

  // ② Team roster
  const roster = buildTeamRoster(ctx.agentId, ctx.allRoleCards);
  if (roster) sections.push(roster);

  // ③ Collaboration rules
  sections.push(buildCollaborationRules(ctx.roleCard));

  // ④ Project context
  sections.push(buildProjectContext(ctx.projectName, ctx.projectPath));

  // ⑤ Identity constant (compression anchor)
  sections.push(buildIdentityConstant(ctx.agentId, ctx.agentName, ctx.roleCard));

  return sections.join('\n\n');
}
