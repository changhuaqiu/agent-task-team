// src/types/capabilityProfile.ts

export type Seniority = 'junior' | 'mid' | 'senior' | 'lead';

export interface CapabilityProfile {
  /** Domains this role covers: frontend, backend, qa, review, devops, planning */
  domains: string[];
  /** Concrete skills: react, typescript, sql, testing, etc. */
  skills: string[];
  /** Experience level */
  seniority: Seniority;
  /** Max tasks this agent can handle concurrently */
  maxConcurrentTasks: number;
}

export const DOMAIN_KEYWORDS: Record<string, string[]> = {
  frontend: ['ui', '页面', '组件', 'css', 'react', '样式', 'layout', 'button', '前端', 'frontend', 'tailwind', '交互', '动画', '表单', 'modal'],
  backend: ['api', '接口', '数据库', 'sql', 'server', '路由', 'endpoint', '后端', 'backend', 'orm', 'schema', 'migration', 'drizzle', '服务端'],
  qa: ['测试', 'test', 'e2e', '单元测试', '覆盖率', 'bug', '质量', '回归', 'vitest', 'spec', '断言'],
  review: ['审查', 'review', '代码审查', 'pr', 'cr', '评审', '质量门', '规范'],
  devops: ['部署', 'deploy', 'ci', 'pipeline', 'docker', '运维', '监控', '日志'],
  planning: ['规划', '分解', '计划', 'plan', '方案', '里程碑', '排期', '依赖', '优先级'],
};
