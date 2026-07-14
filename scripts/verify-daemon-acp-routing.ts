#!/usr/bin/env tsx
// scripts/verify-daemon-acp-routing.ts
//
// Focused end-to-end verification that the daemon's ACP routing chain works
// for opencode WITHOUT the full socket.io/DB stack. Exercises the exact
// sequence the daemon (src/server/daemon.ts, Task 10 ACP-only path) follows:
//
//   loadCatalog().find(engine)
//     → prepareAcpRuntime(entry, {cwd, env})
//       → createAcpBackend(entry, {cwd, env})
//         → backend.execute(prompt, opts)   [via checkCapabilities opts shape]
//           → withDoneGuarantee(events, result)
//             → drain events + await result
//
// Asserts: catalog entry resolves, events flow (text + done), result completes,
// and acpCleanup runs. Exits 0 on pass, 1 on fail.
//
// NOT part of the default vitest suite — spawns a real opencode subprocess.
// Run on demand:
//   npx tsx scripts/verify-daemon-acp-routing.ts

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog, createBackend } from '../src/server/agent/acp/catalog';
import { prepareAcpRuntime } from '../src/server/agent/acp/runtimeSetup';
import { checkCapabilities } from '../src/server/agent/capabilityRouter';
import { withDoneGuarantee } from '../src/server/agent/with-done-guarantee';

const PROMPT = 'Reply with a single short greeting sentence.';
const TURN_TIMEOUT_MS = 120_000;

async function main(): Promise<number> {
  const engine = 'opencode';
  const catalog = loadCatalog();

  // --- Step 1: resolve catalog entry (daemon Task 10: ACP-only, legacy selector removed) ---
  const entry = catalog.find((e) => e.id === engine);
  console.log('=== Daemon ACP Routing Verification ===');
  console.log(`engine:      ${engine}`);

  if (!entry) {
    console.error(`FAIL: no ACP catalog entry for ${engine}`);
    return 1;
  }

  // --- Step 2: resolve cwd (mirrors daemon workdirManager.resolveWorkdir) ---
  const wd = mkdtempSync(join(tmpdir(), 'daemon-acp-verify-'));

  // --- Step 3: prepareAcpRuntime (daemon's per-runtime setup) ---
  // The daemon passes {cwd, env: {...credentialEnv, ...runtimeConfigEnv}}.
  // Here env is empty (no account) — prepareAcpRuntime writes the fallback
  // opencode.json with deepseek.
  const credentialEnv: Record<string, string> = {};
  const runtimeConfigEnv: Record<string, string> = {};
  const executeEnv = { ...credentialEnv, ...runtimeConfigEnv };

  const prepared = prepareAcpRuntime(entry, {
    cwd: wd,
    env: executeEnv,
  });
  console.log(`cwd:         ${prepared.cwd}`);
  console.log(`cleanup:     ${typeof prepared.cleanup}`);

  // --- Step 4: createAcpBackend (daemon's ACP construction) ---
  const backend = createBackend(entry, {
    cwd: prepared.cwd,
    env: prepared.env,
  });

  // --- Step 5: checkCapabilities + execute (daemon's execute path) ---
  // Mirrors daemon.ts: checkCapabilities(backend, {prompt, opts}) then
  // backend.execute(capsResult.prompt, capsResult.opts).
  const timeoutMs = TURN_TIMEOUT_MS;
  const capsResult = checkCapabilities(backend, {
    prompt: PROMPT,
    opts: {
      cwd: prepared.cwd,
      timeout: timeoutMs,
      env: prepared.env,
    },
  });
  if (capsResult.warnings.length > 0) {
    console.log(`warnings:    ${capsResult.warnings.map((w) => `${w.field}→${w.action}`).join(', ')}`);
  }

  const { events: rawEvents, result, kill } = backend.execute(
    capsResult.prompt,
    capsResult.opts,
  );
  const events = withDoneGuarantee(rawEvents, result);

  console.log(`prompt:      ${PROMPT}`);
  console.log('');

  // --- Step 6: drain events + await result (daemon's IIFE consumer) ---
  const eventTypes: string[] = [];
  let text = '';
  try {
    for await (const event of events) {
      eventTypes.push(event.type);
      if (event.type === 'text') text += event.content;
    }
  } catch (err) {
    console.error(`event stream threw: ${err}`);
  }

  let final;
  try {
    final = await result;
  } catch (err) {
    console.error(`result rejected: ${err}`);
    prepared.cleanup?.();
    rmSync(wd, { recursive: true, force: true });
    return 1;
  }

  // --- Step 7: acpCleanup (daemon's completion path) ---
  prepared.cleanup?.();
  try {
    rmSync(wd, { recursive: true, force: true });
  } catch {
    // Windows may hold file handles briefly after the subprocess exits;
    // the temp dir is in the OS tmpdir and will be cleared eventually.
  }

  // --- Assertions ---
  const hasText = eventTypes.includes('text');
  const lastType = eventTypes.length
    ? eventTypes[eventTypes.length - 1]
    : undefined;
  const lastIsDone = lastType === 'done';
  const completed = final.status === 'completed';

  console.log('--- health report ---');
  console.log(`events seen: ${eventTypes.join(', ') || '(none)'}`);
  console.log(`last event:  ${lastType ?? '(none)'}`);
  console.log(`has text:    ${hasText}`);
  console.log(`text:        ${text.trim().slice(0, 200) || '(no text)'}`);
  console.log(`result:      ${final.status}`);
  console.log(`sessionId:   ${final.sessionId ?? '(none)'}`);
  console.log(`durationMs:  ${final.durationMs}`);
  console.log('');

  const failures: string[] = [];
  if (!hasText) failures.push('no text event');
  if (!lastIsDone) failures.push(`last event was "${lastType}", expected "done"`);
  if (!completed) failures.push(`result.status was "${final.status}", expected "completed"`);

  if (failures.length === 0) {
    console.log('=== PASS ===');
    return 0;
  }
  console.log('=== FAIL ===');
  console.log(`reason: ${failures.join('; ')}`);
  return 1;
}

main().then((code) => process.exit(code));
