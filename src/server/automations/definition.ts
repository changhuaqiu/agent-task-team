import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
} from '@/shared/automation';
import { automationEventDescriptor } from '@/shared/automation-event-registry';
import { isAutomationProductCommandName } from '@/shared/automation-action-registry';

const CONDITION_FIELDS = new Set<AutomationCondition['field']>([
  'type',
  'actor.id',
  'subject.type',
  'payload.status',
  'payload.previousStatus',
  'payload.agentId',
  'payload.summary',
  'payload.content',
  'payload.senderId',
]);

const CONDITION_OPERATORS = new Set<AutomationCondition['operator']>([
  'equals',
  'not_equals',
  'contains',
]);

export interface AutomationDefinitionInput {
  name: string;
  description?: string;
  trigger: AutomationTrigger;
  actions: AutomationAction[];
}

export function validateAutomationDefinition(input: AutomationDefinitionInput): void {
  if (!input || typeof input !== 'object') throw new Error('automation_definition_invalid');
  if (typeof input.name !== 'string' || !input.name.trim()) throw new Error('automation_name_required');
  if (!input.trigger || typeof input.trigger !== 'object') throw new Error('automation_trigger_required');
  if (input.trigger.type === 'event') {
    if (typeof input.trigger.eventType !== 'string' || !input.trigger.eventType.trim()) throw new Error('automation_event_type_required');
    if (input.trigger.eventType.startsWith('automation.')) throw new Error('automation_recursive_trigger_forbidden');
    const descriptor = automationEventDescriptor(input.trigger.eventType);
    if (!descriptor) throw new Error('automation_event_type_unsupported');
    if (!Array.isArray(input.trigger.conditions)) throw new Error('automation_conditions_invalid');
    const allowedFields = new Set(descriptor.fields.map((field) => field.id));
    for (const condition of input.trigger.conditions) {
      validateCondition(condition);
      if (!allowedFields.has(condition.field)) throw new Error('automation_condition_field_not_available');
    }
  } else if (input.trigger.type === 'schedule') {
    if (!Number.isSafeInteger(input.trigger.intervalMinutes) || input.trigger.intervalMinutes < 1 || input.trigger.intervalMinutes > 43_200) {
      throw new Error('automation_schedule_interval_invalid');
    }
  } else if (input.trigger.type !== 'manual') {
    throw new Error('automation_trigger_invalid');
  }
  if (!Array.isArray(input.actions) || input.actions.length === 0) throw new Error('automation_actions_required');
  if (input.actions.length > 20) throw new Error('automation_action_limit_exceeded');
  const ids = new Set<string>();
  for (const action of input.actions) {
    if (!action || typeof action !== 'object' || typeof action.id !== 'string' || !action.id.trim() || ids.has(action.id)) throw new Error('automation_action_id_invalid');
    ids.add(action.id);
    if (action.type === 'notify') {
      if (typeof action.message !== 'string' || !action.message.trim()) throw new Error('automation_notification_required');
    } else if (action.type === 'dispatch_agent') {
      if (typeof action.agentId !== 'string' || !action.agentId.trim()) throw new Error('automation_agent_required');
      if (typeof action.prompt !== 'string' || !action.prompt.trim()) throw new Error('automation_agent_prompt_required');
    } else if (action.type === 'product_command') {
      if (!action.command || !isAutomationProductCommandName(action.command.name)) throw new Error('automation_product_command_unsupported');
      const commandInput = action.command.input;
      if (!commandInput || typeof commandInput.title !== 'string' || !commandInput.title.trim()) {
        throw new Error('automation_work_title_required');
      }
      if (!['issue', 'change_request', 'improvement'].includes(commandInput.category)) {
        throw new Error('automation_work_category_invalid');
      }
      if (commandInput.description !== undefined && typeof commandInput.description !== 'string') {
        throw new Error('automation_work_description_invalid');
      }
    } else if (action.type === 'request_decision') {
      if (typeof action.prompt !== 'string' || !action.prompt.trim()) throw new Error('automation_decision_prompt_required');
    } else {
      throw new Error('automation_action_invalid');
    }
  }
}

function validateCondition(condition: AutomationCondition): void {
  if (!condition || typeof condition !== 'object') throw new Error('automation_condition_invalid');
  if (!CONDITION_FIELDS.has(condition.field)) throw new Error('automation_condition_field_invalid');
  if (!CONDITION_OPERATORS.has(condition.operator)) throw new Error('automation_condition_operator_invalid');
  if (typeof condition.value !== 'string' || !condition.value.trim()) throw new Error('automation_condition_value_required');
}
