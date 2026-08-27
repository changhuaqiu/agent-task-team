import { randomUUID } from 'node:crypto';
import { getDb } from '@/server/db';
import { isRuntimeCliEngine, type RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';
import { isAgentResponsibility, type AgentResponsibility } from '@/shared/agent-definition';

export interface AgentDefinitionRow {
  id: string;
  name: string;
  role_card_id: string;
  theme: string;
  emoji: string;
  is_preset: number;
  runtime_id: RuntimeCliEngine | null;
  account_ids: string;
  instructions: string;
  avatar_url: string | null;
  model: string | null;
  can_modify_code: number;
  can_review: number;
  responsibility: AgentResponsibility;
  use_runtime_defaults: number;
  audience_mode: AgentAudienceMode;
  audience_ids: string;
  parallelism: number | null;
  instance_name_pool: string;
  run_location: 'local';
  revision: number;
  created_at: string;
  updated_at: string;
}

export type AgentAudienceMode = 'owner' | 'anyone' | 'selected';

export interface AgentDefinition extends Omit<AgentDefinitionRow, 'account_ids' | 'audience_ids' | 'instance_name_pool'> {
  account_ids: string[];
  skill_ids: string[];
  audience_ids: string[];
  instance_name_pool: string[];
}

export interface SaveAgentDefinitionInput {
  id?: string;
  name: string;
  theme?: string;
  emoji?: string;
  runtimeId: RuntimeCliEngine;
  accountIds: string[];
  skillIds: string[];
  instructions: string;
  responsibility?: AgentResponsibility;
  avatarUrl?: string;
  model?: string;
  permissions?: {
    canModifyCode: boolean;
    canReview: boolean;
  };
  runtimeMode?: 'defaults' | 'custom';
  audience?: {
    mode: AgentAudienceMode;
    ids: string[];
  };
  parallelism?: number | null;
  instanceNamePool?: string[];
  runLocation?: 'local';
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function hydrate(row: AgentDefinitionRow): AgentDefinition {
  const skills = getDb().prepare('SELECT skill_id FROM agent_skill WHERE agent_id=? ORDER BY skill_id')
    .all(row.id) as Array<{ skill_id: string }>;
  return {
    ...row,
    account_ids: parseStringArray(row.account_ids),
    skill_ids: skills.map((item) => item.skill_id),
    audience_ids: parseStringArray(row.audience_ids),
    instance_name_pool: parseStringArray(row.instance_name_pool),
  };
}

function validate(input: SaveAgentDefinitionInput) {
  if (!input.name.trim()) throw new Error('agent_name_required');
  if (!input.instructions.trim()) throw new Error('agent_instructions_required');
  if (input.responsibility !== undefined && !isAgentResponsibility(input.responsibility)) {
    throw new Error('agent_responsibility_invalid');
  }
  if (!isRuntimeCliEngine(input.runtimeId)) throw new Error('agent_runtime_required');
  if (!input.accountIds.every((item) => typeof item === 'string')) throw new Error('agent_accounts_invalid');
  if (!input.skillIds.every((item) => typeof item === 'string')) throw new Error('agent_skills_invalid');
  if (input.permissions && (
    typeof input.permissions.canModifyCode !== 'boolean'
    || typeof input.permissions.canReview !== 'boolean'
  )) throw new Error('agent_permissions_invalid');
  if (input.runtimeMode !== undefined && !['defaults', 'custom'].includes(input.runtimeMode)) {
    throw new Error('agent_runtime_mode_invalid');
  }
  if (input.audience && (
    !['owner', 'anyone', 'selected'].includes(input.audience.mode)
    || !Array.isArray(input.audience.ids)
    || input.audience.ids.some((item) => typeof item !== 'string' || !item.trim())
    || (input.audience.mode === 'selected' && input.audience.ids.length === 0)
  )) throw new Error('agent_audience_invalid');
  if (input.parallelism !== undefined && input.parallelism !== null && (
    !Number.isSafeInteger(input.parallelism) || input.parallelism < 1 || input.parallelism > 32
  )) throw new Error('agent_parallelism_invalid');
  if (input.instanceNamePool && (
    !Array.isArray(input.instanceNamePool)
    || input.instanceNamePool.some((item) => typeof item !== 'string' || !item.trim())
    || new Set(input.instanceNamePool.map((item) => item.trim().toLowerCase())).size !== input.instanceNamePool.length
  )) throw new Error('agent_instance_name_pool_invalid');
  if (input.runLocation !== undefined && input.runLocation !== 'local') {
    throw new Error('agent_run_location_invalid');
  }
}

export const agentDefinitionRepo = {
  list(): AgentDefinition[] {
    const rows = getDb().prepare('SELECT * FROM agents ORDER BY is_preset DESC, created_at ASC')
      .all() as AgentDefinitionRow[];
    return rows.map(hydrate);
  },

  get(id: string): AgentDefinition | undefined {
    const row = getDb().prepare('SELECT * FROM agents WHERE id=?').get(id) as AgentDefinitionRow | undefined;
    return row ? hydrate(row) : undefined;
  },

  save(input: SaveAgentDefinitionInput): AgentDefinition {
    validate(input);
    const db = getDb();
    const existing = input.id ? agentDefinitionRepo.get(input.id) : undefined;
    const id = existing?.id ?? input.id?.trim() ?? `agent-${randomUUID()}`;
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO agents (
          id,name,role_card_id,theme,emoji,is_preset,runtime_id,account_ids,
          instructions,avatar_url,model,can_modify_code,can_review,responsibility,use_runtime_defaults,
          audience_mode,audience_ids,parallelism,instance_name_pool,run_location,revision,
          created_at,updated_at
        ) VALUES (?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name,
          role_card_id=excluded.role_card_id,
          theme=excluded.theme,
          emoji=excluded.emoji,
          runtime_id=excluded.runtime_id,
          account_ids=excluded.account_ids,
          instructions=excluded.instructions,
          avatar_url=excluded.avatar_url,
          model=excluded.model,
          can_modify_code=excluded.can_modify_code,
          can_review=excluded.can_review,
          responsibility=excluded.responsibility,
          use_runtime_defaults=excluded.use_runtime_defaults,
          audience_mode=excluded.audience_mode,
          audience_ids=excluded.audience_ids,
          parallelism=excluded.parallelism,
          instance_name_pool=excluded.instance_name_pool,
          run_location=excluded.run_location,
          revision=excluded.revision,
          updated_at=excluded.updated_at
      `).run(
        id,
        input.name.trim(),
        existing?.role_card_id ?? '',
        input.theme ?? existing?.theme ?? 'mario',
        input.emoji ?? existing?.emoji ?? '🤖',
        input.runtimeId,
        JSON.stringify([...new Set(input.accountIds)]),
        input.instructions.trim(),
        input.avatarUrl?.trim() || null,
        input.model?.trim() || null,
        (input.permissions?.canModifyCode ?? Boolean(existing?.can_modify_code)) ? 1 : 0,
        (input.permissions?.canReview ?? Boolean(existing?.can_review)) ? 1 : 0,
        input.responsibility ?? existing?.responsibility ?? 'specialist',
        (input.runtimeMode ?? (existing ? (existing.use_runtime_defaults ? 'defaults' : 'custom') : 'defaults')) === 'defaults' ? 1 : 0,
        input.audience?.mode ?? existing?.audience_mode ?? 'owner',
        JSON.stringify([...(new Set(input.audience?.ids ?? existing?.audience_ids ?? []))]),
        input.parallelism === undefined ? existing?.parallelism ?? null : input.parallelism,
        JSON.stringify([...(new Set((input.instanceNamePool ?? existing?.instance_name_pool ?? []).map((item) => item.trim()).filter(Boolean)))]),
        input.runLocation ?? existing?.run_location ?? 'local',
        (existing?.revision ?? 0) + 1,
        existing?.created_at ?? now,
        now,
      );
      db.prepare('DELETE FROM agent_skill WHERE agent_id=?').run(id);
      const assign = db.prepare('INSERT INTO agent_skill (agent_id,skill_id,assigned_at) VALUES (?,?,?)');
      for (const skillId of [...new Set(input.skillIds)]) assign.run(id, skillId, now);
    })();
    return agentDefinitionRepo.get(id)!;
  },
};
