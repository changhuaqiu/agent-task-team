import path from 'node:path';
import Database from 'better-sqlite3';
import {
  buildPhoenixTracePlan,
  PhoenixOtlpTraceSink,
} from '../src/server/observability/phoenix-export';
import { resolvePhoenixExportConfig } from '../src/server/observability/phoenix-config';

function databasePath(): string {
  const explicit = process.env.ATH_PHOENIX_SMOKE_DB?.trim();
  if (explicit) return path.resolve(explicit);
  const dataDir = process.env.ATH_DATA_DIR?.trim();
  return path.resolve(dataDir || path.join(process.cwd(), '.ath'), 'data.db');
}

async function main(): Promise<void> {
  const config = resolvePhoenixExportConfig(process.env);
  if (!config) throw new Error('PHOENIX_COLLECTOR_ENDPOINT is required');
  const db = new Database(databasePath(), { readonly: true, fileMustExist: true });
  try {
    const invocation = db.prepare(`
      SELECT invocation.id
      FROM invocation
      WHERE invocation.status='terminated'
        AND EXISTS (
          SELECT 1 FROM observation_span span
          WHERE span.invocation_id=invocation.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM observation_span span
          WHERE span.invocation_id=invocation.id
            AND (span.status='running' OR span.ended_at IS NULL)
        )
      ORDER BY invocation.created_at DESC,invocation.id DESC
      LIMIT 1
    `).get() as { id: string } | undefined;
    if (!invocation) throw new Error('phoenix_smoke_exportable_invocation_missing');

    const plan = buildPhoenixTracePlan(invocation.id, config, db);
    await new PhoenixOtlpTraceSink().export(plan, config, new AbortController().signal);
    process.stdout.write(`${JSON.stringify({
      invocationId: invocation.id,
      traceId: plan.traceId,
      spanCount: plan.spans.length,
      rootStatus: plan.spans[0]?.status,
      businessExitState: plan.spans[0]?.attributes['ath.business.exit_state'],
      projectName: config.projectName,
      exportContent: config.exportContent,
    })}\n`);
  } finally {
    db.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
