import { describe, it, expect } from 'vitest';
import type { RoleCard } from '@/types/roleCard';
import type { ChatMessage } from '@/store/taskHubStore';
import { buildRoleLayer } from '@/lib/agent-context/layers/roleLayer';
import { buildProjectLayer } from '@/lib/agent-context/layers/projectLayer';
import { buildTeamLayer } from '@/lib/agent-context/layers/teamLayer';
import { buildHistoryLayer } from '@/lib/agent-context/layers/historyLayer';
import { buildTaskContextLayer } from '@/lib/agent-context/layers/taskContextLayer';
import { buildUserMessageLayer } from '@/lib/agent-context/layers/userMessageLayer';
import { buildBehaviorLayer } from '@/lib/agent-context/layers/behaviorLayer';
import { composeSystemPrompt, composeUserPrompt } from '@/lib/agent-context/PromptComposer';
import type { ComposeOptions } from '@/lib/agent-context/PromptComposer';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeRoleCard(overrides: Partial<RoleCard> = {}): RoleCard {
  return {
    id: 'test-role',
    name: 'Test Role',
    displayName: '测试角色',
    description: 'A test role card',
    category: 'planner',
    tags: [],
    applicableScenarios: [],
    responsibilities: [],
    nonResponsibilities: [],
    successCriteria: [],
    clarifyBeforeExecute: 'when_ambiguous',
    outputStyle: 'concise',
    preferStructuredOutput: false,
    allowedActions: [],
    requiresConfirmation: [],
    forbiddenActions: [],
    preferredEngines: [],
    allowedTools: [],
    accountIds: [],
    outputFormat: 'freeform',
    requiresEvidence: false,
    riskGrading: 'none',
    isPreset: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    agentId: 'human',
    content: 'hello',
    timestamp: '2026-05-03T10:00:00Z',
    ...overrides,
  };
}

const agent = { id: 'mario', name: 'Mario' };

// ===========================================================================
// roleLayer
// ===========================================================================
describe('buildRoleLayer', () => {
  it('returns empty string when no roleCard provided', () => {
    expect(buildRoleLayer(agent)).toBe('');
    expect(buildRoleLayer(agent, undefined)).toBe('');
  });

  it('includes persona introduction', () => {
    const rc = makeRoleCard({
      persona: { introduction: '我是规划专家', voice: '', mindset: '', habits: '', collaboration: '' },
    });
    const result = buildRoleLayer(agent, rc);
    expect(result).toContain('我是规划专家');
  });

  it('includes persona dimensions (voice, mindset, habits, collaboration)', () => {
    const rc = makeRoleCard({
      persona: {
        introduction: 'intro',
        voice: '友好语气',
        mindset: '结构化思维',
        habits: '先分析后执行',
        collaboration: '主动沟通',
      },
    });
    const result = buildRoleLayer(agent, rc);
    expect(result).toContain('## 语气风格');
    expect(result).toContain('友好语气');
    expect(result).toContain('## 思维模式');
    expect(result).toContain('结构化思维');
    expect(result).toContain('## 工作习惯');
    expect(result).toContain('先分析后执行');
    expect(result).toContain('## 协作风格');
    expect(result).toContain('主动沟通');
  });

  it('omits empty persona dimensions', () => {
    const rc = makeRoleCard({
      persona: { introduction: 'intro', voice: 'voice', mindset: '', habits: '', collaboration: '' },
    });
    const result = buildRoleLayer(agent, rc);
    expect(result).toContain('## 语气风格');
    expect(result).not.toContain('## 思维模式');
    expect(result).not.toContain('## 工作习惯');
    expect(result).not.toContain('## 协作风格');
  });

  it('includes constraints section with responsibilities', () => {
    const rc = makeRoleCard({
      responsibilities: ['任务分解', '资源协调'],
      nonResponsibilities: ['直接编码'],
      forbiddenActions: ['修改数据库'],
    });
    const result = buildRoleLayer(agent, rc);
    expect(result).toContain('## 角色约束');
    expect(result).toContain('- 职责：任务分解、资源协调');
    expect(result).toContain('- 非职责：直接编码');
    expect(result).toContain('- 禁止：修改数据库');
  });

  it('includes evidence constraint', () => {
    const rc = makeRoleCard({ requiresEvidence: true });
    const result = buildRoleLayer(agent, rc);
    expect(result).toContain('- 评审/建议必须附带具体证据和文件引用');
  });

  it('includes outputFormat constraint when not freeform', () => {
    const rc = makeRoleCard({ outputFormat: 'structured_list' });
    const result = buildRoleLayer(agent, rc);
    expect(result).toContain('- 输出格式：结构化列表');
  });

  it('omits outputFormat constraint when freeform', () => {
    const rc = makeRoleCard({ outputFormat: 'freeform', category: 'frontend' });
    const result = buildRoleLayer(agent, rc);
    expect(result).not.toContain('输出格式');
  });

  it('includes propose-only constraint', () => {
    const rc = makeRoleCard({ allowedActions: ['can_propose_only'] });
    const result = buildRoleLayer(agent, rc);
    expect(result).toContain('- 只能提出建议，不能直接修改代码');
  });

  it('omits propose-only constraint when also has can_modify_code', () => {
    const rc = makeRoleCard({
      allowedActions: ['can_propose_only', 'can_modify_code'],
    });
    const result = buildRoleLayer(agent, rc);
    expect(result).not.toContain('只能提出建议');
  });

  it('includes confirmation constraint', () => {
    const rc = makeRoleCard({ requiresConfirmation: ['架构变更', '数据库迁移'] });
    const result = buildRoleLayer(agent, rc);
    expect(result).toContain('- 以下操作需用户确认：架构变更、数据库迁移');
  });

  it('omits constraints section when none apply', () => {
    const rc = makeRoleCard();
    const result = buildRoleLayer(agent, rc);
    expect(result).not.toContain('## 角色约束');
  });
});

