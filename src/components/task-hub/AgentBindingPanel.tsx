'use client';

import { useState, useRef, useEffect } from 'react';
import {
  useTaskHubStore,
  PROVIDER_LABELS,
  AGENT_ROSTER,
  type Account,
} from '@/store/taskHubStore';
import { RoleCardBadge, getCategoryConfig } from '@/components/role-card/RoleCardBadge';
import { X, Plus, Link2 } from 'lucide-react';
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

  // Find current agent's role card
  const agent = AGENT_ROSTER.find((a) => a.id === agentId);
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
  const dropdownRef = useRef<HTMLDivElement>(null);

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
      </div>
    </div>
  );
}
