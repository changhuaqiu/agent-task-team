import { getDb } from '../db';
import { generateSortableId } from '../repositories/sortable-id';
import type { GitHubIssueIngressRow } from './types';

export class GitHubIssueIngressRepository {
  getByDeliveryId(deliveryId: string): GitHubIssueIngressRow | undefined {
    return getDb().prepare(
      'SELECT * FROM github_issue_ingress WHERE delivery_id=?',
    ).get(deliveryId) as GitHubIssueIngressRow | undefined;
  }

  getByIssue(
    repositoryFullName: string,
    issueNumber: number,
  ): GitHubIssueIngressRow | undefined {
    return getDb().prepare(
      `SELECT * FROM github_issue_ingress
       WHERE lower(repository_full_name)=lower(?) AND issue_number=?`,
    ).get(repositoryFullName, issueNumber) as GitHubIssueIngressRow | undefined;
  }

  create(input: {
    deliveryId: string;
    repositoryFullName: string;
    issueNumber: number;
    issueNodeId: string;
    issueUrl: string;
    action: string;
    payloadDigest: string;
    conversationId: string;
    deliveryRunId: string;
    now: string;
  }): GitHubIssueIngressRow {
    const id = generateSortableId('github-issue-ingress');
    getDb().prepare(
      `INSERT INTO github_issue_ingress (
        id, delivery_id, repository_full_name, issue_number, issue_node_id,
        issue_url, action, payload_digest, conversation_id, delivery_run_id,
        status, received_at, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'started', ?, ?)`,
    ).run(
      id,
      input.deliveryId,
      input.repositoryFullName,
      input.issueNumber,
      input.issueNodeId,
      input.issueUrl,
      input.action,
      input.payloadDigest,
      input.conversationId,
      input.deliveryRunId,
      input.now,
      input.now,
    );
    return getDb().prepare(
      'SELECT * FROM github_issue_ingress WHERE id=?',
    ).get(id) as GitHubIssueIngressRow;
  }
}

export const githubIssueIngressRepo = new GitHubIssueIngressRepository();
