import type { SkillActivationReason } from '@/lib/skills/types';
import type { ContextScenario } from '@/lib/agent-context/scenarioResolver';
import type { AgentActivationCommand, AgentExecutionMode, AgentActivationSource } from './types';

export type ExecutionStage = 'plan' | 'implement' | 'review' | 'verify' | 'recover' | 'close';
export type ExecutionCapability = 'task_receipt' | 'browser_verification' | 'git_collaboration';
export type ExecutionExitPolicy = 'structured_outcome' | 'gate_decision' | 'outcome_recovery';

export interface ExecutionProfile {
  stage: ExecutionStage;
  eligibleSkillIds: string[];
  activatedSkills: Array<{ skillId: string; reason: SkillActivationReason }>;
  requiredSkillIds: string[];
  missingRequiredSkillNames: string[];
  capabilities: ExecutionCapability[];
  exitPolicy: ExecutionExitPolicy;
}

export interface ExecutionProfileSkill {
  id?: string;
  name: string;
}

export interface ResolveExecutionProfileInput {
  source: AgentActivationSource;
  executionMode?: AgentExecutionMode;
  contextScenario?: ContextScenario;
  prompt: string;
  task?: { title: string; description?: string | null };
  deliveryPolicy?: { requireWebE2E?: boolean; requireMerge?: boolean };
  skills: ExecutionProfileSkill[];
}

const ROUTED_PLATFORM_SKILLS = new Set([
  'task-management',
  'task-status-receipt',
  'git-collaboration',
  'code-review',
  'browser-verification',
]);

const BROWSER_SIGNAL = /(?:\bplaywright\b|\bweb\s*e2e\b|\bbrowser\b|浏览器|页面实测|端到端)/iu;
const GIT_SIGNAL = /(?:\bgithub\b|\bgitlab\b|\bpull\s*request\b|\bmerge\s*request\b|\bpr\b|推送|合并)/iu;
const EXPLICIT_SKILL = /(?:^|\s)\$([a-z0-9]+(?:-[a-z0-9]+)*)\b/giu;

function resolveStage(input: ResolveExecutionProfileInput): ExecutionStage {
  if (input.executionMode === 'outcome_recovery') return 'recover';
  if (input.source === 'review_gate' || input.contextScenario === 'code_review') return 'review';
  if (input.source === 'test_gate' || input.contextScenario === 'verification') return 'verify';
  if (input.contextScenario === 'planning' || input.contextScenario === 'goal_intake') return 'plan';
  if (input.contextScenario === 'closure') return 'close';
  if (input.contextScenario === 'recovery') return 'recover';
  return 'implement';
}

function normalizedSkills(skills: ExecutionProfileSkill[]): Array<{ id: string; name: string }> {
  return skills
    .filter((skill): skill is ExecutionProfileSkill & { id: string } => Boolean(skill.id?.trim()))
    .map((skill) => ({ id: skill.id.trim(), name: skill.name.trim().toLowerCase() }));
}

export function resolveExecutionProfile(input: ResolveExecutionProfileInput): ExecutionProfile {
  const stage = resolveStage(input);
  if (input.executionMode === 'outcome_recovery') {
    return {
      stage,
      eligibleSkillIds: [],
      activatedSkills: [],
      requiredSkillIds: [],
      missingRequiredSkillNames: [],
      capabilities: [],
      exitPolicy: 'outcome_recovery',
    };
  }

  const skills = normalizedSkills(input.skills);
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const activated = new Map<string, SkillActivationReason>();
  const required = new Set<string>();
  const missingRequiredSkillNames = new Set<string>();
  const capabilities = new Set<ExecutionCapability>();
  const taskText = [input.prompt, input.task?.title, input.task?.description]
    .filter(Boolean)
    .join('\n');

  const activate = (name: string, reason: SkillActivationReason, isRequired = false) => {
    const skill = byName.get(name);
    if (!skill) {
      if (isRequired) missingRequiredSkillNames.add(name);
      return;
    }
    activated.set(skill.id, reason);
    if (isRequired) required.add(skill.id);
  };

  for (const skill of skills) {
    if (!ROUTED_PLATFORM_SKILLS.has(skill.name)) {
      activated.set(skill.id, 'agent_binding');
    }
  }

  if (input.task) {
    activate('task-status-receipt', 'task', true);
    if (byName.has('task-status-receipt')) capabilities.add('task_receipt');
  }
  if (stage === 'plan') activate('task-management', 'rule', true);
  if (stage === 'review') activate('code-review', 'rule');

  const requiresBrowser = input.deliveryPolicy?.requireWebE2E === true
    || BROWSER_SIGNAL.test(taskText);
  if (requiresBrowser) {
    activate('browser-verification', 'rule', true);
    capabilities.add('browser_verification');
  }

  if (input.deliveryPolicy?.requireMerge === true || GIT_SIGNAL.test(taskText)) {
    activate('git-collaboration', 'rule');
    if (byName.has('git-collaboration')) capabilities.add('git_collaboration');
  }

  for (const match of taskText.matchAll(EXPLICIT_SKILL)) {
    activate(match[1].toLowerCase(), 'explicit', true);
  }

  return {
    stage,
    eligibleSkillIds: skills.map((skill) => skill.id),
    activatedSkills: [...activated].map(([skillId, reason]) => ({ skillId, reason })),
    requiredSkillIds: [...required],
    missingRequiredSkillNames: [...missingRequiredSkillNames],
    capabilities: [...capabilities],
    exitPolicy: stage === 'review' || stage === 'verify' ? 'gate_decision' : 'structured_outcome',
  };
}

export function resolveExecutionProfileForTrigger(input: {
  trigger: AgentActivationCommand;
  task?: ResolveExecutionProfileInput['task'];
  deliveryPolicy?: ResolveExecutionProfileInput['deliveryPolicy'];
  skills: ExecutionProfileSkill[];
}): ExecutionProfile {
  return resolveExecutionProfile({
    source: input.trigger.source,
    executionMode: input.trigger.executionMode,
    contextScenario: input.trigger.contextScenario,
    prompt: input.trigger.prompt,
    task: input.task,
    deliveryPolicy: input.deliveryPolicy,
    skills: input.skills,
  });
}
