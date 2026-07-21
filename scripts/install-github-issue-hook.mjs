import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const endpointPath = '/api/integrations/github/issues';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout.trim();
}

function repositoryFromRemote(remote) {
  const trimmed = remote.trim().replace(/\.git$/, '');
  const match = trimmed.match(
    /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+\/[^/]+)$/i,
  );
  if (!match) throw new Error(`origin is not a supported GitHub remote: ${remote}`);
  return match[1];
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function webhookSecret() {
  const secretFile = process.env.GITHUB_ISSUE_WEBHOOK_SECRET_FILE?.trim();
  if (!secretFile) return requiredEnvironment('GITHUB_ISSUE_WEBHOOK_SECRET');
  const secret = readFileSync(secretFile, 'utf8').trim();
  if (!secret) throw new Error('GITHUB_ISSUE_WEBHOOK_SECRET_FILE is empty');
  return secret;
}

try {
  const publicUrl = new URL(requiredEnvironment('GITHUB_ISSUE_WEBHOOK_URL'));
  if (publicUrl.protocol !== 'https:') {
    throw new Error('GITHUB_ISSUE_WEBHOOK_URL must use HTTPS');
  }
  if (publicUrl.pathname !== endpointPath) {
    throw new Error(`GITHUB_ISSUE_WEBHOOK_URL must end with ${endpointPath}`);
  }
  const secret = webhookSecret();
  if (secret.length < 16) {
    throw new Error('GITHUB_ISSUE_WEBHOOK_SECRET must contain at least 16 characters');
  }

  const repository = process.env.GITHUB_ISSUE_WEBHOOK_REPOSITORY?.trim()
    || repositoryFromRemote(run('git', ['config', '--get', 'remote.origin.url']));

  run('gh', ['auth', 'status']);
  const hookPages = JSON.parse(
    run('gh', ['api', '--paginate', '--slurp', `repos/${repository}/hooks`]) || '[]',
  );
  const hooks = Array.isArray(hookPages)
    ? hookPages.flatMap((page) => Array.isArray(page) ? page : [page])
    : [];
  const existing = Array.isArray(hooks)
    ? hooks.find((hook) => hook?.config?.url === publicUrl.toString())
    : undefined;
  const payload = JSON.stringify({
    name: 'web',
    active: true,
    events: ['issues'],
    config: {
      url: publicUrl.toString(),
      content_type: 'json',
      insecure_ssl: '0',
      secret,
    },
  });
  const operation = existing?.id
    ? ['--method', 'PATCH', `repos/${repository}/hooks/${existing.id}`, '--input', '-']
    : ['--method', 'POST', `repos/${repository}/hooks`, '--input', '-'];
  const response = JSON.parse(run('gh', ['api', ...operation], { input: payload }));
  console.log(
    `${existing?.id ? 'Updated' : 'Created'} GitHub issues webhook ${response.id} for ${repository}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
