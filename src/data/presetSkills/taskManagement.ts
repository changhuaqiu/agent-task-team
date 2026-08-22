import type { CreateSkillInput } from '@/server/repositories/skill-repo';

export const TASK_MANAGEMENT_SKILL: CreateSkillInput = {
  name: 'task-management',
  description: 'Task creation, assignment, and status management tools for coordinating team work',
  content: `# Task Management

In a structured WorkContract invocation, propose the Task Graph through exactly one
agent_submit_outcome(propose_task_graph). Do not create, assign, or update Task rows directly;
Task Authority validates and commits the proposal after Outcome admission.

The legacy task tools below apply only outside WorkContract execution when the platform explicitly exposes them.

Tool schemas in this skill are contracts, not proof that the current runtime registered them. Invoke only an exact platform tool name that the runtime explicitly exposes. If no exact platform task tool is exposed, edit the absolute TASKS.md path supplied by the platform.

Runtime-native Task or Agent may be used for bounded parallel investigation or subwork inside the current Invocation. The platform waits for those children to converge, but they do not create or update platform Task Graph nodes, A2A possession, role ownership, or delivery receipts. SendMessage and local TodoWrite/TodoRead are likewise not platform fact sources. Emit cross-role business handoffs in your normal visible response or use an exact registered platform task tool.

After all runtime-native child work for your own role has converged, emit at most one actionable cross-role handoff and end the turn immediately. Do not execute or impersonate the receiver's work after that handoff; the platform transfers possession only at the completed-turn boundary.

## Guidelines

- Create tasks with clear, specific titles and descriptions
- Assign tasks to the most appropriate teammate based on their capabilities
- Update task status as work progresses
- Status changes into in_review or done require gate evidence. For a Git-backed project, use the Git Collaboration receipt tools; do not call task_update_status to imitate in_review or done. Non-Git tasks still require the applicable implementation or delivery evidence.
- When a Team Harness review wakeup requests evidence.reviewReceipt, preserve the task's done status and submit the exact structured receipt requested by the wakeup. A PASS requires real review evidence and no unresolved blocking or important finding; implementer self-review is not an independent gate.
- When a Team Harness verification wakeup requests evidence.verificationReceipt, preserve the task's done status and submit the exact structured receipt requested by the wakeup. For Web UI acceptance, use Browser/Playwright end to end; API-only checks are not equivalent. Every acceptance criterion needs its own real evidenceRefs, and a missing report must be reported as failed.
- For a local artifact that needs a real browser HTTP check, call verification_serve_artifact with a project-relative artifact path. It returns a one-use 127.0.0.1 URL that closes after the first successful request or timeout. Open that URL with Playwright and assert the real response. Do not start a shell server and do not assume browser_run_code_unsafe exposes Node require/import.
- A quality-gate reviewer explicitly woken for one in_review task may make a narrow decision on that task: PASS updates it to done with review evidence; changes requested return it to in_progress, while an external blocker updates it to blocked with the reason. This does not allow editing implementation content, title, owner, or unrelated tasks.
- When an implementer updates a task to review/in_review, that transition already requests the configured quality gate. End the turn without a manual @reviewer A2A handoff. Create another pass only after an explicit platform wakeup failure or for a distinct specialist review.
- Text scheduling is not execution. Do not claim a task lane is started unless a real dispatch receipt, A2A pass offer, task wakeup dispatch, or execution-start acknowledgement exists for the target agent and task.
- For parallel dispatch, verify every target separately and report n/n dispatched. If only part of the fan-out starts, retry or escalate instead of saying all lanes started.
- Each turn must close by updating task state with evidence, creating a real dispatch, creating/escalating a blocker, or naming an external wait condition with a recovery owner.
- Do not assign tasks to yourself
- Limit task creation to 10 operations per dispatch`,
  config: JSON.stringify({
    tools: [
      {
        name: 'task_list',
        description: 'List tasks in the current project, optionally filtered by status or assigned agent',
        parameters: [
          { name: 'status', type: 'string', required: false, description: 'Filter by status: proposed, ready, in_progress, blocked, in_review, done, cancelled' },
          { name: 'agent_id', type: 'string', required: false, description: 'Filter by assignee agent ID' },
        ],
        handler: 'api://tasks/list',
      },
      {
        name: 'task_create',
        description: 'Create a new task with full details and optionally assign it to an agent',
        parameters: [
          { name: 'title', type: 'string', required: true, description: 'Short task title' },
          { name: 'description', type: 'string', required: false, description: 'Detailed task description' },
          { name: 'agent_id', type: 'string', required: false, description: 'Agent ID to assign (mario, luigi, toad, peach, dk, yoshi)' },
          { name: 'role', type: 'string', required: false, description: 'Task role: planner, backend, frontend, testing, security, devops' },
          { name: 'phase', type: 'string', required: false, description: 'Phase ID (e.g. P1, P2)' },
          { name: 'dependencies', type: 'string', required: false, description: 'Comma-separated task IDs this task depends on' },
          { name: 'deliverable', type: 'string', required: false, description: 'Expected output file or artifact' },
        ],
        handler: 'api://tasks/create',
      },
      {
        name: 'task_update_status',
        description: 'Update a task status',
        parameters: [
          { name: 'task_id', type: 'string', required: true, description: 'Task ID to update' },
          { name: 'status', type: 'string', required: true, description: 'New status: proposed, ready, in_progress, blocked, in_review, done, cancelled' },
          { name: 'evidence', type: 'object', required: false, description: 'Evidence for non-Git task gates. Git-backed in_review/done transitions require collaboration_record_pr or collaboration_record_merge instead. A review wakeup additionally requires reviewReceipt; a verification wakeup additionally requires verificationReceipt with deliveryRunId, verifierAgentId, method, tool, real reportRef/specRefs files, and criterion-specific acceptanceResults/evidenceRefs.' },
        ],
        handler: 'api://tasks/update',
      },
      {
        name: 'task_assign',
        description: 'Assign or reassign a task to a different agent',
        parameters: [
          { name: 'task_id', type: 'string', required: true, description: 'Task ID' },
          { name: 'agent_id', type: 'string', required: true, description: 'New assignee agent ID' },
        ],
        handler: 'api://tasks/assign',
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
