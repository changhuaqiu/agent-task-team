import { TASK_MANAGEMENT_SKILL } from './presetSkills/taskManagement';
import { GIT_COLLABORATION_SKILL } from './presetSkills/gitCollaboration';
import { TASK_STATUS_RECEIPT_SKILL } from './presetSkills/taskStatusReceipt';
import { TEAM_MEMORY_SKILL } from './presetSkills/teamMemory';

export const PRESET_SKILLS = [
  GIT_COLLABORATION_SKILL,
  TASK_STATUS_RECEIPT_SKILL,
  TEAM_MEMORY_SKILL,
  {
    name: 'code-review',
    description: '结构化代码审查，提供 checklist 和反馈模板',
    content: `# Code Review Skill

## 规则
- 审查必须基于项目的编码标准
- 提供可操作的建议，而不是泛泛的观察
- 区分必须修复（blocker）、建议修复（suggestion）、可选优化（nit）
- 始终引用具体的文件和行号

## Checklist
- [ ] 逻辑正确性
- [ ] 错误处理
- [ ] 边界条件
- [ ] 安全性（注入、XSS、敏感数据泄露）
- [ ] 性能影响
- [ ] 测试覆盖`,
    isPreset: true,
  },
  {
    name: 'tdd',
    description: '测试驱动开发工作流',
    content: `# TDD Skill

## 工作流
1. **Red** — 先写失败的测试
2. **Green** — 写最少的代码让测试通过
3. **Refactor** — 重构代码，保持测试通过

## 规则
- 每次只写一个测试
- 测试名称描述期望行为，不是实现细节
- 使用有意义的测试数据，不要用 "foo"、"bar"
- 重构时不要同时修改测试和实现`,
    isPreset: true,
  },
  {
    name: 'debugging',
    description: '系统性调试方法论',
    content: `# Debugging Skill

## 方法论
1. **复现** — 确认能稳定复现问题
2. **缩小范围** — 通过二分法缩小到最小复现路径
3. **假设** — 提出可能的原因
4. **验证** — 逐个验证假设，收集证据
5. **修复** — 实施修复，验证测试通过
6. **回归** — 确保修复没有引入新问题

## 规则
- 不要猜测，用证据说话
- 一次只改一个变量
- 记录调试过程，方便回溯`,
    isPreset: true,
  },
  {
    name: 'brainstorm',
    description: '协作式头脑风暴与创意发想',
    content: `# Brainstorm Skill

## 规则
- 先理解问题空间，再提出解决方案
- 提出至少 2-3 个不同的方案，分析各自的权衡
- 使用 "是的，而且..." 而不是 "但是..."
- 优先考虑简单方案，复杂方案需要充分的理由
- 区分 "必须有" 和 "可以有"`,
    isPreset: true,
  },
  TASK_MANAGEMENT_SKILL,
];
