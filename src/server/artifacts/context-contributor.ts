import type {
  ContextContributor,
  ContextFragment,
  ContextQuery,
} from '@/lib/agent-context/ContextManager';
import { conversationRepo } from '../repositories/conversation-repo';
import { projectArtifactLedger } from './project-artifact-ledger';

export class ArtifactLedgerContextContributor implements ContextContributor {
  readonly id = 'artifact-ledger';

  async contribute(query: ContextQuery): Promise<ContextFragment[]> {
    const conversation = conversationRepo.getById(query.conversationId);
    const projectId = conversation?.project_id;
    if (!projectId) return [];
    const artifacts = projectArtifactLedger.list(projectId, 8);
    if (artifacts.length === 0) return [];
    const content = [
      '## 最近产物与真相源',
      ...artifacts.map((artifact) => {
        const status = artifact.status === 'registered' ? '已登记' : '处理中';
        const work = artifact.workTitle ? ` · 工作：${artifact.workTitle}` : '';
        return `- [${status}/${artifact.kind}] ${artifact.ref} · ${artifact.updatedBy}${work}`;
      }),
      '',
      '- 优先继续修改已有 ref，不要为同一结果另造重复路径。',
      '- “处理中”只是成功写操作观察；提交结果或请求评审时，必须把精确 ref 放入 evidence_refs，登记后才是正式证据。',
    ].join('\n');
    return [{
      id: `artifact-ledger:${projectId}`,
      kind: 'project.artifact-ledger',
      cluster: 'situation',
      scope: { kind: 'project', projectId },
      subject: { kind: 'project', id: projectId },
      producer: this.id,
      version: artifacts.map((artifact) => `${artifact.id}:${artifact.updatedAt}:${artifact.status}`).join('|'),
      content,
      visibility: { kind: 'team' },
      freshness: { observedAt: artifacts[0].updatedAt },
      evidenceRefs: artifacts.filter((artifact) => artifact.status === 'registered').map((artifact) => artifact.ref),
    }];
  }
}

export const artifactLedgerContextContributor = new ArtifactLedgerContextContributor();
