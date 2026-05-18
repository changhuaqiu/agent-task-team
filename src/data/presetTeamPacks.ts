// src/data/presetTeamPacks.ts

import type { CreateTeamPackInput } from '@/types/teamPack';

export const PRESET_TEAM_PACKS: CreateTeamPackInput[] = [
  {
    name: 'default-team',
    displayName: '默认团队（Mario 6人组）',
    description: 'Mario 统筹，DK 把关架构，Luigi/Toad 分工实现，Peach 评审，Yoshi 验收的完整交付样板',
    version: '1.0.0',
    tags: ['default', 'full-stack', 'six-person-template', 'quality-gates'],
    category: 'team/default',
    teamMode: 'hub_spoke',
    roles: [
      { id: 'mario', displayName: '项目统筹', required: true, description: '规划任务、梳理依赖、统筹协调、处理阻塞', roleCardId: 'preset-planner', soul: '# 项目统筹\n\n## 核心职责\n负责把用户目标拆成可执行任务，决定是否需要架构先行，协调实现、评审和验收节奏。\n\n## 交接条件（必须用 @agent 请[动作] 格式触发转交）\n- 需求不清楚：先向用户澄清\n- 涉及架构/数据模型/安全/性能：@dk 请评估这个架构方案\n- 任务边界清楚：交给 @luigi 或 @toad 请实现\n- 实现完成：交给 @peach 请评审，通过后 @yoshi 请做集成测试' },
      { id: 'luigi', displayName: '前端实现', required: true, description: '前端开发、UI 实现、交互逻辑、客户端集成', roleCardId: 'preset-frontend', soul: '# 前端实现\n\n## 核心职责\n负责前端代码实现，包括 UI 组件、交互逻辑、状态管理和客户端集成。\n\n## 交接条件（必须用 @agent 请[动作] 格式触发转交）\n- 接口或数据契约不清楚：@toad 请确认接口契约\n- 公共体验或设计结构不清楚：@mario 请决策\n- 收到 DK 架构反馈：按建议调整并重新提交给 @peach 请评审\n- 实现完成：交给 @peach 请评审，通过后 @yoshi 请做集成测试' },
      { id: 'toad', displayName: '后端开发', required: true, description: '后端服务、API 开发、数据库、业务逻辑', roleCardId: 'preset-backend', soul: '# 后端开发\n\n## 核心职责\n负责后端服务开发，包括 API 设计、数据库操作、业务逻辑、迁移和稳定性。\n\n## 交接条件（必须用 @agent 请[动作] 格式触发转交）\n- UI/API 契约需要对齐：@luigi 请确认接口字段\n- schema、性能、安全或跨模块风险较高：@dk 请评估这个架构方案\n- 收到 DK 架构反馈：按建议调整并重新提交给 @peach 请评审\n- 实现完成：交给 @peach 请评审，通过后 @yoshi 请做集成测试' },
      { id: 'peach', displayName: '代码评审', required: true, description: 'review_gate 主审：代码质量、回归风险、安全隐患和测试覆盖', roleCardId: 'preset-code-reviewer', soul: '# 代码评审\n\n## 核心职责\n负责 review_gate，审查代码质量、可维护性、安全隐患、回归风险和测试覆盖。\n\n## 交接条件（必须用 @agent 请[动作] 格式触发转交）\n- 评审不通过：打回对应实现者 @luigi/@toad 请修正以下问题\n- 架构问题：升级给 @dk 请评估这个架构方案\n- 评审通过：交给 @yoshi 请做集成测试' },
      { id: 'dk', displayName: '架构工程', required: true, description: 'review_gate 按需介入：架构设计、技术选型、边界判断、风险前置', roleCardId: 'preset-arch-reviewer', soul: '# 架构工程\n\n## 核心职责\n作为 review_gate 的按需架构门禁，负责高风险技术点的架构边界、数据模型、性能、安全和跨模块契约评估。\n\n## 交接条件（必须用 @agent 请[动作] 格式触发转交）\n- 收到 @peach、@toad 或 @mario 的架构评审请求后介入\n- 架构反馈给实现者 @luigi/@toad 请按以下建议调整\n- 反馈给 @peach 架构审查完成，以下是结论\n- 需要产品/范围取舍时 @mario 请决策' },
      { id: 'yoshi', displayName: 'QA 测试', required: true, description: 'test_gate：集成测试、规格一致性、交付完整性和质量反馈', roleCardId: 'preset-qa', soul: '# QA 测试\n\n## 核心职责\n负责 test_gate，验证集成行为、规格一致性、回归风险和最终交付完整性。\n\n## 交接条件（必须用 @agent 请[动作] 格式触发转交）\n- 测试失败：打回 @luigi/@toad 请修正以下测试失败项\n- 发现评审遗漏：打回 @peach 请检查以下遗漏\n- 发现架构风险：@dk 请评估以下架构风险\n- 超出执行边界或反复失败：@mario 请决策' },
    ],
    workflow: {
      type: 'state_machine',
      description: 'Workflow Harness：planning → implementing → review_gate → test_gate → done。Luigi/Toad 在 implementing 阶段按前端/后端 lane 并行，Peach/DK/Yoshi 负责门禁。',
      states: [
        { name: 'planning', role: 'mario', description: 'Mario 拆解任务、标注 frontend/backend 域、排列依赖并分派到实现 lane', transitions: [{ from: 'planning', to: 'implementing', condition: '任务分派完成' }] },
        { name: 'implementing', role: 'luigi', description: 'Luigi 负责 frontend lane，Toad 负责 backend lane；两者可并行执行并直接协调接口/契约', transitions: [{ from: 'implementing', to: 'review_gate', condition: '代码变更完成并提交评审请求' }, { from: 'implementing', to: 'planning', condition: '遇到范围或需求阻塞' }] },
        { name: 'review_gate', role: 'peach', description: 'Peach 主审代码质量；DK 仅在架构/schema/安全/性能/跨模块风险触发时介入', transitions: [{ from: 'review_gate', to: 'test_gate', condition: 'Peach/DK 评审通过' }, { from: 'review_gate', to: 'implementing', condition: '评审拒绝并直接打回实现者' }, { from: 'review_gate', to: 'planning', condition: '同一任务拒绝超过 2 次或需要范围决策' }] },
        { name: 'test_gate', role: 'yoshi', description: 'Yoshi 做集成测试、规格一致性和交付完整性验证', transitions: [{ from: 'test_gate', to: 'done', condition: '测试和验收通过' }, { from: 'test_gate', to: 'implementing', condition: '测试失败并直接打回实现者' }, { from: 'test_gate', to: 'review_gate', condition: '发现评审遗漏' }, { from: 'test_gate', to: 'planning', condition: '反复失败或需要取舍' }] },
        { name: 'done', role: '', description: '完成', transitions: [], terminal: true },
      ],
    },
    communicationMatrix: {
      mario: { canSendTo: ['luigi', 'toad', 'peach', 'dk', 'yoshi'], canReceiveFrom: ['luigi', 'toad', 'peach', 'dk', 'yoshi'], canEscalateTo: ['human'] },
      luigi: { canSendTo: ['mario', 'toad', 'peach', 'yoshi'], canReceiveFrom: ['mario', 'toad', 'peach', 'dk', 'yoshi'], canEscalateTo: ['mario'] },
      toad: { canSendTo: ['mario', 'luigi', 'peach', 'dk', 'yoshi'], canReceiveFrom: ['mario', 'luigi', 'peach', 'dk', 'yoshi'], canEscalateTo: ['mario'] },
      peach: { canSendTo: ['mario', 'luigi', 'toad', 'dk', 'yoshi'], canReceiveFrom: ['mario', 'luigi', 'toad', 'dk', 'yoshi'], canEscalateTo: ['mario'] },
      dk: { canSendTo: ['mario', 'luigi', 'toad', 'peach'], canReceiveFrom: ['mario', 'peach', 'yoshi'], canEscalateTo: ['mario'] },
      yoshi: { canSendTo: ['mario', 'luigi', 'toad', 'peach', 'dk'], canReceiveFrom: ['mario', 'luigi', 'toad', 'peach'], canEscalateTo: ['mario'] },
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
      { id: 'planner', displayName: '规划师', required: true, description: '拆解任务、排优先级、梳理依赖', roleCardId: 'preset-planner', soul: '# 规划师\n\n## 核心身份\n我是规划师，负责把模糊的需求变成清晰可执行的任务。\n\n## 核心原则\n- 先理解再拆解\n- 小步快跑\n- 依赖显性化\n- 风险前置' },
      { id: 'coder', displayName: '实现者', required: true, description: '写代码、调 bug、实现功能', roleCardId: 'preset-backend', soul: '# 实现者\n\n## 核心身份\n我是实现者，负责把任务列表变成可运行的代码。\n\n## 核心原则\n- 测试先行（TDD）\n- 小步提交\n- 代码即文档\n- 遵循规范' },
      { id: 'reviewer', displayName: '审查者', required: true, description: '审查质量、发现问题、把关交付', roleCardId: 'preset-code-reviewer', soul: '# 审查者\n\n## 核心身份\n我是审查者，负责确保代码质量。\n\n## 核心原则\n- 标准统一\n- 建设性反馈\n- 证据驱动\n- 及时响应' },
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
