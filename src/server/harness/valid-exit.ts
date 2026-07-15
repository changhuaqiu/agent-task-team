import type { ContextScenario } from '../../lib/agent-context/scenarioResolver';

export interface ValidExitResult {
  valid: boolean;
  reason: 'substantive_output' | 'scenario_marker' | 'empty' | 'placeholder' | 'missing_scenario_exit';
}

const PLACEHOLDER = /^(?:收到|好的?|明白|了解|我看看|稍等|ok(?:ay)?|got it|ack)[。.!！\s]*$/i;

export function checkValidExit(scenario: ContextScenario, outcome: string | undefined): ValidExitResult {
  const text = outcome?.trim() ?? '';
  if (!text) return { valid: false, reason: 'empty' };
  if (PLACEHOLDER.test(text)) return { valid: false, reason: 'placeholder' };

  if (scenario === 'closure') {
    const required = ['GOAL', 'DELIVERED', 'NOT DONE'];
    return required.every((marker) => new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?${marker}\\s*[:：]`, 'i').test(text))
      ? { valid: true, reason: 'scenario_marker' }
      : { valid: false, reason: 'missing_scenario_exit' };
  }

  if (scenario === 'handoff') {
    return /(接受|推进|完成|拒绝|不适合|原因|转交|转传|handoff|delegate|reject|blocked|in[_ -]?progress)/i.test(text)
      ? { valid: true, reason: 'scenario_marker' }
      : { valid: false, reason: 'missing_scenario_exit' };
  }

  if (scenario === 'wakeup') {
    return /(完成|推进|产出|交付|更新|阻塞|原因|无法|等待|done|delivered|progress|blocked|waiting)/i.test(text)
      ? { valid: true, reason: 'scenario_marker' }
      : { valid: false, reason: 'missing_scenario_exit' };
  }

  return text.length >= 12
    ? { valid: true, reason: 'substantive_output' }
    : { valid: false, reason: 'missing_scenario_exit' };
}
