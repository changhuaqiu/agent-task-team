#!/usr/bin/env node

const EXIT = { ok: 0, input: 1, network: 2, auth: 3, other: 4, conflict: 5 };

function write(stream, value) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function help() {
  write(process.stdout, {
    name: 'ath',
    usage: [
      'ath command <command-name> --input <json|->',
      'ath project add --input <json|-> [--idempotency-key <key>]',
      'ath project agent add|remove --project <project-id> --input <json|-> [--idempotency-key <key>]',
      'ath review create --project <project-id> --input <json|-> [--idempotency-key <key>]',
      'ath review decide --project <project-id> --expected-revision <n> --input <json|->',
      'ath agent-team create --input <json|-> [--idempotency-key <key>]',
      'ath agent-team deploy --project <project-id> --input <json|-> [--idempotency-key <key>]',
      'ath agent create --input <json|-> [--idempotency-key <key>]',
      'ath agent update --expected-revision <n> --input <json|-> [--idempotency-key <key>]',
      'ath automation create --project <project-id> --input <json|-> [--idempotency-key <key>]',
      'ath automation update --project <project-id> --expected-revision <n> --input <json|->',
      'ath automation enable|disable|run|retry|decide --project <project-id> --input <json|->',
      'ath release create|publish --project <project-id> --input <json|-> [--expected-revision <n>]',
      'ath work submit-outcome --input <json|->',
      'ath work create --project <project-id> --input <json|-> [--idempotency-key <key>]',
    ],
    output: 'JSON on stdout; errors on stderr',
    exitCodes: EXIT,
  });
}

async function stdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    help();
    return EXIT.ok;
  }
  let name;
  if (args[0] === 'work' && args[1] === 'submit-outcome') name = 'work.submit_outcome';
  if (args[0] === 'work' && args[1] === 'create') name = 'work.create';
  if (args[0] === 'project' && args[1] === 'add') name = 'project.create';
  if (args[0] === 'project' && args[1] === 'agent' && args[2] === 'add') name = 'project.agent.add';
  if (args[0] === 'project' && args[1] === 'agent' && args[2] === 'remove') name = 'project.agent.remove';
  if (args[0] === 'review' && args[1] === 'create') name = 'review.create';
  if (args[0] === 'review' && args[1] === 'decide') name = 'review.record_decision';
  if (args[0] === 'agent-team' && args[1] === 'create') name = 'agent_team.create';
  if (args[0] === 'agent-team' && args[1] === 'deploy') name = 'agent_team.deploy';
  if (args[0] === 'agent' && args[1] === 'create') name = 'agent.create';
  if (args[0] === 'agent' && args[1] === 'update') name = 'agent.update';
  if (args[0] === 'automation' && args[1] === 'create') name = 'automation.create';
  if (args[0] === 'automation' && args[1] === 'update') name = 'automation.update';
  if (args[0] === 'automation' && (args[1] === 'enable' || args[1] === 'disable')) name = 'automation.set_enabled';
  if (args[0] === 'automation' && args[1] === 'run') name = 'automation.trigger';
  if (args[0] === 'automation' && args[1] === 'retry') name = 'automation.retry';
  if (args[0] === 'automation' && args[1] === 'decide') name = 'automation.decide';
  if (args[0] === 'release' && args[1] === 'create') name = 'release.create';
  if (args[0] === 'release' && args[1] === 'publish') name = 'release.publish';
  if (args[0] === 'command' && args[1]) name = args[1];
  if (!name) {
    write(process.stderr, { error: 'unknown_command', args });
    return EXIT.input;
  }
  const inputIndex = args.indexOf('--input');
  if (inputIndex < 0 || !args[inputIndex + 1]) {
    write(process.stderr, { error: 'input_required', hint: 'Use --input <json|->' });
    return EXIT.input;
  }
  const raw = args[inputIndex + 1] === '-' ? await stdin() : args[inputIndex + 1];
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    write(process.stderr, { error: 'invalid_json' });
    return EXIT.input;
  }
  const baseUrl = (process.env.ATH_SERVER_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
  const idempotencyIndex = args.indexOf('--idempotency-key');
  const commandId = idempotencyIndex >= 0 && args[idempotencyIndex + 1]
    ? args[idempotencyIndex + 1]
    : `cli-${globalThis.crypto.randomUUID()}`;
  const projectIndex = args.indexOf('--project');
  const projectId = projectIndex >= 0 ? args[projectIndex + 1] : undefined;
  const revisionIndex = args.indexOf('--expected-revision');
  const expectedRevision = revisionIndex >= 0 ? Number(args[revisionIndex + 1]) : undefined;
  if ((name === 'work.create' || name.startsWith('project.agent.') || name.startsWith('review.') || name.startsWith('automation.') || name.startsWith('release.') || name === 'agent_team.deploy') && !projectId) {
    write(process.stderr, { error: 'project_required', hint: 'Use --project <project-id>' });
    return EXIT.input;
  }
  let response;
  try {
    response = await fetch(`${baseUrl}/api/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, commandId, idempotencyKey: commandId, projectId, expectedRevision, input }),
    });
  } catch (error) {
    write(process.stderr, { error: 'network_error', detail: error instanceof Error ? error.message : String(error) });
    return EXIT.network;
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = { error: 'invalid_server_response', status: response.status };
  }
  if (response.ok) {
    write(process.stdout, payload);
    return EXIT.ok;
  }
  write(process.stderr, payload);
  if (response.status === 401 || response.status === 403) return EXIT.auth;
  if (response.status === 409 || payload?.status === 'conflict' || payload?.status === 'delivery_unknown') {
    return EXIT.conflict;
  }
  return response.status >= 500 ? EXIT.network : EXIT.input;
}

process.exitCode = await main().catch((error) => {
  write(process.stderr, { error: 'unexpected_error', detail: error instanceof Error ? error.message : String(error) });
  return EXIT.other;
});
