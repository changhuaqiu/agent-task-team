<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project-Specific Agent Reflection

## Account Configuration Guardrails

- When the user asks to "reference" or "copy" an existing product UX, inspect the real implementation first. Do not invent a parallel IA from memory or README summaries.
- For account/configuration pages, default to the user mental model first:
  - show configured accounts
  - show one primary create action
  - use object cards for existing accounts
  - do not pre-render empty sections for every possible client/runtime
- Do not expose implementation-layer concepts to users unless explicitly requested. Avoid surfacing terms like `runtime`, `channel`, `routing`, `bridge`, `providerHints`, `session`, or other internal plumbing in the primary UX.
- Do not duplicate the same choice in both the page body and the create modal. If the page already scopes the object, the modal should not ask again; if the modal asks, the page body should stay as a list.
- For auth/account creation flows, fields must depend on the selected auth mode:
  - OAuth/web authorization: ask only for account identity and optional models; do not ask for API keys
  - API key mode: ask for `Base URL`, `API Key`, and models
- Prefer user-facing labels over implementation labels. For example, describe what the user is connecting, not internal transport or storage terminology.
- If the user says the page feels "scattered", stop adding more cards/sections. First reduce concepts, remove internal jargon, and collapse to one clear primary task.

## UX Correction Rule

- If the user calls out that the design is "wrong", "scattered", "duplicated", or "not like the reference", do not keep polishing the same structure. Re-evaluate the information architecture from first principles and compare it against the reference implementation before making further edits.

## Multi-Agent Collaboration & Documentation Rules

### 0. Project Standards Must Be Followed
- **Standards Entry Point**: Before any development, business analysis, UX decision, architecture design, or review work, read `docs/standards/README.md` and the applicable standards document.
- **Technical Standard**: Code, architecture, data model, interface, runtime, integration, testing, and technical review work MUST follow `docs/standards/technical.md`.
- **Business Standard**: Requirement analysis, product modeling, UX decisions, role/collaboration mechanics, and business copy MUST follow `docs/standards/business.md`.
- **Iteration Knowledge Capture**: Before concluding any iteration, follow `docs/standards/iteration-knowledge.md` to decide whether reusable knowledge must be captured in `docs/wiki/`, `docs/knowledge/`, `decisions/`, or active specs.
- **Knowledge Governance**: Any reusable knowledge added to `docs/knowledge/` MUST follow `docs/standards/knowledge-governance.md` and be indexed in `docs/knowledge/catalog.md`.
- **Mixed Work**: Tasks that include both implementation and product/business judgment MUST follow both the technical and business standards.

### 0.1. GitNexus Graph-First Protocol
- **Graph Context First**: For any non-trivial code, architecture, review, or testing task, use GitNexus before editing or judging code. At minimum, query the relevant feature, symbol, flow, or module.
- **Impact Before Change**: Before modifying code, inspect the relevant `context` or `impact` so edits stay inside the discovered dependency boundary.
- **Gate Evidence**: Review and QA agents must use GitNexus impact or change detection evidence before approving, rejecting, or signing off.
- **Executable Status Gates**: A task cannot enter `in_review` without `installResult`, `buildResult`, and `gitnexusEvidence`; a task cannot enter `done` without `mergedToMain`, `mainInstallResult`, `mainBuildResult`, `mainTestResult`, and `gitnexusDetectChangesResult`.
- **No Auto Review**: A successful CLI exit is only execution evidence. It must not automatically move a task into review without the required gate evidence.
- **Fallback Transparency**: If GitNexus is unavailable or stale, say so explicitly, refresh with `gitnexus analyze` when safe, and continue only with a stated fallback.
- **Handoff Evidence**: Agent handoffs should mention the GitNexus query, symbol, flow, or affected process used to make the decision.

### 1. Documentation Management & Evolution Plan
- **Implementation Must Update Design Docs First**: Every implementation change MUST be reflected in the relevant design or architecture document before the task is considered complete. Code and design documents are required to stay in sync; do not ship code changes without updating the corresponding docs in `docs/`, `design/`, `architecture/`, or `decisions/`.
- **Single Source of Truth**: The `docs/` directory is the central hub for all project documentation. Always refer to `docs/README.md` for the directory structure and document evolution rules.
- **Root-Level Documentation Only**: Project documentation standards must live in the repository-visible document system under the root directory, such as `docs/`, `design/`, `architecture/`, `decisions/`, `README.md`, `ROADMAP.md`, and `AGENTS.md`. Do not treat `.trae/` as the formal source of truth for project documentation.
- **Unified Spec Directory**: All active implementation specs MUST live under the root-level `specs/` directory. Every agent must read and follow `specs/README.md`, and must place new active specs in `specs/<spec-name>/`.
- **Categorization**: 
  - Product/Business/UX docs MUST go to `docs/product/`.
  - Technical/System design docs MUST go to `docs/technical/`.
  - Knowledge and lessons learned MUST go to `docs/wiki/` or `docs/knowledge/`.
  - Deprecated or historical docs MUST go to `docs/archive/`.
- **Spec vs. Documentation**:
  - Active implementation specs MUST be placed under `specs/`.
  - Plans and supporting execution notes may live under `docs/plans/`, but they do not replace the canonical spec in `specs/`.
  - Use `docs/` for long-term product, design, and technical documentation.
  - Once a spec is fully implemented, extract its core architectural/product decisions into `docs/` and archive or delete temporary execution materials.
- **No Root Clutter**: Do NOT create new arbitrary markdown files in the project root directory. Keep the root clean.

### 2. Multi-Agent Parallel Execution Constraints
When multiple agents are running in parallel on this project, adhere strictly to the following constraints to prevent conflicts and ensure alignment:
- **Pre-Execution Check**: Before starting any implementation, ALWAYS read the relevant root-level documentation in `docs/`, `design/`, `architecture/`, `decisions/`, `README.md`, `ROADMAP.md`, and `AGENTS.md` to ensure alignment with the latest architectural decisions and UX guidelines.
- **Spec Check**: Before starting any implementation, ALWAYS read the corresponding active spec under `specs/` and treat it as the canonical implementation contract.
- **Completion Gate**: Before concluding any implementation task, verify that the impacted design documentation has been updated to reflect the final behavior, data model, interaction flow, and constraints introduced by the code change.
- **State & File Modification Awareness**: 
  - Do not blindly overwrite shared files. If modifying a shared configuration or core state file (e.g., Zustand stores), check for recent changes or existing issues first.
  - If you encounter unresolved bugs caused by other parallel tasks, document them and avoid conflicting changes until the baseline is stable.
- **Documenting Decisions**: If an agent makes a significant architectural, UX, or business decision during execution, it MUST update the relevant document in `docs/` (or create a new one following the taxonomy in `docs/README.md`) before concluding the task.
- **Avoid Overlapping Features**: Ensure your current task scope is clearly defined in the corresponding `specs/` document and related design docs. Do not modify components outside your designated scope unless absolutely necessary for integration.
- **Unified Terminology**: All agents must use consistent terminology defined in the product/business docs (e.g., clearly distinguishing between OAuth and API Key, and avoiding internal jargon like `bridge` in UX).
