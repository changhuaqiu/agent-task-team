import type { RoleCard } from '@/types/roleCard';

const FORMAT_LABELS: Record<string, string> = {
  structured_list: '结构化列表',
  report: '报告',
  checklist: '检查清单',
};

export function buildRoleLayer(roleCard?: RoleCard): string {
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
    constraints.push(`- 工作产物格式：${FORMAT_LABELS[roleCard.outputFormat] ?? roleCard.outputFormat}；聊天回执仍遵守全局“对用户说人话”契约`);
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
    parts.push(`## 语气风格\n${roleCard.persona.voice}\n语气只影响表达风格，不能增加用户不需要的技术细节、角色表演或内部流程播报。`);
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
5. 按团队 Workflow Harness 分派：planning → implementing → quality_gate → done
6. 实现任务给 Luigi（全栈开发）；不让统筹角色代替实现
7. 正常 quality_gate reject 不经过统筹角色；只有范围不清、反复失败或需要取舍才升级给统筹角色
8. 已有明确 WorkContract 时直接完成当前工作，不重新输出身份介绍、规划宣言或重复任务拆解

## TASK 粒度标准
- 一个 TASK = 一个角色的一次独立交付
- 涉及两个领域的 TASK 必须拆成两个
- 单个 TASK 预估工作量不超过项目总量的 1/5
- 有依赖关系的 TASK 放在同一 PHASE 内，按顺序排列`);
  }

  if (roleCard.category === 'code_reviewer') {
    parts.push(`## Quality Gate 职责
- 你负责 quality_gate：先评审代码质量、安全、回归风险，再做集成测试验证
- 评审不通过时直接打回实现角色（Luigi），并附具体证据和修复方向
- 发现架构、schema、安全、性能或跨模块边界风险时，升级给架构评审角色
- 评审 + 测试都通过后才允许任务进入 done，不直接宣称交付完成
- 直接使用工具核验，正文只输出一次最终裁决、证据和修复方向，不逐步播报检查计划`);
  }

  if (roleCard.category === 'arch_reviewer') {
    parts.push(`## Gate 职责
- 你是按需架构门禁，不是常规实现者
- 只在架构、schema、安全、性能、跨模块边界或明确请求时介入
- 收到评审、实现或统筹角色的架构评审请求后介入
- 输出架构反馈给相关实现或评审角色；需要范围取舍时升级给统筹角色
- 默认只提出建议和评审意见，不直接修改代码`);
  }

  // qa 职责已合并进 code_reviewer（Peach 兼管 review + test）

  return parts.join('\n\n');
}
