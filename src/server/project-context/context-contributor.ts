import type {
  ContextContributor,
  ContextFragment,
  ContextQuery,
} from '@/lib/agent-context/ContextManager';
import path from 'node:path';
import { conversationRepo, type ConversationRow } from '../repositories/conversation-repo';
import { projectContextService } from './project-context-service';
import type { ProjectConversationInput } from './types';

function toConversationInput(row: ConversationRow): ProjectConversationInput {
  return {
    id: row.id,
    title: row.title,
    goal: row.goal,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pathIdentity(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export class ProjectContextContributor implements ContextContributor {
  readonly id = 'project-context';
  readonly required = true;

  async contribute(query: ContextQuery): Promise<ContextFragment[]> {
    const conversation = conversationRepo.getById(query.conversationId);
    const scope = { kind: 'project' as const, projectId: query.conversationId };
    if (!conversation?.project_path?.trim()) {
      return [{
        id: `project-context:${query.conversationId}:unbound`,
        kind: 'project.context.unbound',
        cluster: 'situation',
        scope,
        subject: { kind: 'project', id: query.conversationId },
        producer: this.id,
        version: 'unbound-v1',
        content: [
          '## 项目目录约束',
          '- 当前工作项目未绑定代码目录。',
          '- 不得把平台进程 cwd、用户主目录或相邻目录当作本项目进行递归扫描。',
          '- 如任务需要代码，请先请求绑定具体代码项目目录。',
        ].join('\n'),
        visibility: { kind: 'team' },
        freshness: { observedAt: conversation?.updated_at ?? query.now },
        evidenceRefs: [],
        required: true,
      }];
    }

    const identity = pathIdentity(conversation.project_path);
    const resolveWorkstreams = () => conversationRepo.list()
      .filter(row => (
        Boolean(row.project_path)
        && pathIdentity(row.project_path!) === identity
      ))
      .map(toConversationInput);
    const result = await projectContextService.prepare({
      mode: 'load',
      projectPath: conversation.project_path,
      conversation: toConversationInput(conversation),
      resolveWorkstreams,
      requestText: query.requestText,
    });
    if (!result.manifest || !result.capsule) return [];

    return [{
      id: `project-context:${query.conversationId}`,
      kind: 'project.context.capsule',
      cluster: 'situation',
      scope,
      subject: { kind: 'project', id: query.conversationId },
      producer: this.id,
      version: [
        `r${result.manifest.revision}`,
        result.manifest.sourceFingerprint.slice(0, 12),
        result.capsule.currentWorkstream.updatedAt,
      ].join(':'),
      content: result.capsule.content,
      visibility: { kind: 'team' },
      freshness: { observedAt: result.manifest.generatedAt },
      evidenceRefs: result.capsule.evidenceRefs,
      required: true,
    }];
  }
}

export const projectContextContributor = new ProjectContextContributor();
