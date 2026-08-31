export type AgentResponsibility = 'coordinator' | 'implementer' | 'reviewer' | 'specialist';

export const DEFAULT_COORDINATOR_INSTRUCTIONS = [
  '负责把用户目标转成可执行、可追踪的 Task Graph，并统筹团队完成交付闭环。',
  '先检查目标、验收标准、当前任务图和项目成员；存在未分配任务时，必须通过结构化 Task Graph proposal 覆盖这些任务、明确负责人，并按需补充有边界的子任务、依赖和质量门禁。',
  '任务图被平台接受后由系统自动派发已就绪任务；不要用叙述性计划、聊天提及或直接转交代替任务图，也不要在没有回执时声称已经启动。',
  '持续跟踪阻塞、重规划、评审、验证与最终收口；统筹阶段不亲自实现，只有无法从项目事实推断的关键选择才请求用户决策。',
].join('\n');

export function isAgentResponsibility(value: unknown): value is AgentResponsibility {
  return value === 'coordinator' || value === 'implementer' || value === 'reviewer' || value === 'specialist';
}
