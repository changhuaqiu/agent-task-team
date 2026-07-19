import type { AgentMentionConfig, MentionTarget } from './types-v2';
import type { PassIntent } from './types-possession';
import { extractMentionContent, scanMentions } from './scanner';

export interface PassIntentTarget extends MentionTarget {
  content: string;
  intent: PassIntent;
}

const ACTION_PATTERNS: Array<{ intent: PassIntent; patterns: RegExp[] }> = [
  {
    intent: 'reject',
    patterns: [
      /(打回|驳回|拒绝|不通过|未通过|reject|rejected|request changes)/i,
      /请.*?(修正|返工|重做|重新修改|按.+修改|修复|fix the review|address review)/i,
      /(请|需要).*?(修复|修正|返工|修改).*?(问题|bug|issue|阻塞|blocker|R\d+)/i,
      /测试.*?(失败|未通过).*?(请|需要).*?(修复|修改)/i,
      /(反馈给|打回给|退回给).*?(实现者|开发|Luigi|Toad|前端|后端)/i,
    ],
  },
  {
    intent: 'escalate',
    patterns: [
      /(升级|上报|请.*决策|需要.*决策|需要.*取舍|escalate|decision needed)/i,
      /(超出|越界|范围不清|需求冲突|scope boundary|blocked by scope)/i,
      /(找|请).{0,4}?(Mario|统筹|协调者).{0,4}?(决策|介入|取舍|判断)/i,
    ],
  },
  {
    intent: 'coord',
    patterns: [
      /(对齐|确认接口|接口定义|契约|联调|coord|coordinate|sync on|align)/i,
      /请.*?(确认|对齐).*?(接口|契约|字段|API|交互)/i,
      /(找|和|跟|与).{0,4}?(Luigi|Toad|前端|后端).{0,6}?(对齐|确认|协调|配合)/i,
    ],
  },
  {
    intent: 'handoff_test',
    patterns: [
      /(handoff test|交给.*测试|进入.*测试|进入.*验收|交给.*验收)/i,
      /请\s*(做|执行|开始)?\s*(集成测试|验收|回归测试|QA|test gate)/i,
      /(review|评审).*(通过|pass|passed).*?(测试|验收|QA|test)/i,
      /(交给|转交|handoff).{0,4}?(Yoshi|QA|测试|验收)/i,
    ],
  },
  {
    intent: 'review',
    patterns: [
      /请\s*(审查|审核|检查|review|评审|评估|评估架构)/i,
      /请\s*(做|进行|执行).*?(审查|审核|检查|review|评审|评估)/i,
      /需要.*(审查|审核|检查|review|评审|评估)/i,
      /(找|请求|交给).{0,4}?(DK|架构|评审).{0,4}?(评估|审查|评审|审核|检查|反馈)/i,
    ],
  },
  {
    intent: 'implement',
    patterns: [
      /请\s*(?:立即|马上|尽快)?\s*(实现|开发|修改|修复|落地|execute|implement|build|fix|update)/i,
      /^\s*(实现|开发|修改|修复|落地|execute|implement|build|fix|update)/i,
      /请.*?(实现|开发|修改|修复|落地|execute|implement|build|fix|update)/i,
      /(开始|继续).*?(实现|开发|修改|修复|落地|execute|implement|build|fix|update)/i,
      /(交给|handoff to).*?(实现|开发|修改|修复|落地|execute|implement|build|fix|update)/i,
      /(please|pls)\s*(fix|update|implement|build|execute)/i,
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
      /(交给|转交|传给|派发|分派|分发|分配|指派|安排|拆给|拆分给|handoff to|delegate to|dispatch(?:ed)? to|assign(?:ed)? to)/i,
      /请\s*(?:立即|马上|尽快)?\s*(启动|执行|完成|认领|推进|处理|跟进|继续|接手)/i,
      /^\s*(启动|执行|完成|认领|推进|处理|跟进|继续|接手)/i,
      /需要.*(启动|执行|完成|认领|推进|处理|跟进|继续|接手)/i,
      /(下一步|麻烦|请|需要).*?(启动|执行|完成|认领|推进)\s*(TASK-|任务|#)/i,
      /请\s*(汇总|总结|收口|给出.{0,12}结论)/i,
      /(汇总|总结|收口).{0,24}(结论|报告|证据|结果|原文)/i,
    ],
  },
];

function detectPositiveIntent(content: string): PassIntent | null {
  for (const group of ACTION_PATTERNS) {
    if (group.patterns.some((pattern) => pattern.test(content))) return group.intent;
  }
  return null;
}

function detectIntent(content: string): PassIntent | null {
  const negativeActionPattern = /(不需要|不要|无需|不用|不必|请勿|切勿|别|禁止).*?(转交|传给|交给|派发|分派|分发|分配|指派|安排|拆给|拆分给|启动|执行|完成|认领|推进|处理|跟进|接手|审查|审核|检查|实现|开发|修复|验证|测试|确认)/i;
  const negativeMatch = negativeActionPattern.exec(content);
  if (negativeMatch) return null;
  if (/(已|已经|之前|刚才|当前|正在|完成|完毕|结束).*?(转交|传给|交给|派发|分派|分发|分配|指派|安排|启动|执行|认领|推进|assigned?|dispatched?)/i.test(content)) {
    return null;
  }
  if (/(已|已经).*(完成|写入|更新|记录|提交).*?@[\p{L}\p{N}_-]+/iu.test(content)) {
    return null;
  }
  return detectPositiveIntent(content);
}

function extractIntentClause(text: string, position: number): string {
  const boundaries = /[，,；;。！？!?\n]/;
  let start = position;
  let end = position;
  while (start > 0 && !boundaries.test(text[start - 1])) start -= 1;
  while (end < text.length && !boundaries.test(text[end])) end += 1;
  return text.slice(start, end).trim();
}

function isTaskRosterClause(content: string): boolean {
  return /^\s*(?:[-*]\s*)?(?:TASK\s*:\s*)?TASK-\d+\b.*@[\p{L}\p{N}_-]+\s*$/iu.test(content);
}

function hasNotificationPredicateBeforeMention(text: string, position: number): boolean {
  const before = text.slice(Math.max(0, position - 40), position);
  return /(?:并|然后|同时|仅)?\s*(?:知会|通知|告知|同步给?|抄送)\s*$/i.test(before)
    || /(?:不要|不需要|无需|不用|不必|请勿|切勿|别|禁止)\s*$/i.test(before);
}

export function scanPassIntents(
  text: string,
  agents: AgentMentionConfig[],
  selfAgentId = '',
): PassIntentTarget[] {
  const targets = scanMentions(text, agents, selfAgentId);
  return targets
    .map((target, index) => {
      let directContent = extractMentionContent(text, target);
      if (targets[index + 1]) {
        const boundary = Math.max(
          directContent.lastIndexOf('，'), directContent.lastIndexOf(','),
          directContent.lastIndexOf('；'), directContent.lastIndexOf(';'),
          directContent.lastIndexOf('。'), directContent.lastIndexOf('\n'),
        );
        if (boundary >= 0) directContent = directContent.slice(0, boundary);
      }
      if (hasNotificationPredicateBeforeMention(text, target.position)) return null;
      const directIntent = detectIntent(directContent);
      if (directIntent) return { ...target, content: directContent, intent: directIntent };
      const clause = extractIntentClause(text, target.position);
      if (isTaskRosterClause(clause)) return null;
      const clauseIntent = detectIntent(clause);
      if (clauseIntent) return { ...target, content: clause, intent: clauseIntent };
      return null;
    })
    .filter((target): target is PassIntentTarget => target !== null);
}
