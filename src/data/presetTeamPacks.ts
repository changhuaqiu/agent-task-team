// src/data/presetTeamPacks.ts

import type { CreateTeamPackInput } from '@/types/teamPack';

export const PRESET_TEAM_PACKS: CreateTeamPackInput[] = [
  {
    name: 'default-team',
    displayName: '默认团队（Mario 6人组）',
    description: 'Mario + Luigi + Toad + Peach + DK + Yoshi 经典组合，全栈覆盖',
    version: '1.0.0',
    tags: ['default', 'full-stack', 'all-roles'],
    category: 'team/default',
    teamMode: 'hub_spoke',
    roles: [
      { id: 'mario', displayName: '项目统筹', required: true, description: '规划任务、梳理依赖、统筹协调', soul: '# 项目统筹\n\n负责拆解任务、排列优先级、梳理依赖关系，确保团队目标清晰可执行。' },
      { id: 'luigi', displayName: '前端实现', required: true, description: '前端开发、UI 实现、交互逻辑', soul: '# 前端实现\n\n负责前端代码实现，包括 UI 组件、交互逻辑、状态管理等。' },
      { id: 'toad', displayName: '后端开发', required: true, description: '后端服务、API 开发、数据库', soul: '# 后端开发\n\n负责后端服务开发，包括 API 设计、数据库操作、业务逻辑等。' },
      { id: 'peach', displayName: '代码评审', required: true, description: '审查代码质量、发现问题', soul: '# 代码评审\n\n负责审查代码质量，确保代码规范、可维护、无安全隐患。' },
      { id: 'dk', displayName: '架构工程', required: false, description: '架构设计、技术选型、性能优化', soul: '# 架构工程\n\n负责系统架构设计、技术选型、性能分析与优化。' },
      { id: 'yoshi', displayName: 'QA 测试', required: false, description: '测试策略、质量保障', soul: '# QA 测试\n\n负责制定测试策略、编写测试用例、执行测试、保障产品质量。' },
    ],
    workflow: {
      type: 'state_machine',
      description: 'Hub-Spoke 模式：Mario 为中心，按需调度其他角色',
      states: [
        { name: 'planning', role: 'mario', description: 'Mario 规划任务', transitions: [{ from: 'planning', to: 'implementing', condition: '任务分配完成' }] },
        { name: 'implementing', role: 'luigi', description: '实现中', transitions: [{ from: 'implementing', to: 'reviewing', condition: '代码提交' }, { from: 'implementing', to: 'planning', condition: '遇到阻塞' }] },
        { name: 'reviewing', role: 'peach', description: '代码审查', transitions: [{ from: 'reviewing', to: 'done', condition: '审查通过' }, { from: 'reviewing', to: 'implementing', condition: '审查不通过' }] },
        { name: 'done', role: '', description: '完成', transitions: [], terminal: true },
      ],
    },
    communicationMatrix: {
      mario: { canSendTo: ['luigi', 'toad', 'peach', 'dk', 'yoshi'], canReceiveFrom: ['luigi', 'toad', 'peach', 'dk', 'yoshi'], canEscalateTo: ['human'] },
      luigi: { canSendTo: ['mario', 'peach'], canReceiveFrom: ['mario', 'peach'], canEscalateTo: ['mario'] },
      toad: { canSendTo: ['mario', 'peach'], canReceiveFrom: ['mario', 'peach'], canEscalateTo: ['mario'] },
      peach: { canSendTo: ['mario', 'luigi', 'toad'], canReceiveFrom: ['luigi', 'toad'], canEscalateTo: ['mario'] },
      dk: { canSendTo: ['mario'], canReceiveFrom: ['mario'], canEscalateTo: ['mario'] },
      yoshi: { canSendTo: ['mario'], canReceiveFrom: ['mario'], canEscalateTo: ['mario'] },
    },
    rules: { maxIterations: 3, escalationTimeoutHours: 2, requireEvidence: true, autoAssign: true },
  },
  {
    name: 'engineering-trio',
    displayName: '工程三件套',
    description: 'Planner + Coder + Reviewer 经典组合，适合中小型项目',
    version: '1.0.0',
    tags: ['engineering', 'planning', 'coding', 'review'],
    category: 'team/engineering',
    teamMode: 'pipeline',
    roles: [
      { id: 'planner', displayName: '规划师', required: true, description: '拆解任务、排优先级、梳理依赖', soul: '# 规划师\n\n## 核心身份\n我是规划师，负责把模糊的需求变成清晰可执行的任务。\n\n## 核心原则\n- 先理解再拆解\n- 小步快跑\n- 依赖显性化\n- 风险前置' },
      { id: 'coder', displayName: '实现者', required: true, description: '写代码、调 bug、实现功能', soul: '# 实现者\n\n## 核心身份\n我是实现者，负责把任务列表变成可运行的代码。\n\n## 核心原则\n- 测试先行（TDD）\n- 小步提交\n- 代码即文档\n- 遵循规范' },
      { id: 'reviewer', displayName: '审查者', required: true, description: '审查质量、发现问题、把关交付', soul: '# 审查者\n\n## 核心身份\n我是审查者，负责确保代码质量。\n\n## 核心原则\n- 标准统一\n- 建设性反馈\n- 证据驱动\n- 及时响应' },
    ],
    workflow: {
      type: 'state_machine',
      description: '任务从规划到交付的完整流转',
      states: [
        { name: 'planning', role: 'planner', description: '规划师拆解任务', transitions: [{ from: 'planning', to: 'implementing', condition: '任务拆解完成' }] },
        { name: 'implementing', role: 'coder', description: '实现者编写代码', transitions: [{ from: 'implementing', to: 'reviewing', condition: 'PR 提交' }, { from: 'implementing', to: 'blocked', condition: '遇到阻塞' }] },
        { name: 'reviewing', role: 'reviewer', description: '审查者检查代码', transitions: [{ from: 'reviewing', to: 'done', condition: '审查通过' }, { from: 'reviewing', to: 'implementing', condition: '审查不通过' }] },
        { name: 'blocked', role: 'planner', description: '阻塞状态', transitions: [{ from: 'blocked', to: 'implementing', condition: '阻塞解决' }] },
        { name: 'done', role: '', description: '任务完成', transitions: [], terminal: true },
      ],
    },
    communicationMatrix: {
      planner: { canSendTo: ['coder'], canReceiveFrom: ['reviewer', 'coder'], canEscalateTo: ['human'] },
      coder: { canSendTo: ['reviewer', 'planner'], canReceiveFrom: ['planner', 'reviewer'], canEscalateTo: ['planner'] },
      reviewer: { canSendTo: ['planner', 'coder'], canReceiveFrom: ['coder'], canEscalateTo: ['human'] },
    },
    rules: { maxIterations: 3, escalationTimeoutHours: 2, requireEvidence: true, autoAssign: true },
  },
  {
    name: 'research-team',
    displayName: '研究团队',
    description: 'Researcher + Analyst 并行调研，Writer 汇总成文',
    version: '1.0.0',
    tags: ['research', 'analysis', 'writing'],
    category: 'team/research',
    teamMode: 'parallel',
    roles: [
      { id: 'researcher', displayName: '研究员', required: true, description: '信息收集、文献调研', soul: '# 研究员\n\n负责信息收集、文献调研、竞品分析。\n\n## 核心原则\n- 来源可追溯\n- 数据驱动\n- 客观中立' },
      { id: 'analyst', displayName: '分析师', required: true, description: '数据分析、趋势判断', soul: '# 分析师\n\n负责数据分析、趋势判断、可行性评估。\n\n## 核心原则\n- 量化为先\n- 多维度对比\n- 风险评估' },
      { id: 'writer', displayName: '撰稿人', required: true, description: '汇总成文、输出报告', soul: '# 撰稿人\n\n负责将研究和分析结果汇总成清晰可读的文档。\n\n## 核心原则\n- 结构清晰\n- 观点有据\n- 读者视角' },
    ],
    workflow: {
      type: 'linear',
      description: 'Researcher 和 Analyst 并行调研，Writer 汇总',
      steps: [
        { role: 'researcher', action: '信息收集与调研', output: '调研报告' },
        { role: 'analyst', action: '数据分析与评估', output: '分析报告' },
        { role: 'writer', action: '汇总成文', output: '最终报告' },
      ],
    },
    communicationMatrix: {
      researcher: { canSendTo: ['writer'], canReceiveFrom: ['analyst'], canEscalateTo: ['human'] },
      analyst: { canSendTo: ['writer', 'researcher'], canReceiveFrom: ['researcher'], canEscalateTo: ['human'] },
      writer: { canSendTo: ['researcher', 'analyst'], canReceiveFrom: ['researcher', 'analyst'], canEscalateTo: ['human'] },
    },
    rules: { maxIterations: 2, requireEvidence: true, autoAssign: true },
  },
];
