export type LegacyProjectTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'rejected'
  | 'blocked';

/**
 * Project UI compatibility boundary for the managed Task lifecycle.
 * Storage remains managed; legacy readers receive their closed vocabulary.
 */
export function toLegacyProjectTaskStatus(value: unknown): LegacyProjectTaskStatus {
  switch (value) {
    case 'pending':
    case 'todo':
    case 'proposed':
    case 'ready':
      return 'pending';
    case 'doing':
    case 'in_progress':
      return 'in_progress';
    case 'review':
    case 'in_review':
      return 'in_review';
    case 'completed':
    case 'done':
      return 'done';
    case 'rejected':
      return 'rejected';
    case 'cancelled':
    case 'blocked':
    default:
      return 'blocked';
  }
}
