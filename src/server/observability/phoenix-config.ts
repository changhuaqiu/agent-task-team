import type Database from 'better-sqlite3';
import type { PlatformEventHandlerRegistration } from '../platform-events/dispatcher';
import type { PhoenixTraceSink } from './phoenix-export';

const DEFAULT_PROJECT_NAME = 'agent-task-team';

export interface PhoenixExportConfig {
  endpoint: string;
  projectName: string;
  apiKey?: string;
  exportContent: 'preview' | 'redacted';
}

export interface PhoenixProjectionOverrides {
  db?: Database.Database;
  sink?: PhoenixTraceSink;
}

function trimmed(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function collectorEndpoint(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('phoenix_export_endpoint_protocol_invalid');
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/v1/traces`
    .replace(/\/v1\/traces\/v1\/traces$/, '/v1/traces');
  return parsed.toString().replace(/\/$/, '');
}

export function resolvePhoenixExportConfig(
  env: NodeJS.ProcessEnv = process.env,
): PhoenixExportConfig | undefined {
  const endpoint = trimmed(env.PHOENIX_COLLECTOR_ENDPOINT);
  if (!endpoint) return undefined;
  return {
    endpoint: collectorEndpoint(endpoint),
    projectName: trimmed(env.ATH_PHOENIX_PROJECT_NAME) ?? DEFAULT_PROJECT_NAME,
    ...(trimmed(env.PHOENIX_API_KEY) ? { apiKey: trimmed(env.PHOENIX_API_KEY) } : {}),
    exportContent: env.ATH_PHOENIX_EXPORT_CONTENT?.trim().toLowerCase() === 'redacted'
      ? 'redacted'
      : 'preview',
  };
}

export function phoenixHandlerId(): string {
  return 'phoenix-trace-export:v1';
}

export function createPhoenixHandlerRegistration(
  env: NodeJS.ProcessEnv = process.env,
  overrides: PhoenixProjectionOverrides = {},
): PlatformEventHandlerRegistration | undefined {
  let config: PhoenixExportConfig | undefined;
  try {
    config = resolvePhoenixExportConfig(env);
  } catch (error) {
    console.warn('[phoenix] exporter disabled by invalid configuration:', (error as Error).message);
    return undefined;
  }
  if (!config) return undefined;
  let projectionPromise: Promise<import('./phoenix-export').PhoenixTraceProjection> | undefined;
  return {
    id: phoenixHandlerId(),
    pattern: 'runtime.invocation.terminated',
    stereotype: 'projection',
    reliability: 'durable',
    maxAttempts: 1_000,
    timeoutMs: 15_000,
    handle: async (event, context) => {
      projectionPromise ??= import('./phoenix-export').then(({ PhoenixTraceProjection }) => (
        new PhoenixTraceProjection({ ...overrides, config })
      ));
      await (await projectionPromise).handle(event, context);
    },
  };
}