// ===========================================================================
// projectLayer
// ===========================================================================
describe('buildProjectLayer', () => {
  it('includes project name, path, and spec file reminder', () => {
    const result = buildProjectLayer({ name: 'MyApp', path: '/home/user/app' });
    expect(result).toContain('## 项目上下文');
    expect(result).toContain('- 项目：MyApp');
    expect(result).toContain('- 工作目录：/home/user/app');
    expect(result).toContain('CLAUDE.md / AGENTS.md');
  });

  it('omits empty project name', () => {
    const result = buildProjectLayer({ name: '', path: '/home/user/app' });
    expect(result).not.toContain('- 项目：');
    expect(result).toContain('- 工作目录：/home/user/app');
  });
});

// ===========================================================================
// teamLayer
// ===========================================================================
describe('buildTeamLayer', () => {
  it('returns non-empty team layer with roster and rules', () => {
    const result = buildTeamLayer('mario', []);
    expect(result).not.toBe('');
    expect(result).toContain('@luigi');
    expect(result).toContain('协作规则');
  });

  it('builds roster table excluding self and includes collaboration rules', () => {
    const rc = makeRoleCard({
      id: 'preset-frontend',
      displayName: '前端工程师',
      category: 'frontend',
      responsibilities: ['组件开发', '样式实现', '页面交互'],
    });
    const result = buildTeamLayer('mario', [rc]);
    expect(result).not.toBe('');
    expect(result).not.toContain('@mario');
    expect(result).toContain('@luigi');
    expect(result).toContain('实现'); // ROLE_LABELS[frontend] = '实现'
    expect(result).toContain('协作规则');
    expect(result).toContain('@agentId');
  });

  it('uses fallback roleLabel when no matching role card', () => {
    const result = buildTeamLayer('mario', []);
    expect(result).not.toBe('');
  });
});

