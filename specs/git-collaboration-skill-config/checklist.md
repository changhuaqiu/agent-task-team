# Git Collaboration Skill Config Checklist

- [x] Spec lives under `specs/git-collaboration-skill-config/`.
- [x] The skill is reusable across multiple roles rather than embedded in a single role card.
- [x] The skill does not add provider credentials or bypass permissions.
- [x] User-facing language distinguishes GitHub PRs and GitLab MRs without exposing runtime internals.
- [x] Preset role assignments cover the current built-in teams.
- [x] Git token and provider auth are treated as external credentials, not stored in the skill text.
- [x] Review findings use linked issues as the durable fix queue before merge.
- [x] Existing preset skill rows are refreshed by seeding when the built-in workflow changes.
- [x] OpenCode receives a project-local Skill mount instead of relying on user-global Skill installation.
- [x] OpenCode generated config allows Skill loading for non-interactive task dispatches.
