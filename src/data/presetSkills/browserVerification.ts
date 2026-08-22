import type { CreateSkillInput } from '@/server/repositories/skill-repo';

export const BROWSER_VERIFICATION_SKILL: CreateSkillInput = {
  name: 'browser-verification',
  description: 'Real browser verification for local web UI acceptance evidence',
  content: `# Browser Verification

Use this Skill only when the current WorkContract requires browser or Web UI evidence.

## Required flow

1. Start from the exact acceptance criteria. Turn each criterion into an observable browser assertion.
2. For a project artifact, call verification_serve_artifact first and use its one-use loopback URL.
3. Use the runtime browser-control tool when it is available. A tool such as browser_run_code_unsafe already supplies its browser/page binding; do not import or require Playwright inside it.
4. If the runtime exposes a preloaded browser binding through its JavaScript tool, use that binding directly. Do not probe the host for playwright or playwright-core packages.
5. If the project already contains Playwright tests, run them with the project test/e2e script or the permitted local Playwright test command.
6. Capture real page assertions, console/page errors, and an artifact or report path. Source inspection and HTTP 200 alone are not browser evidence.
7. Submit the required structured receipt exactly once. If a browser tool is genuinely absent, report capability_missing with the failed tool evidence; do not start unrelated servers or repeatedly retry equivalent commands.

Keep browser work local to the current project and loopback URLs. Do not navigate to external sites unless the WorkContract explicitly requires it.`,
  config: JSON.stringify({
    tools: [
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
