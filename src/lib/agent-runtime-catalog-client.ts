import type { RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';

export interface AgentRuntimeCatalogItem {
  id: RuntimeCliEngine;
  label: string;
  delivery: 'native' | 'adapter';
  available: boolean;
  executablePath?: string;
  capabilities: string[];
  status: 'ready' | 'needs_setup';
  custom?: boolean;
}

let cached: AgentRuntimeCatalogItem[] | undefined;
let inFlight: Promise<AgentRuntimeCatalogItem[]> | undefined;

export function loadAgentRuntimeCatalog(options?: { force?: boolean }): Promise<AgentRuntimeCatalogItem[]> {
  if (!options?.force && cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = fetch(`/api/agent-runtimes${options?.force ? '?refresh=1' : ''}`)
    .then(async (response) => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(body.runtimes)) throw new Error(body.error ?? '运行环境检查失败');
      cached = body.runtimes;
      return cached!;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}
