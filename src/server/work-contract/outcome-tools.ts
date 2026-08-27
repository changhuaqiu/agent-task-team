import type { AgentOutcomeType } from './types';

export const AGENT_OUTCOME_TOOL_BY_TYPE: Record<AgentOutcomeType, string> = {
  continue_work: 'work_continue',
  propose_task_graph: 'task_propose_graph',
  submit_task_result: 'task_submit_result',
  request_review: 'task_request_review',
  record_gate_decision: 'gate_record_decision',
  handoff_to_agent: 'work_handoff',
  report_blocked: 'work_report_blocked',
  request_human_decision: 'work_request_human_decision',
};

export const AGENT_OUTCOME_TYPE_BY_TOOL = new Map<string, AgentOutcomeType>(
  Object.entries(AGENT_OUTCOME_TOOL_BY_TYPE).map(([outcomeType, toolName]) => [
    toolName,
    outcomeType as AgentOutcomeType,
  ]),
);