// ===========================================================================
// historyLayer
// ===========================================================================
describe('buildHistoryLayer', () => {
  it('returns empty string for empty messages', () => {
    expect(buildHistoryLayer([], 'mario')).toBe('');
  });

  it('formats messages with timestamps and sender labels', () => {
    const messages: ChatMessage[] = [
      makeMessage({ agentId: 'human', content: '你好', timestamp: '2026-05-03T10:00:00Z' }),
      makeMessage({ agentId: 'mario', content: '收到', timestamp: '2026-05-03T10:01:00Z' }),
    ];
    const result = buildHistoryLayer(messages, 'mario');
    expect(result).toContain('[对话历史 - 最近 2 条]');
    expect(result).toContain('[/对话历史]');
    expect(result).toContain('用户');
    expect(result).toContain('你（之前）');
    expect(result).toContain('你好');
    expect(result).toContain('收到');
  });

  it('shows agentId as sender for other agents', () => {
    const messages: ChatMessage[] = [
      makeMessage({ agentId: 'luigi', content: 'hi', timestamp: '2026-05-03T10:00:00Z' }),
    ];
    const result = buildHistoryLayer(messages, 'mario');
    expect(result).toContain('luigi');
    expect(result).not.toContain('你（之前）');
  });

  it('shows (工具调用) for empty content', () => {
    const messages: ChatMessage[] = [
      makeMessage({ agentId: 'mario', content: '', timestamp: '2026-05-03T10:00:00Z' }),
    ];
    const result = buildHistoryLayer(messages, 'mario');
    expect(result).toContain('(工具调用)');
  });

  it('limits to last 10 messages', () => {
    const messages: ChatMessage[] = Array.from({ length: 15 }, (_, i) =>
      makeMessage({
        id: `msg-${i}`,
        agentId: 'human',
        content: `message ${i}`,
        timestamp: `2026-05-03T10:${String(i).padStart(2, '0')}:00Z`,
      }),
    );
    const result = buildHistoryLayer(messages, 'mario');
    expect(result).toContain('最近 10 条');
    // Should contain the last message (index 14) but not the first (index 0)
    expect(result).toContain('message 14');
    expect(result).not.toContain('message 0');
    expect(result).not.toContain('message 4');
    expect(result).toContain('message 5');
  });

  it('truncates long content', () => {
    const longContent = 'a'.repeat(300);
    const messages: ChatMessage[] = [
      makeMessage({ agentId: 'human', content: longContent, timestamp: '2026-05-03T10:00:00Z' }),
    ];
    const result = buildHistoryLayer(messages, 'mario');
    expect(result).toContain('[截断]');
  });
});

// ===========================================================================
// taskContextLayer
// ===========================================================================
describe('buildTaskContextLayer', () => {
  it('wraps task id, title, description, and phase', () => {
    const result = buildTaskContextLayer({
      id: 'T-1',
      title: 'Build feature',
      description: 'Implement the new dashboard',
      phase: { title: '开发阶段' },
    });
    expect(result).toContain('[任务: T-1 Build feature]');
    expect(result).toContain('[阶段: 开发阶段]');
    expect(result).toContain('Implement the new dashboard');
  });

  it('omits phase when not provided', () => {
    const result = buildTaskContextLayer({
      id: 'T-2',
      title: 'Fix bug',
    });
    expect(result).toContain('[任务: T-2 Fix bug]');
    expect(result).not.toContain('[阶段:');
  });

  it('omits description when not provided', () => {
    const result = buildTaskContextLayer({
      id: 'T-3',
      title: 'Test task',
    });
    expect(result).toBe('[任务: T-3 Test task]');
  });
});

// ===========================================================================
// userMessageLayer
// ===========================================================================
describe('buildUserMessageLayer', () => {
  it('strips @mentions and trims', () => {
    expect(buildUserMessageLayer('@mario 请帮我规划任务')).toBe('请帮我规划任务');
    expect(buildUserMessageLayer('  hello world  ')).toBe('hello world');
    expect(buildUserMessageLayer('@luigi @toad do something')).toBe('do something');
  });

  it('falls back to greeting when empty', () => {
    expect(buildUserMessageLayer('')).toBe('你好，请就绪并等待指令。');
    expect(buildUserMessageLayer('@mario')).toBe('你好，请就绪并等待指令。');
    expect(buildUserMessageLayer('   ')).toBe('你好，请就绪并等待指令。');
  });
});

// ===========================================================================
// behaviorLayer
// ===========================================================================
describe('buildBehaviorLayer', () => {
  it('returns decision nudge text', () => {
    const result = buildBehaviorLayer();
    expect(result).toContain('是否需要交接给其他角色');
    expect(result).toContain('是否需要请求用户确认');
  });
});

