import type { CreateSkillInput } from '@/server/repositories/skill-repo';

export const TASK_STATUS_RECEIPT_SKILL: CreateSkillInput = {
  name: 'task-status-receipt',
  description: 'Narrow task status and evidence receipt publishing for the current dispatched task',
  content: `# Task Status Receipt

Use the platform task_update_status tool only for the exact task in the current dispatch.

- Update implementation progress and submit the evidence required by the current gate.
- For status done, evidence must always include mergedToMain=true, mainInstallResult,
  mainBuildResult, mainTestResult, and mainImpactReviewResult. In a non-Git local
  delivery, mergedToMain=true means the accepted result is present in the
  authorized project working state; describe that fact in the result fields.
- A review wakeup must also include evidence.reviewReceipt with schemaVersion=1,
  the exact deliveryRunId from the wakeup, status=passed|failed,
  reviewerAgentId matching your agent ID, a non-empty summary, non-empty
  evidenceRefs, and findings (an array, empty when no findings exist).
- A verification wakeup must also include evidence.verificationReceipt with the
  exact schema requested by the wakeup, including real report/spec references
  and criterion-specific acceptanceResults.
- For a local artifact browser check, use verification_serve_artifact to obtain
  a one-use 127.0.0.1 URL, then request that URL with Playwright and assert the
  real response. Do not start a shell server or assume browser_run_code_unsafe
  exposes Node require/import.
- Do not create, assign, list, rename, or modify unrelated tasks.
- TASKS.md is a projection; use task_update_status when this tool is exposed.`,
  config: JSON.stringify({
    tools: [
      {
        name: 'task_update_status',
        description: 'Update the current dispatched task status and submit structured gate evidence',
        parameters: [
          { name: 'task_id', type: 'string', required: true, description: 'Current dispatched task ID' },
          { name: 'status', type: 'string', required: true, description: 'New status: proposed, ready, in_progress, blocked, in_review, done, cancelled' },
          {
            name: 'evidence',
            type: 'object',
            required: false,
            description: 'For done, always provide mergedToMain=true, mainInstallResult, mainBuildResult, mainTestResult, and mainImpactReviewResult. A review wakeup additionally requires reviewReceipt {schemaVersion:1, deliveryRunId, status, reviewerAgentId, summary, evidenceRefs, findings}. A verification wakeup additionally requires the exact verificationReceipt requested in its prompt.',
          },
        ],
        handler: 'api://tasks/update',
      },
      {
        name: 'verification_serve_artifact',
        description: 'Serve one current-project artifact through a one-use, short-lived 127.0.0.1 URL for real browser verification',
        parameters: [
          { name: 'artifact_path', type: 'string', required: true, description: 'Project-relative path of the artifact to serve' },
        ],
        handler: 'api://verification/serve-artifact',
      },
    ],
  }),
  isPreset: true,
};
