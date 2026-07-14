// src/lib/agent-context/contextRecord.ts
// 上下文记录数据模型 + 可见性过滤。设计依据:
// docs/superpowers/specs/2026-07-14-context-layering-design.md §3, §9

export type ContextCategory =
  | 'identity' | 'protocol' | 'capability' | 'project' | 'kanban'
  | 'roster' | 'norms' | 'task' | 'handoff-goal' | 'trajectory'
  | 'user-input' | 'acceptance' | 'decision' | 'reflection';

export interface ContextRecord {
  content: string;
  /** 层级路径："/project"（共享）或 "/project/<agentId>"（私有） */
  scope: string;
  /** true=仅同源可见（轨迹隔离）；false=共享 */
  private: boolean;
  /** 0..1，裁剪排序键（取代 P0-P4） */
  importance: number;
  category: ContextCategory;
  /** 产生该记录的 agentId，用于隐私过滤；私有记录须带 */
  source?: string;
}

export interface VisibilityCtx {
  agentId: string;
  /** 该 agent 允许看到的 scope 前缀，如 ['/project', '/project/luigi'] */
  allowedScopes: string[];
}

/**
 * §9 recall 过滤规则：一条记录对 agent 可见 ⟺
 *   (scope 以某 allowedScope 为路径段前缀) 且 (private=false 或 source===agentId)
 */
export function filterVisible(
  records: ContextRecord[],
  ctx: VisibilityCtx,
): ContextRecord[] {
  return records.filter((r) => {
    const scopeOk = ctx.allowedScopes.some(
      (s) => r.scope === s || r.scope.startsWith(s + '/'),
    );
    if (!scopeOk) return false;
    if (r.private) return r.source === ctx.agentId;
    return true;
  });
}
