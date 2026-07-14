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
//   # model is optional — for opencode it is written to a project-local
//   # opencode.json in the temp cwd (overrides the host default model).
//
// This script is NOT part of the default `pnpm test` vitest suite — it spawns
// a real agent subprocess and depends on host auth/config. Run on demand.
// Exits 0 on pass, 1 on fail.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog, createBackend } from '../src/server/agent/acp/catalog';

const PROMPT = 'Reply with a single short greeting sentence.';
const TURN_TIMEOUT_MS = 90_000;

/**
 * Default smoke model per runtime, applied via a project-local config file in
 * the temp cwd — NOT via execute() opts. AcpBackend.execute() ignores
 * `opts.model` (Task 5 deferral), and the ACP protocol's PromptRequest has no
 * per-prompt model field anyway, so the model MUST be set through the agent's
 * own config layer.
 *
 * opencode: the host's configured default (`zhipuai-coding-plan/glm-4.7`, set
 * in ~/.config/opencode/opencode.json) emits only `agent_thought_chunk`
 * updates with ~1 output token and produces NO `agent_message_chunk` (text) —
 * so the text+done+completed assertion cannot pass against it. DeepSeek is the
 * verified credential on this host (`~/.local/share/opencode/auth.json`) and
 * produces a proper text response, so the smoke writes it into a cwd
 * `opencode.json` whose top-level `model` field overrides the host default.
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
  // smoke). The temp dir is intentionally left in place for post-mortem
  // inspection on failure.
  const cwd = mkdtempSync(join(tmpdir(), `acp-smoke-${runtime}-`));

  // Apply the model override via a project-local `opencode.json` written into
  // the temp cwd (opencode-only). opencode merges project-local config with
  // the global ~/.config/opencode/opencode.json; the cwd top-level `model`
  // field overrides the host default. This is the ONLY way to force a model
  // for an ACP-launched opencode — the ACP PromptRequest has no model field,
  // and AcpBackend.execute() ignores opts.model (Task 5 deferral). Providers
  // and credentials live in ~/.local/share/opencode/auth.json, NOT here, so
  // this file stays minimal (just the model override).
  let modelLabel: string;
  if (runtime === 'opencode') {
    const model = process.argv[3] ?? DEFAULT_SMOKE_MODEL[runtime];
    writeFileSync(
      join(cwd, 'opencode.json'),
      `${JSON.stringify({ model }, null, 2)}\n`,
    );
    modelLabel = `${model} (via cwd opencode.json)`;
  } else {
    modelLabel = '(runtime default)';
  }

  const launcherStr = `${entry.launcher.command} ${entry.launcher.args.join(' ')}`;

  console.log('=== ACP Runtime Smoke ===');
  console.log(`runtime:     ${runtime}`);
  console.log(`delivery:    ${entry.delivery}`);
  console.log(`cwd:         ${cwd}`);
  console.log(`launcher:    ${launcherStr}`);
  console.log(`prompt:      ${PROMPT}`);
  console.log(`model:       ${modelLabel}`);
  console.log(`timeout:     ${TURN_TIMEOUT_MS}ms`);
  console.log('');

  // cwd is bound to the backend via createBackend (AcpBackend.o.cwd); execute
  // reads it as `opts.cwd ?? this.o.cwd ?? process.cwd()`, so passing it again
  // here would be redundant.
  const backend = createBackend(entry, cwd);

  const run = backend.execute(PROMPT, {
    timeout: TURN_TIMEOUT_MS,
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
}

main().then((code) => process.exit(code));