// ===========================================================================
// composeSystemPrompt
// ===========================================================================
describe('composeSystemPrompt', () => {
  const baseOpts: ComposeOptions = {
    agent: { id: 'mario', name: 'Mario' },
    allRoleCards: [],
    project: { name: 'TestApp', path: '/tmp/test' },
    isFirstWake: true,
    rawPrompt: 'hello',
  };

  it('builds full system prompt on first wake', () => {
    const rc = makeRoleCard({
      persona: { introduction: '我是规划专家', voice: '', mindset: '', habits: '', collaboration: '' },
    });
    const result = composeSystemPrompt({ ...baseOpts, roleCard: rc });
    expect(result).toBeDefined();
    expect(result!).toContain('我是规划专家');
    expect(result!).toContain('## 项目上下文');
    expect(result!).not.toContain('@luigi');
  });

  it('returns undefined on subsequent wake', () => {
    const result = composeSystemPrompt({ ...baseOpts, isFirstWake: false });
    expect(result).toBeUndefined();
  });
});

// ===========================================================================
// composeUserPrompt
// ===========================================================================
describe('composeUserPrompt', () => {
  const baseOpts: ComposeOptions = {
    agent: { id: 'mario', name: 'Mario' },
    allRoleCards: [],
    project: { name: 'TestApp', path: '/tmp/test' },
    isFirstWake: true,
    rawPrompt: '请开始工作',
  };

  it('builds user prompt with history, message, and behavior on first wake', () => {
    const messages: ChatMessage[] = [
      makeMessage({ agentId: 'human', content: '你好', timestamp: '2026-05-03T10:00:00Z' }),
    ];
    const result = composeUserPrompt({ ...baseOpts, messages });
    expect(result).toContain('[对话历史');
    expect(result).toContain('请开始工作');
    expect(result).toContain('是否需要交接给其他角色');
  });

  it('includes history on subsequent wake too', () => {
    const messages: ChatMessage[] = [
      makeMessage({ agentId: 'human', content: '你好', timestamp: '2026-05-03T10:00:00Z' }),
    ];
    const result = composeUserPrompt({ ...baseOpts, isFirstWake: false, messages });
    expect(result).toContain('[对话历史');
    expect(result).toContain('请开始工作');
    expect(result).toContain('是否需要交接给其他角色');
  });

  it('includes team roster on every dispatch', () => {
    const result = composeUserPrompt(baseOpts);
    expect(result).toContain('@luigi');
  });

  it('includes task context when task provided', () => {
    const result = composeUserPrompt({
      ...baseOpts,
      task: { id: 'T-1', title: 'Build feature', description: 'desc', phase: { title: '开发' } },
    });
    expect(result).toContain('[任务: T-1 Build feature]');
    expect(result).toContain('[阶段: 开发]');
  });

  it('falls back to greeting for empty prompt', () => {
    const result = composeUserPrompt({ ...baseOpts, rawPrompt: '' });
    expect(result).toContain('你好，请就绪并等待指令。');
  });

  it('joins parts with separator', () => {
    const result = composeUserPrompt(baseOpts);
    expect(result).toContain('\n\n---\n\n');
  });
});

// ===========================================================================
// composeUserPrompt with skills (moved from system prompt)
// ===========================================================================
describe('composeUserPrompt with skills', () => {
  const baseOpts: ComposeOptions = {
    agent: { id: 'mario', name: 'Mario' },
    allRoleCards: [],
    project: { name: 'TestApp', path: '/tmp/test' },
    isFirstWake: true,
    rawPrompt: 'hello',
  };

  it('includes skill content when skills provided', () => {
    const result = composeUserPrompt({
      ...baseOpts,
      skills: [{ name: 'code-review', content: 'Review carefully.' }],
    });
    expect(result).toContain('## Skill: code-review');
  });

  it('works without skills', () => {
    const result = composeUserPrompt(baseOpts);
    expect(result).not.toContain('## Skill:');
  });

  it('includes protocol layer', () => {
    const result = composeUserPrompt(baseOpts);
    expect(result).toContain('任务协作协议');
    expect(result).toContain('.ath/TASKS.md');
  });
});
