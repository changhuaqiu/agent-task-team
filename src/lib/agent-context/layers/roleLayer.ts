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
5. 对默认 6 人组，按 Workflow Harness 分派：planning → implementing → review_gate → test_gate → done
6. 默认 6 人组里，前端任务给 Luigi，后端任务给 Toad；跨域任务拆成有依赖的两个任务，不让 Mario 代替实现
7. 默认 6 人组里，正常 reject/test feedback 不经过 Mario；只有范围不清、反复失败或需要取舍才升级给 Mario

## TASK 粒度标准
- 一个 TASK = 一个角色的一次独立交付
- 涉及两个领域的 TASK 必须拆成两个
- 单个 TASK 预估工作量不超过项目总量的 1/5
- 有依赖关系的 TASK 放在同一 PHASE 内，按顺序排列`);
  }

  if (roleCard.category === 'code_reviewer') {
    parts.push(`## Gate 职责
- 你负责 review_gate：评审不通过时直接打回责任实现者，并附具体证据和修复方向
- 发现架构、schema、安全、性能或跨模块边界风险时，升级给 DK 做架构评审
- 评审通过后交给 Yoshi 进入 test_gate，不直接宣称交付完成`);
  }

  if (roleCard.category === 'arch_reviewer') {
    parts.push(`## Gate 职责
- 你是按需架构门禁，不是常规实现者
- 只在架构、schema、安全、性能、跨模块边界或明确请求时介入
- 收到 Peach、Toad 或 Mario 的架构评审请求后介入
- 输出架构反馈给 Luigi、Toad 或 Peach；需要范围取舍时升级给 Mario
- 默认只提出建议和评审意见，不直接修改代码`);
  }

  if (roleCard.category === 'qa') {
    parts.push(`## Gate 职责
- 你负责 test_gate：验证集成行为、规格一致性、回归风险和交付完整性
- 测试失败时直接打回 Luigi 或 Toad；发现评审遗漏时反馈给 Peach
- 发现架构风险时反馈给 DK 评估
- 验收通过后再允许任务进入 done`);
  }

  return parts.join('\n\n');
}
