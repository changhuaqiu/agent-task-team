import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AutonomousDeliveryRepository } from '../autonomous-delivery/repository';
import type { GoalContract } from '../autonomous-delivery/types';
import { createTestDb, resetDb, setTestDb } from '../db';
import { conversationRepo } from '../repositories/conversation-repo';
import { GitHubIssueAgentIngress } from './ingress';
import { githubIssueHookConfig, githubIssuePayload } from './test-fixtures';

describe('GitHubIssueAgentIngress', () => {
  let projectPath: string;
  let deliveryRepository: AutonomousDeliveryRepository;
  let capturedContract: GoalContract | undefined;

  beforeEach(() => {
    setTestDb(createTestDb());
    projectPath = mkdtempSync(join(tmpdir(), 'github-issue-ingress-'));
    deliveryRepository = new AutonomousDeliveryRepository();
    capturedContract = undefined;
  });

  afterEach(() => {
    resetDb();
    rmSync(projectPath, { recursive: true, force: true });
  });

  function ingress() {
    return new GitHubIssueAgentIngress({
      supervisor: {
        start(contract) {
          capturedContract = contract;
          return deliveryRepository.createRun(contract);
        },
      },
      now: () => new Date('2026-07-20T00:00:00.000Z'),
    });
  }

  it('atomically creates a project, DeliveryRun and stable source mapping', () => {
    const result = ingress().handle({
      eventName: 'issues',
      deliveryId: 'delivery-42',
      payload: githubIssuePayload(),
      payloadDigest: 'digest-42',
      config: githubIssueHookConfig(projectPath),
    });

    expect(result.disposition).toBe('accepted');
    if (result.disposition !== 'accepted') throw new Error('expected accepted result');
    expect(conversationRepo.getById(result.mapping.conversation_id)).toMatchObject({
      title: '#42 Add automatic issue intake',
      project_path: projectPath,
      git_repo_root: projectPath,
      use_worktree: 1,
    });
    expect(deliveryRepository.getSnapshot(result.mapping.delivery_run_id)?.contract.source)
      .toMatchObject({ issueNumber: 42, repository: 'acme/widgets' });
    expect(capturedContract?.acceptanceCriteria).toContain('Verify webhook signatures');
  });

  it('deduplicates both GitHub delivery retries and a second delivery for the same issue', () => {
    const processor = ingress();
    const first = processor.handle({
      eventName: 'issues',
      deliveryId: 'delivery-42',
      payload: githubIssuePayload(),
      payloadDigest: 'digest-42',
      config: githubIssueHookConfig(projectPath),
    });
    const sameDelivery = processor.handle({
      eventName: 'issues',
      deliveryId: 'delivery-42',
      payload: githubIssuePayload(),
      payloadDigest: 'digest-42',
      config: githubIssueHookConfig(projectPath),
    });
    const sameIssue = processor.handle({
      eventName: 'issues',
      deliveryId: 'delivery-43',
      payload: githubIssuePayload(),
      payloadDigest: 'digest-43',
      config: githubIssueHookConfig(projectPath),
    });

    expect(first.disposition).toBe('accepted');
    expect(sameDelivery.disposition).toBe('duplicate');
    expect(sameIssue.disposition).toBe('duplicate');
    expect(conversationRepo.list()).toHaveLength(1);
    expect(deliveryRepository.listReconcileCandidates()).toHaveLength(1);
  });

  it('applies trigger and skip labels without creating business objects', () => {
    const processor = ingress();
    const missingTrigger = processor.handle({
      eventName: 'issues',
      deliveryId: 'delivery-missing-label',
      payload: githubIssuePayload(),
      payloadDigest: 'digest',
      config: githubIssueHookConfig(projectPath, { triggerLabel: 'agent:approved' }),
    });
    const skipped = processor.handle({
      eventName: 'issues',
      deliveryId: 'delivery-skip',
      payload: githubIssuePayload({
        issue: {
          ...githubIssuePayload().issue,
          labels: [{ name: 'agent:skip' }],
        },
      }),
      payloadDigest: 'digest',
      config: githubIssueHookConfig(projectPath),
    });

    expect(missingTrigger).toEqual({
      disposition: 'ignored',
      reason: 'trigger_label_missing',
    });
    expect(skipped).toEqual({
      disposition: 'ignored',
      reason: 'skip_label_present',
    });
    expect(conversationRepo.list()).toHaveLength(0);
  });

  it('rejects untrusted public authors unless the administrator expands the policy', () => {
    const payload = githubIssuePayload({
      issue: {
        ...githubIssuePayload().issue,
        author_association: 'NONE',
      },
    });
    const processor = ingress();
    const rejected = processor.handle({
      eventName: 'issues',
      deliveryId: 'delivery-untrusted',
      payload,
      payloadDigest: 'digest-untrusted',
      config: githubIssueHookConfig(projectPath),
    });
    const accepted = processor.handle({
      eventName: 'issues',
      deliveryId: 'delivery-explicitly-trusted',
      payload,
      payloadDigest: 'digest-trusted',
      config: githubIssueHookConfig(projectPath, {
        trustedAssociations: ['OWNER', 'MEMBER', 'COLLABORATOR', 'NONE'],
      }),
    });

    expect(rejected).toEqual({
      disposition: 'ignored',
      reason: 'author_not_trusted',
    });
    expect(accepted.disposition).toBe('accepted');
  });

  it('rolls back the project when DeliveryRun creation fails', () => {
    const processor = new GitHubIssueAgentIngress({
      supervisor: {
        start() {
          throw new Error('supervisor rejected contract');
        },
      },
    });
    expect(() => processor.handle({
      eventName: 'issues',
      deliveryId: 'delivery-fail',
      payload: githubIssuePayload(),
      payloadDigest: 'digest-fail',
      config: githubIssueHookConfig(projectPath),
    })).toThrow('supervisor rejected contract');
    expect(conversationRepo.list()).toHaveLength(0);
  });
});
