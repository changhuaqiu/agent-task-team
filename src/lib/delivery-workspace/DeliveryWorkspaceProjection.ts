import type { Blocker, Conversation } from '@/store/taskHubStore';
import type { Task } from '@/store/taskStore';
import type { ChatMessage } from '@/store/types';
import type { DeliveryRunSnapshot, DeliveryStage } from '@/server/autonomous-delivery/types';

export type DeliveryAttentionKind = 'escalation' | 'manual';

export interface DeliveryAttentionItem {
  id: string;
  kind: DeliveryAttentionKind;
  taskId?: string;
  title: string;
  detail: string;
  evidenceRef?: string;
}

export interface DeliveryWorkspaceSource {
  conversations: readonly Conversation[];
  tasks: readonly Task[];
  blockersByConversation: Readonly<Record<string, readonly Blocker[]>>;
  chatMessagesByConversation: Readonly<Record<string, readonly ChatMessage[]>>;
  deliveryRunSnapshot?: DeliveryRunSnapshot;
}

export interface DeliveryWorkspaceView {
  project: { path: string; name: string };
  delivery: {
    id: string;
    title: string;
    goal: string;
    status: Conversation['status'];
    priority: Conversation['priority'];
    autonomous: boolean;
    updatedAt: string;
  };
  stage: DeliveryStage | Conversation['status'];
  acceptance: {
    criteria: string[];
    total: number;
    passed: number;
    failed: number;
    pending: number;
  };
  work: {
    tasks: Task[];
    current: Task[];
    total: number;
    completed: number;
    inProgress: number;
    blocked: number;
  };
  attention: DeliveryAttentionItem[];
  recentActivity: ChatMessage[];
}

const ATTENTION_ORDER: Record<DeliveryAttentionKind, number> = {
  escalation: 0,
  manual: 1,
};

function projectName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).pop() || normalized || '未指定目录';
}

function projectStage(
  scopedRun: DeliveryRunSnapshot | undefined,
  tasks: readonly Task[],
  fallback: Conversation['status'],
): DeliveryWorkspaceView['stage'] {
  if (!scopedRun) return fallback;
  if (scopedRun.run.status === 'completed') return 'completed';

  const persistedStage = scopedRun.run.current_stage;
  if (!['planning', 'executing'].includes(persistedStage)) return persistedStage;
  if (tasks.some((task) => task.status === 'in_review')) return 'reviewing';
  if (tasks.some((task) => task.status === 'in_progress' || task.status === 'blocked')) {
    return 'executing';
  }
  return persistedStage;
}

export function projectDeliveryWorkspace(
  source: DeliveryWorkspaceSource,
  deliveryId: string | null,
): DeliveryWorkspaceView | null {
  if (!deliveryId) return null;
  const conversation = source.conversations.find((item) => item.id === deliveryId);
  if (!conversation) return null;

  const tasks = source.tasks
    .filter((task) => task.conversationId === deliveryId)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  const openBlockers = (source.blockersByConversation[deliveryId] ?? [])
    .filter((blocker) => blocker.status === 'open');
  const attention: DeliveryAttentionItem[] = [];
  const run = source.deliveryRunSnapshot?.run;
  const scopedRun = run?.conversation_id === deliveryId ? source.deliveryRunSnapshot : undefined;
  if (run?.conversation_id === deliveryId && run.status === 'waiting_human') {
    attention.push({
      id: `delivery-run:${run.id}:waiting-human`,
      kind: 'escalation',
      taskId: run.root_task_id ?? undefined,
      title: '需要你的决策',
      detail: run.escalation_detail ?? '系统无法在当前授权范围内继续。',
      evidenceRef: run.escalation_code ?? undefined,
    });
  }

  attention.push(...openBlockers.filter((blocker) => blocker.type === 'manual').map((blocker) => {
    const task = tasks.find((candidate) => candidate.id === blocker.taskId);
    return {
      id: `blocker:${blocker.id}`,
      kind: 'manual' as const,
      taskId: blocker.taskId,
      title: task?.title ?? blocker.taskId,
      detail: blocker.reasonSummary,
      evidenceRef: blocker.evidenceRef,
    };
  }));

  attention.sort((left, right) => {
    const kindOrder = ATTENTION_ORDER[left.kind] - ATTENTION_ORDER[right.kind];
    return kindOrder || (left.taskId ?? '').localeCompare(right.taskId ?? '');
  });

  const messages = [...(source.chatMessagesByConversation[deliveryId] ?? [])]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

  return {
    project: { path: conversation.projectPath, name: projectName(conversation.projectPath) },
    delivery: {
      id: conversation.id,
      title: conversation.title,
      goal: conversation.goal,
      status: conversation.status,
      priority: conversation.priority,
      autonomous: conversation.autonomous === true,
      updatedAt: conversation.updatedAt,
    },
    stage: projectStage(scopedRun, tasks, conversation.status),
    acceptance: (() => {
      const criteria = scopedRun?.contract?.acceptanceCriteria ?? [];
      const results = scopedRun?.bundle?.acceptanceResults ?? [];
      const passed = results.filter((item) => item.status === 'passed').length;
      const failed = results.filter((item) => item.status === 'failed').length;
      return {
        criteria,
        total: criteria.length,
        passed,
        failed,
        pending: Math.max(0, criteria.length - passed - failed),
      };
    })(),
    work: {
      tasks,
      current: tasks.filter((task) => (
        task.status === 'in_progress'
        || task.status === 'blocked'
        || task.status === 'in_review'
      )),
      total: tasks.length,
      completed: tasks.filter((task) => task.status === 'done').length,
      inProgress: tasks.filter((task) => task.status === 'in_progress').length,
      blocked: tasks.filter((task) => task.status === 'blocked').length,
    },
    attention,
    recentActivity: messages.slice(-20),
  };
}
