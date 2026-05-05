'use client';

import { useState, useRef, useEffect } from 'react';
import {
  useTaskHubStore,
  PROVIDER_LABELS,
  type Account,
} from '@/store/taskHubStore';
import { RoleCardBadge, getCategoryConfig } from '@/components/role-card/RoleCardBadge';
import { X, Plus, Link2, Copy, Terminal, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_DOT: Record<string, string> = {
  valid: 'bg-emerald-400',
  error: 'bg-red-400',
  pending: 'bg-amber-400',
  unknown: 'bg-zinc-400',
};

const STATUS_LABEL: Record<string, string> = {
  valid: '已验证',
  error: '验证失败',
  pending: '待验证',
  unknown: '未验证',
};

interface AgentBindingPanelProps {
  agentId: string;
  agentName: string;
}

export function AgentBindingPanel({ agentId, agentName }: AgentBindingPanelProps) {
  const accounts = useTaskHubStore((s) => s.accounts);
  const roleCards = useTaskHubStore((s) => s.roleCards);
  const setRoleCardAccountIds = useTaskHubStore((s) => s.setRoleCardAccountIds);
  const setAgentRoleCardId = useTaskHubStore((s) => s.setAgentRoleCardId);
  const selectedProjectId = useTaskHubStore((s) => s.selectedProjectId);
  const agentSessions = useTaskHubStore((s) => s.agentSessions);
  const activeRunsByAgent = useTaskHubStore((s) => s.activeRunsByAgent);
  const skillsMap = useTaskHubStore((s) => s.skillsMap);
  const agentSkillIds = useTaskHubStore((s) => s.agentSkillIds);
  const assignSkillsToAgent = useTaskHubStore((s) => s.assignSkillsToAgent);

  const getEffectiveRoster = useTaskHubStore((s) => s.getEffectiveRoster);
  const effectiveRoster = getEffectiveRoster();

  const sessionId = agentSessions[selectedProjectId]?.[agentId];
  const activeRun = activeRunsByAgent[agentId];

  // Find current agent's role card (from effective roster which includes team pack roles)
  const agent = effectiveRoster.find((a) => a.id === agentId);
  const currentRoleCard = agent?.roleCardId ? roleCards.find((c) => c.id === agent.roleCardId) : null;

  // Account IDs come from the role card now
  const boundIds = currentRoleCard?.accountIds ?? [];
  const boundAccounts = boundIds
    .map((id) => accounts.find((a) => a.id === id))
    .filter((a): a is Account => Boolean(a));

  const unboundAccounts = accounts.filter(
    (a) => !boundIds.includes(a.id) && a.enabled
  );

  const [showAdd, setShowAdd] = useState(false);
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [showSkillPicker, setShowSkillPicker] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const skillDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showAdd) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowAdd(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAdd]);

  useEffect(() => {
    if (!showSkillPicker) return;
    const handler = (e: MouseEvent) => {
      if (skillDropdownRef.current && !skillDropdownRef.current.contains(e.target as Node)) {
        setShowSkillPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSkillPicker]);

  const handleUnbind = (accountId: string) => {
    if (!currentRoleCard) return;
    setRoleCardAccountIds(currentRoleCard.id, boundIds.filter((id) => id !== accountId));
  };

  const handleBind = (accountId: string) => {
    if (!currentRoleCard) return;
    setRoleCardAccountIds(currentRoleCard.id, [...boundIds, accountId]);
    setShowAdd(false);
  };

  const handleSwitchRole = (cardId: string) => {
    setAgentRoleCardId(agentId, cardId);
    setShowRolePicker(false);
  };

  // Skill assignments
  const currentSkillIds = agentSkillIds[agentId] ?? [];
  const allSkillEntries = Object.entries(skillsMap);
  const unassignedSkills = allSkillEntries.filter(([id]) => !currentSkillIds.includes(id));

  const handleRemoveSkill = (skillId: string) => {
    const next = currentSkillIds.filter((id) => id !== skillId);
    assignSkillsToAgent(agentId, next);
  };

  const handleAddSkill = (skillId: string) => {
    const next = [...currentSkillIds, skillId];
    assignSkillsToAgent(agentId, next);
    setShowSkillPicker(false);
  };

  const cfg = currentRoleCard ? getCategoryConfig(currentRoleCard.category) : null;

  return (
    <div className="px-3 pt-1 pb-1">
      <div className={cn(
        'rounded-[4px] border-2 p-3',
        cfg
          ? `border-[hsl(var(${cfg.themeVar}))] bg-[hsl(var(${cfg.themeVar}-soft))]`
          : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-app))]',
      )}>
        {/* Role Card Section */}
        <div className="mb-3">
          <div className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))] mb-1.5 flex items-center gap-1.5">
            当前角色
          </div>
          {currentRoleCard ? (
            <div className="flex items-center justify-between">
              <RoleCardBadge card={currentRoleCard} size="md" />
              <button
                type="button"
                onClick={() => setShowRolePicker(!showRolePicker)}
                className="text-[10px] font-bold px-2 py-0.5 rounded-[2px] border-2 border-[hsl(var(--text-primary))] bg-[hsl(var(--bg-app))] shadow-[1px_1px_0px_hsl(var(--text-primary))] hover:shadow-none hover:translate-x-[1px] hover:translate-y-[1px] transition-all"
              >
                换角色
              </button>
            </div>
          ) : (
            <div className="text-[11px] text-[hsl(var(--text-tertiary))]">未绑定角色卡</div>
          )}

          {/* Role Picker Dropdown */}
          {showRolePicker && (
            <div className="mt-2 border-2 border-[hsl(var(--text-primary))] rounded-[4px] bg-[hsl(var(--bg-app))] shadow-[3px_3px_0px_hsl(var(--text-primary))] overflow-hidden">
              {roleCards.map((card) => {
                const isCurrent = card.id === currentRoleCard?.id;
                return (
                  <button
                    key={card.id}
                    onClick={() => handleSwitchRole(card.id)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors border-b border-[hsl(var(--border))] last:border-b-0',
                      isCurrent ? 'bg-[hsl(var(--accent-soft))]' : 'hover:bg-[hsl(var(--bg-muted))]',
                    )}
                  >
                    <RoleCardBadge card={card} size="sm" />
                    <span className="flex-1 text-[10px] text-[hsl(var(--text-tertiary))] truncate">{card.description}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t-2 border-[hsl(var(--text-primary)/0.1)] mb-3" />

        {/* Skill Assignment Section */}
        <div className="mb-3">
          <div className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))] mb-1.5 flex items-center gap-1.5">
            <Zap className="w-3 h-3" />
            技能
          </div>

          <div className="flex flex-wrap gap-1.5">
            {currentSkillIds.length === 0 && (
              <span className="text-[11px] text-[hsl(var(--text-tertiary))]">未分配技能</span>
            )}
            {currentSkillIds.map((skillId) => {
              const skill = skillsMap[skillId];
              if (!skill) return null;
              return (
                <span
                  key={skillId}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium border border-[hsl(var(--border))] bg-[hsl(var(--bg-secondary))] text-[hsl(var(--text-secondary))]"
                >
                  {skill.name}
                  <button
                    type="button"
                    onClick={() => handleRemoveSkill(skillId)}
                    className="opacity-60 hover:opacity-100 text-[10px] leading-none"
                    aria-label={`移除技能 ${skill.name}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              );
            })}

            {/* Add skill button */}
            <div className="relative" ref={skillDropdownRef}>
              <button
                type="button"
                onClick={() => setShowSkillPicker(!showSkillPicker)}
                className="inline-flex items-center gap-0.5 rounded-full px-2.5 py-1 text-[11px] font-medium border border-dashed border-[hsl(var(--border))] bg-transparent text-[hsl(var(--text-tertiary))] hover:border-[hsl(var(--accent))] hover:text-[hsl(var(--accent))] transition-colors"
              >
                <Plus className="w-2.5 h-2.5" />
                添加
              </button>

              {showSkillPicker && unassignedSkills.length > 0 && (
                <div className="absolute left-0 top-full mt-1 z-20 border-2 border-[hsl(var(--text-primary))] rounded-[4px] bg-[hsl(var(--bg-elevated))] shadow-[3px_3px_0px_hsl(var(--text-primary))] min-w-[180px] max-h-[180px] overflow-y-auto">
                  {unassignedSkills.map(([skillId, skill]) => (
                    <button
                      key={skillId}
                      type="button"
                      onClick={() => handleAddSkill(skillId)}
                      className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-[hsl(var(--bg-muted))] transition-colors border-b border-[hsl(var(--border))] last:border-b-0"
                    >
                      <Zap className="w-3 h-3 text-[hsl(var(--accent))] shrink-0" />
                      <span className="text-[12px] text-[hsl(var(--text-primary))] truncate">
                        {skill.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {showSkillPicker && unassignedSkills.length === 0 && (
                <div className="absolute left-0 top-full mt-1 z-20 border-2 border-[hsl(var(--text-primary))] rounded-[4px] bg-[hsl(var(--bg-elevated))] shadow-[3px_3px_0px_hsl(var(--text-primary))] px-3 py-2">
                  <span className="text-[11px] text-[hsl(var(--text-tertiary))]">所有技能已分配</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t-2 border-[hsl(var(--text-primary)/0.1)] mb-3" />

        {/* Account Section */}
        <div>
          <div className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))] mb-1.5 flex items-center gap-1.5">
            <Link2 className="w-3 h-3" />
            运行账号
          </div>

          {boundAccounts.length === 0 ? (
            <div className="text-[11px] text-[hsl(var(--text-tertiary))] py-1.5 rounded-[4px] bg-[hsl(var(--bg-app))] border border-[hsl(var(--border))] px-2">
              {accounts.length === 0
                ? '暂无可用账号，请先在设置中添加'
                : '未绑定账号 — 点击下方添加'}
            </div>
          ) : (
            <div className="space-y-1">
              {boundAccounts.map((account, i) => {
                const dot = STATUS_DOT[account.status ?? 'unknown'];
                const label = STATUS_LABEL[account.status ?? 'unknown'];
                const providerLabel = PROVIDER_LABELS[account.provider] ?? account.provider;

                return (
                  <div
                    key={account.id}
                    className="flex items-center gap-2 py-1.5 px-2 rounded-[4px] bg-[hsl(var(--bg-app))] border border-[hsl(var(--border))]"
                  >
                    <span className="text-[11px] font-bold text-[hsl(var(--text-tertiary))] w-4 shrink-0 tabular-nums">
                      {i + 1}.
                    </span>
                    <span className={cn('inline-block w-1.5 h-1.5 rounded-full shrink-0', dot)} title={label} />
                    <span className="text-[12px] font-medium text-[hsl(var(--text-primary))] truncate flex-1">
                      {account.name}
                    </span>
                    <span className="text-[10px] text-[hsl(var(--text-tertiary))] shrink-0">
                      {providerLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleUnbind(account.id)}
                      className="p-0.5 rounded text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--status-rejected))] transition-colors shrink-0"
                      title="解绑"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="relative mt-2" ref={dropdownRef}>
            {unboundAccounts.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowAdd(!showAdd)}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-[hsl(var(--accent))] hover:text-[hsl(var(--text-primary))] transition-colors py-1"
                >
                  <Plus className="w-3 h-3" />
                  添加账号
                </button>

                {showAdd && (
                  <div className="absolute left-0 right-0 top-full mt-1 z-20 border-2 border-[hsl(var(--text-primary))] rounded-[4px] bg-[hsl(var(--bg-elevated))] shadow-[3px_3px_0px_hsl(var(--text-primary))] max-h-[180px] overflow-y-auto">
                    {unboundAccounts.map((account) => {
                      const dot = STATUS_DOT[account.status ?? 'unknown'];
                      const providerLabel = PROVIDER_LABELS[account.provider] ?? account.provider;

                      return (
                        <button
                          key={account.id}
                          type="button"
                          onClick={() => handleBind(account.id)}
                          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-[hsl(var(--bg-muted))] transition-colors border-b border-[hsl(var(--border))] last:border-b-0"
                        >
                          <span className={cn('inline-block w-1.5 h-1.5 rounded-full', dot)} />
                          <span className="text-[12px] text-[hsl(var(--text-primary))] truncate flex-1">
                            {account.name}
                          </span>
                          <span className="text-[10px] text-[hsl(var(--text-tertiary))]">
                            {providerLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {unboundAccounts.length === 0 && accounts.length > 0 && boundAccounts.length > 0 && (
              <div className="text-[10px] text-[hsl(var(--text-tertiary))] py-0.5">
                所有账号已绑定。
              </div>
            )}
          </div>
        </div>

        {boundAccounts.length > 0 && (
          <div className="text-[10px] text-[hsl(var(--text-tertiary))] mt-2 leading-relaxed">
            执行任务时按顺序尝试以上账号。
          </div>
        )}

        {/* Session / Run Info */}
        <div className="border-t-2 border-[hsl(var(--text-primary)/0.1)] mt-3 pt-2">
          <div className="text-[10px] font-bold tracking-wider uppercase text-[hsl(var(--text-tertiary))] mb-1.5 flex items-center gap-1.5">
            <Terminal className="w-3 h-3" />
            CLI 会话
          </div>
          {sessionId ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 py-1 px-2 rounded-[4px] bg-[hsl(var(--bg-app))] border border-[hsl(var(--border))]">
                <span className="text-[10px] text-[hsl(var(--text-tertiary))] shrink-0">Session</span>
                <span className="text-[10px] font-mono text-[hsl(var(--text-primary))] truncate flex-1" title={sessionId}>
                  {sessionId.length > 16 ? `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}` : sessionId}
                </span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(sessionId)}
                  className="p-0.5 rounded text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--accent))] transition-colors shrink-0"
                  title="复制 Session ID"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
              {activeRun && (
                <div className="flex items-center gap-1.5 py-1 px-2 rounded-[4px] bg-[hsl(var(--bg-app))] border border-[hsl(var(--border))]">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
                  <span className="text-[10px] text-[hsl(var(--text-tertiary))] shrink-0">Run</span>
                  <span className="text-[10px] font-mono text-[hsl(var(--text-primary))] truncate flex-1" title={activeRun.runId}>
                    {activeRun.runId.length > 16 ? `${activeRun.runId.slice(0, 8)}…${activeRun.runId.slice(-4)}` : activeRun.runId}
                  </span>
                  {activeRun.taskId && (
                    <span className="text-[9px] text-[hsl(var(--accent))] shrink-0">
                      {activeRun.taskId}
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 py-1 px-2 rounded-[4px] bg-[hsl(var(--bg-app))] border border-[hsl(var(--border))]">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-400 shrink-0" />
              <span className="text-[11px] text-[hsl(var(--text-tertiary))]">未连接</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
