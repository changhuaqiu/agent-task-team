#!/usr/bin/env tsx
// scripts/smoke-acp-runtime.ts
//
// REUSABLE real-runtime smoke for the ACP catalog (spec §8 acceptance).
// Drives one catalog entry end-to-end via `createBackend` and asserts a basic
// prompt turn works (text + done + completed). Reusable for Task 7
// (claude/codex) — pass the runtime id as argv[2].
//
// Usage:
//   npx tsx scripts/smoke-acp-runtime.ts [runtimeId] [model?]
//   # default runtime: opencode
//   # model is optional — for opencode it is written to an isolated temporary
//   # OPENCODE_CONFIG (overrides the host default model).
//
// This script is NOT part of the default `pnpm test` vitest suite — it spawns
// a real agent subprocess and depends on host auth/config. Run on demand.
// Exits 0 on pass, 1 on fail.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog, createBackend } from '../src/server/agent/acp/catalog';
import { getActiveAcpRunCount } from '../src/server/agent/acp/acpBackend';
import { prepareAcpRuntime } from '../src/server/agent/acp/runtimeSetup';

const PROMPT = 'Reply with a single short greeting sentence.';
// Adapter startup (npx → adapter → runtime) can be slow even when the package
// is installed locally; use a generous timeout (spec §8 acceptance).
const DEFAULT_TURN_TIMEOUT_MS = 120_000;

/**
 * Default smoke model per runtime, applied via an isolated runtime config —
 * NOT via execute() opts. AcpBackend.execute() ignores
 * `opts.model` (Task 5 deferral), and the ACP protocol's PromptRequest has no
 * per-prompt model field anyway, so the model MUST be set through the agent's
 * own config layer.
 *
 * opencode: the host's configured default (`zhipuai-coding-plan/glm-4.7`, set
 * in ~/.config/opencode/opencode.json) emits only `agent_thought_chunk`
 * updates with ~1 output token and produces NO `agent_message_chunk` (text) —
 * so the text+done+completed assertion cannot pass against it. DeepSeek is the
 * verified credential on this host (`~/.local/share/opencode/auth.json`) and
 * produces a proper text response, so the smoke writes it into a temporary
 * `opencode.json` injected through `OPENCODE_CONFIG`.
 * Override with argv[3] if needed.
 *
 * Other runtimes (claude/codex) use their own provider default — no entry here.
 */
const DEFAULT_SMOKE_MODEL: Record<string, string> = {
  opencode: 'deepseek/deepseek-chat',
};

