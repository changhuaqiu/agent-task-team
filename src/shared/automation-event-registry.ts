import type { AutomationCondition } from './automation';

export interface AutomationEventField {
  id: AutomationCondition['field'];
  label: string;
}

export interface AutomationEventDescriptor {
  type: string;
  label: string;
  fields: AutomationEventField[];
}

const COMMON_FIELDS: AutomationEventField[] = [
  { id: 'actor.id', label: '发起者' },
  { id: 'subject.type', label: '对象类型' },
];

/**
 * The only event contracts exposed to end users. Each entry is backed by a
 * production PlatformEvent emitter; keeping this registry shared prevents the
 * editor from advertising conditions that can never match.
 */
export const AUTOMATION_EVENT_REGISTRY: AutomationEventDescriptor[] = [
  {
    type: 'review.decision_recorded',
    label: '评审产生决定',
    fields: [
      { id: 'payload.status', label: '决定' },
      { id: 'payload.summary', label: '评审说明' },
      ...COMMON_FIELDS,
    ],
  },
  {
    type: 'task.done',
    label: '工作已完成',
    fields: [
      { id: 'payload.status', label: '状态' },
      { id: 'payload.previousStatus', label: '原状态' },
      { id: 'payload.agentId', label: 'Agent' },
      ...COMMON_FIELDS,
    ],
  },
  {
    type: 'task.blocked',
    label: '工作被阻塞',
    fields: [
      { id: 'payload.status', label: '状态' },
      { id: 'payload.previousStatus', label: '原状态' },
      { id: 'payload.agentId', label: 'Agent' },
      ...COMMON_FIELDS,
    ],
  },
  {
    type: 'chat.message.persisted',
    label: '项目收到消息',
    fields: [
      { id: 'payload.content', label: '消息内容' },
      { id: 'payload.senderId', label: '发送者' },
      ...COMMON_FIELDS,
    ],
  },
];

export function automationEventDescriptor(eventType: string): AutomationEventDescriptor | undefined {
  return AUTOMATION_EVENT_REGISTRY.find((entry) => entry.type === eventType);
}
