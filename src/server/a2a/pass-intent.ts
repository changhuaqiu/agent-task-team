import type { AgentMentionConfig, MentionTarget } from './types-v2';
import type { PassIntent } from './types-possession';
import { extractMentionContent, scanMentions } from './scanner';

export interface PassIntentTarget extends MentionTarget {
  content: string;
  intent: PassIntent;
}

const ACTION_PATTERNS: Array<{ intent: PassIntent; patterns: RegExp[] }> = [
  {
    intent: 'review',
    patterns: [
      /请\s*(审查|审核|检查|review|评审)/i,
      /需要.*(审查|审核|检查|review|评审)/i,
    ],
  },
  {
    intent: 'implement',
    patterns: [
      /请\s*(实现|开发|修改|修复|落地|execute|implement|build)/i,
      /(交给|handoff to).*?(实现|开发|修改|修复|落地|execute|implement|build)/i,
    ],
  },
  {
    intent: 'verify',
    patterns: [
      /请\s*(验证|测试|确认|verify|test)/i,
      /需要.*(验证|测试|确认|verify|test)/i,
    ],
  },
  {
    intent: 'plan',
    patterns: [
      /请\s*(规划|设计|制定方案|plan|design)/i,
      /需要.*(规划|设计|制定方案|plan|design)/i,
    ],
  },
  {
    intent: 'answer',
    patterns: [
      /请\s*(回答|解释|说明|answer|explain)/i,
      /需要.*(回答|解释|说明|answer|explain)/i,
    ],
  },
  {
    intent: 'delegate',
    patterns: [
      /(交给|转交|传给|派发|分配|指派|handoff to|delegate to|dispatch(?:ed)? to|assign(?:ed)? to)/i,
      /请\s*(处理|跟进|继续|接手)/i,
      /需要.*(处理|跟进|继续|接手)/i,
    ],
  },
];

function detectIntent(content: string): PassIntent | null {
  if (/(不需要|不要|无需|别).*?(转交|传给|交给|派发|分配|指派|处理|跟进|接手|审查|审核|检查|实现|开发|修复|验证|测试|确认)/i.test(content)) {
    return null;
  }
  for (const group of ACTION_PATTERNS) {
    if (group.patterns.some((pattern) => pattern.test(content))) return group.intent;
  }
  return null;
}

function mentionContext(text: string, target: MentionTarget): string {
  const start = Math.max(0, target.position - 160);
  const end = Math.min(text.length, target.position + 240);
  return text.slice(start, end);
}

export function scanPassIntents(
  text: string,
  agents: AgentMentionConfig[],
  selfAgentId = '',
): PassIntentTarget[] {
  return scanMentions(text, agents, selfAgentId)
    .map((target) => {
      const content = extractMentionContent(text, target);
      const directIntent = detectIntent(content);
      if (directIntent) return { ...target, content, intent: directIntent };

      const context = mentionContext(text, target);
      const contextIntent = detectIntent(context);
      if (!contextIntent) return null;

      return { ...target, content: context.trim(), intent: contextIntent };
    })
    .filter((target): target is PassIntentTarget => target !== null);
}