async function main(): Promise<number> {
  const runtime = process.argv[2] ?? 'opencode';

  const entry = loadCatalog().find((e) => e.id === runtime);
  if (!entry) {
    const known = loadCatalog().map((e) => e.id).join(', ');
    console.error(`[smoke] unknown runtime "${runtime}". Known: ${known}`);
    return 1;
  }

  // Use a MINIMAL temp cwd so the agent doesn't index a large project (the
  // worktree root is a Next.js project — opencode would index it, slowing the
  // smoke). Set ACP_SMOKE_KEEP_TMP=1 only when post-mortem inspection is
  // required; otherwise finally removes all temporary state.
  const cwd = mkdtempSync(join(tmpdir(), `acp-smoke-${runtime}-`));

  // --- Per-runtime setup (shared with the daemon via runtimeSetup) ---------
  // The setup logic (opencode model, codex CODEX_HOME isolation, claude
  // passthrough) lives in src/server/agent/acp/runtimeSetup.ts so the daemon
  // (Task 8) and this smoke share one implementation.
  const opencodeModel = process.argv[3] ?? DEFAULT_SMOKE_MODEL[runtime];
  const prepared = prepareAcpRuntime(entry, {
    cwd,
    env: {},
    opencodeModel,
  });

  try {

  const env = Object.keys(prepared.env).length > 0 ? prepared.env : undefined;
  let modelLabel: string;
  if (runtime === 'opencode') {
    modelLabel = `${opencodeModel} (via isolated OPENCODE_CONFIG)`;
  } else if (runtime === 'codex') {
    modelLabel = `(via isolated CODEX_HOME: ${prepared.env.CODEX_HOME ?? '(none)'})`;
  } else {
    modelLabel = '(runtime default)';
  }

  const launcherStr = `${entry.launcher.command} ${entry.launcher.args.join(' ')}`;

  console.log('=== ACP Runtime Smoke ===');
  console.log(`runtime:     ${runtime}`);
  console.log(`delivery:    ${entry.delivery}`);
  console.log(`cwd:         ${cwd}`);
  if (env) console.log(`env:         ${JSON.stringify(env)}`);
  console.log(`launcher:    ${launcherStr}`);
  console.log(`prompt:      ${PROMPT}`);
  console.log(`model:       ${modelLabel}`);
  const turnTimeoutMs = runtime === 'codex' ? 180_000 : DEFAULT_TURN_TIMEOUT_MS;
  console.log(`timeout:     ${turnTimeoutMs}ms`);
  console.log('');

  // cwd + env are bound to the backend via createBackend. AcpBackend.execute()
  // reads cwd as `opts.cwd ?? this.o.cwd ?? process.cwd()`, and merges env as
  // `{ ...process.env, ...this.o.env, ...opts.env }` — so passing them again
  // to execute() would be redundant.
  const backend = createBackend(entry, {
    cwd: prepared.cwd,
    env: prepared.env,
    permissionPolicy: 'allow_once',
  });

  const run = backend.execute(PROMPT, {
    timeout: turnTimeoutMs,
  });

  const eventTypes: string[] = [];
  let text = '';
  let firstError: string | undefined;

  try {
    for await (const ev of run.events) {
      eventTypes.push(ev.type);
      if (ev.type === 'text') text += ev.content;
      if (ev.type === 'error' && !firstError) firstError = ev.content;
    }
  } catch (err) {
    console.error(`[smoke] event stream threw: ${err}`);
    // fall through to result + report
  }

  let result;
  try {
    result = await run.result;
  } catch (err) {
    console.error(`[smoke] result promise rejected: ${err}`);
    console.log('');
    console.log('=== FAIL ===');
    console.log(`reason:      result promise rejected`);
    console.log(`events seen: ${eventTypes.join(', ') || '(none)'}`);
    return 1;
  }

  // --- Assertions (spec §8): at least one text event, last event is done,
  // result.status === 'completed'. Don't assume an exact event sequence —
  // real agents may emit thinking/plan/tool events; just require text + done
  // + completed. ---
  const hasText = eventTypes.includes('text');
  const lastType = eventTypes.length
    ? eventTypes[eventTypes.length - 1]
    : undefined;
  const lastIsDone = lastType === 'done';
  const completed = result.status === 'completed';

  const textPreview = text.trim().slice(0, 200) || '(no text content)';

  // --- Health report ---
  console.log('--- health report ---');
  console.log(`events seen: ${eventTypes.join(', ') || '(none)'}`);
  console.log(`last event:  ${lastType ?? '(none)'}`);
  console.log(`has text:    ${hasText}`);
  console.log(`text:        ${textPreview}`);
  console.log(`result:      ${result.status}`);
  console.log(`sessionId:   ${result.sessionId ?? '(none)'}`);
  console.log(`durationMs:  ${result.durationMs}`);
  if (result.error) console.log(`error:       ${result.error}`);
  if (firstError) console.log(`first error event: ${firstError}`);
  if (result.usage) {
    const u = result.usage.default;
    console.log(
      `usage:       input=${u.inputTokens} output=${u.outputTokens}`,
    );
  }
  console.log('');

  const failures: string[] = [];
  if (!hasText) failures.push('no text event received');
  if (!lastIsDone)
    failures.push(`last event was "${lastType}", expected "done"`);
  if (!completed)
    failures.push(`result.status was "${result.status}", expected "completed"`);

  if (failures.length === 0) {
    console.log('=== PASS ===');
    return 0;
  }

  console.log('=== FAIL ===');
  console.log(`reason:      ${failures.join('; ')}`);
  return 1;
  } finally {
    const cleanupDeadline = Date.now() + 3_000;
    while (getActiveAcpRunCount() > 0 && Date.now() < cleanupDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // On Windows the adapter process may close just before descendant handles
    // release the temporary working directory. Give the OS a short bounded
    // settling window before cleanup; rmSync retries remain the final guard.
    if (process.platform === 'win32') {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    prepared.cleanup?.();
    if (process.env.ACP_SMOKE_KEEP_TMP !== '1') {
      try {
        rmSync(cwd, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      } catch (error) {
        console.warn('[smoke] temporary cwd cleanup failed:', error);
      }
    }
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error('[smoke] fatal:', error);
    process.exitCode = 1;
  });
