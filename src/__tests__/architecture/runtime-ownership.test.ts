import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function productionTypeScriptFiles(directory: string): string[] {
  return readdirSync(resolve(process.cwd(), directory)).flatMap((name) => {
    const relative = `${directory}/${name}`;
    const absolute = resolve(process.cwd(), relative);
    if (statSync(absolute).isDirectory()) return productionTypeScriptFiles(relative);
    return relative.endsWith('.ts') && !relative.endsWith('.test.ts') ? [relative] : [];
  });
}

describe('runtime ownership architecture', () => {
  const daemon = source('src/server/daemon.ts');
  const taskHubStore = source('src/store/taskHubStore.ts');
  const deliveryApi = source('src/pages/api/autonomous-delivery.ts');
  const githubIngress = source('src/server/github-issue-hook/ingress.ts');
  const mutationApi = source('src/pages/api/mutations.ts');
  const skillTools = source('src/server/skill-tool-executor.ts');

  it('does not accept browser execution acknowledgements for server-owned A2A work', () => {
    for (const event of [
      'a2a:agent-started',
      'a2a:dispatch-failed',
      'a2a:dispatch-deferred',
      'a2a:user-message',
    ]) {
      expect(daemon).not.toContain(`socket.on('${event}'`);
    }
  });

  it('does not retain legacy automatic-control consumers in WebUI', () => {
    for (const event of ['agent:event', 'agent:error', 'task.assigned']) {
      expect(taskHubStore).not.toContain(`socket.on('${event}'`);
    }
    expect(taskHubStore).not.toContain(`socket.emit('a2a:agent-started'`);
    expect(taskHubStore).not.toContain(`socket.emit('a2a:dispatch-failed'`);
    expect(taskHubStore).not.toContain(`socket.emit('a2a:dispatch-deferred'`);
    expect(taskHubStore).not.toContain('handledByHarness');
    expect(taskHubStore).not.toContain('harnessFallbackReasonCode');
  });

  it('keeps explicit human command adapters available', () => {
    expect(taskHubStore).toContain(`type: 'a2a.human_handoff'`);
    expect(taskHubStore).not.toContain(`socket.emit('a2a:user-turn-created'`);
    expect(daemon).not.toContain(`socket.on('a2a:user-turn-created'`);
    expect(daemon).toContain(`socket.on('terminal:start'`);
    expect(daemon).toContain(`socket.on('terminal:kill'`);
  });

  it('keeps agent execution on the ACP backend without a tmux CLI bypass', () => {
    expect(daemon).toContain('loadCatalog().find');
    expect(daemon).toContain('createAcpBackend');
    expect(daemon).not.toContain('ATH_TMUX_ENABLED');
    expect(daemon).not.toContain("transport: 'tmux'");
    const forbiddenBypass = /ATH_TMUX|TmuxGateway|AgentPaneRegistry|agent-panes:list|transport:\s*['"]tmux['"]|opencode-prompt-delivery/;
    expect(productionTypeScriptFiles('src/server').filter((path) => forbiddenBypass.test(source(path)))).toEqual([]);
  });

  it('keeps the WorkContract root correlation above transport envelopes', () => {
    expect(daemon).toContain(
      'correlationId: workContract?.correlationId ?? invocationTraceId ?? invocation.id',
    );
    expect(daemon).not.toContain(
      'correlationId: controlEnvelopeId ?? invocationTraceId ?? invocation.id',
    );
  });

  it('routes WebUI and Agent task writes through the Task Graph owner', () => {
    for (const writer of [mutationApi, skillTools]) {
      expect(writer).not.toMatch(/taskRepo\.(create|transition|update|delete)\(/);
      expect(writer).toContain('taskCommandService');
    }
  });

  it('keeps every production Task write inside an explicit Task Graph owner module', () => {
    const allowedOwnerImplementations = new Set([
      'src/server/repositories/task-command-service.ts',
      'src/server/repositories/task-graph-repo.ts',
      'src/server/task-flow/group-chat-task-flow.ts',
    ]);
    const directWriters = productionTypeScriptFiles('src/server')
      .filter((path) => /taskRepo\.(create|transition|update|delete)\(/.test(source(path)));
    expect(directWriters.sort()).toEqual([...allowedOwnerImplementations].sort());
    expect(
      directWriters.filter((path) => path.includes('process-manager')),
    ).toEqual([]);
  });

  it('does not translate CLI-native Todo state into the Platform Task Graph', () => {
    const todoMentions = productionTypeScriptFiles('src/server')
      .filter((path) => /todo(?:read|write)/i.test(source(path)));
    expect(todoMentions).toEqual([]);
  });

  it('keeps WebUI notices read-only and removes the legacy Supervisor vocabulary', () => {
    expect(taskHubStore).not.toContain('SupervisorOutput');
    expect(taskHubStore).not.toContain('supervisor.output');
    expect(deliveryApi).not.toContain('Delivery supervisor');
    expect(githubIngress).not.toContain('resolveSupervisor');
    expect(githubIngress).not.toContain('supervisor');
  });

  it('allows global broadcast only for the system runtime catalog', () => {
    const broadcastEvents = Array.from(
      daemon.matchAll(/\bbroadcast\('([^']+)'/g),
      (match) => match[1],
    );
    expect(broadcastEvents).toEqual(['runtimes:update']);
    expect(daemon.match(/\bio\.emit\(/g)).toHaveLength(1);
  });
});
