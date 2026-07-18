'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Cable,
  KeyRound,
  Route,
  ShieldCheck,
  Sparkles,
  Users,
  Home,
} from 'lucide-react';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PROVIDER_LABELS, useTaskHubStore } from '@/store/taskHubStore';
import { useShallow } from 'zustand/react/shallow';
import { useTeamPackStore } from '@/store/teamPackStore';
import { cn } from '@/lib/utils';
import type { CliEngine } from '@/server/types';

const ENGINE_LABELS: Record<string, string> = {
  opencode: 'OpenCode',
  claude: 'Claude CLI',
  codex: 'Codex CLI',
  gemini: 'Gemini',
  mock: 'Mock',
};

function SummaryCard({
  title,
  value,
  note,
  tone,
}: {
  title: string;
  value: string;
  note: string;
  tone: 'amber' | 'green' | 'blue' | 'red';
}) {
  const toneClass = {
    amber: 'border-[hsl(var(--status-pending-border))] bg-[hsl(var(--status-pending-bg))]',
    green: 'border-[hsl(var(--status-done-border))] bg-[hsl(var(--status-done-bg))]',
    blue: 'border-[hsl(var(--status-review-border))] bg-[hsl(var(--status-review-bg))]',
    red: 'border-[hsl(var(--status-rejected-border))] bg-[hsl(var(--status-rejected-bg))]',
  }[tone];

  return (
    <div className={cn('rounded-[var(--radius-lg)] border p-4 shadow-[var(--shadow-sm)]', toneClass)}>
      <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-[hsl(var(--text-tertiary))]">{title}</div>
      <div className="mt-3 text-[28px] leading-none font-black text-[hsl(var(--text-primary))]">{value}</div>
      <div className="mt-2 text-[12px] leading-relaxed text-[hsl(var(--text-secondary))]">{note}</div>
    </div>
  );
}

function SectionCard({
  icon,
  title,
  status,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  status: '已接入' | '部分接入' | '下一阶段';
  description: string;
  children: ReactNode;
}) {
  const statusClass = status === '已接入'
    ? 'bg-[hsl(var(--status-done-bg))] text-[hsl(var(--status-done))] border-[hsl(var(--status-done-border))]'
    : status === '部分接入'
      ? 'bg-[hsl(var(--status-pending-bg))] text-[hsl(var(--status-pending))] border-[hsl(var(--status-pending-border))]'
      : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))] border-[hsl(var(--border))]';

  return (
    <section className="rounded-[var(--radius-xl)] border-2 border-[hsl(var(--text-primary))] bg-[hsl(var(--bg-card))] shadow-[4px_4px_0px_hsl(var(--text-primary))]">
      <div className="flex items-start justify-between gap-4 border-b-2 border-[hsl(var(--text-primary))] p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-[var(--radius-md)] border-2 border-[hsl(var(--text-primary))] bg-[hsl(var(--bg-app))] p-2 shadow-[2px_2px_0px_hsl(var(--text-primary))]">
            {icon}
          </div>
          <div>
            <h2 className="text-[15px] font-black text-[hsl(var(--text-primary))]">{title}</h2>
            <p className="mt-1 max-w-[720px] text-[12px] leading-relaxed text-[hsl(var(--text-secondary))]">{description}</p>
          </div>
        </div>
        <span className={cn('shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold', statusClass)}>
          {status}
        </span>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] px-3 py-2 text-[12px] text-[hsl(var(--text-tertiary))]">
      {children}
    </div>
  );
}

export function IntegrationSettingsPage() {
  const {
    hasHydrated,
    loadFromServer,
    accounts,
    roleCards,
    skillsMap,
    daemonRuntimes,
    providerProfiles,
    channelConfigs,
    routingPolicies,
    updateProviderProfile,
    updateChannelConfig,
    updateRoutingPolicy,
  } = useTaskHubStore(useShallow((s) => ({
    hasHydrated: s.hasHydrated,
    loadFromServer: s.loadFromServer,
    accounts: s.accounts,
    roleCards: s.roleCards,
    skillsMap: s.skillsMap,
    daemonRuntimes: s.daemonRuntimes,
    providerProfiles: s.providerProfiles,
    channelConfigs: s.channelConfigs,
    routingPolicies: s.routingPolicies,
    updateProviderProfile: s.updateProviderProfile,
    updateChannelConfig: s.updateChannelConfig,
    updateRoutingPolicy: s.updateRoutingPolicy,
  })));
  const teamPacks = useTeamPackStore((s) => s.teamPacks);
  const fetchTeamPacks = useTeamPackStore((s) => s.fetchTeamPacks);

  useEffect(() => {
    if (!hasHydrated) void loadFromServer();
  }, [hasHydrated, loadFromServer]);

  useEffect(() => {
    if (teamPacks.length === 0) void fetchTeamPacks();
  }, [fetchTeamPacks, teamPacks.length]);

  const validAccounts = accounts.filter((account) => account.enabled && account.status === 'valid');
  const apiKeyAccounts = accounts.filter((account) => account.authMode === 'api_key');
  const oauthAccounts = accounts.filter((account) => account.authMode === 'oauth');
  const customRoleCards = roleCards.filter((card) => !card.isPreset);
  const selfContainedPacks = teamPacks.filter((pack) => pack.roles.every((role) => role.roleCardSnapshot));
  const availableRuntimes = daemonRuntimes.filter((runtime) => runtime.available);
  const runtimeOptions: CliEngine[] = ['claude', 'codex', 'opencode', 'gemini', 'mock'];

  return (
    <main className="min-h-screen bg-[hsl(var(--bg-app))] px-4 py-6 sm:px-6 lg:px-10">
      <Breadcrumb
        items={[
          { label: '主页', href: '/', icon: Home },
          { label: '配置中心' },
        ]}
      />
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6">
        <header className="relative overflow-hidden rounded-[var(--radius-xl)] border-2 border-[hsl(var(--text-primary))] bg-[hsl(var(--bg-elevated))] p-6 shadow-[6px_6px_0px_hsl(var(--text-primary))]">
          <div className="absolute right-[-80px] top-[-90px] h-[220px] w-[220px] rounded-full bg-[hsl(var(--status-pending-bg))]" />
          <div className="absolute bottom-[-90px] right-[120px] h-[180px] w-[180px] rounded-full bg-[hsl(var(--status-review-bg))]" />
          <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 py-1.5 text-[11px] font-bold text-[hsl(var(--text-secondary))] transition hover:border-[hsl(var(--text-primary))] hover:text-[hsl(var(--text-primary))]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                返回工作台
              </Link>
              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--status-done-border))] bg-[hsl(var(--status-done-bg))] px-3 py-1 text-[11px] font-bold text-[hsl(var(--status-done))]">
                <ShieldCheck className="h-3.5 w-3.5" />
                当前配置入口
              </div>
              <h1 className="mt-4 text-[32px] font-black leading-tight text-[hsl(var(--text-primary))] sm:text-[44px]">
                集成配置中心
              </h1>
              <p className="mt-3 max-w-[720px] text-[14px] leading-7 text-[hsl(var(--text-secondary))]">
                汇总模型账号、角色卡、技能和团队套件。编辑请在左侧抽屉完成，这里提供全局概览。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[520px]">
              <SummaryCard title="账号" value={String(accounts.length)} note={`${validAccounts.length} 个已验证`} tone="green" />
              <SummaryCard title="素材" value={String(roleCards.length)} note={`${customRoleCards.length} 个自定义`} tone="amber" />
              <SummaryCard title="团队" value={String(teamPacks.length)} note={`${selfContainedPacks.length} 个已自包含`} tone="blue" />
              <SummaryCard title="环境" value={String(availableRuntimes.length)} note={`${daemonRuntimes.length} 个已探测`} tone={availableRuntimes.length > 0 ? 'green' : 'red'} />
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <SectionCard
              icon={<KeyRound className="h-5 w-5 text-[hsl(var(--text-primary))]" />}
              title="模型账号"
              status="已接入"
              description="账号是执行链路当前真实使用的认证对象，支持 OAuth 与 API Key 两种模式。"
            >
              <div className="grid gap-3 md:grid-cols-2">
                {accounts.length === 0 ? (
                  <EmptyLine>还没有账号。请回到工作台设置抽屉创建第一个模型账号。</EmptyLine>
                ) : accounts.map((account) => (
                  <div key={account.id} className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[13px] font-bold text-[hsl(var(--text-primary))]">{account.name}</div>
                        <div className="mt-1 text-[11px] text-[hsl(var(--text-tertiary))]">
                          {PROVIDER_LABELS[account.provider]} · {account.authMode === 'oauth' ? 'OAuth' : 'API Key'}
                        </div>
                      </div>
                      <span className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-bold',
                        account.status === 'valid'
                          ? 'border-[hsl(var(--status-done-border))] bg-[hsl(var(--status-done-bg))] text-[hsl(var(--status-done))]'
                          : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))]',
                      )}>
                        {account.status === 'valid' ? '已验证' : '待验证'}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1">
                      {account.models.length > 0 ? account.models.slice(0, 4).map((model) => (
                        <span key={model} className="rounded border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-muted))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--text-secondary))]">
                          {model}
                        </span>
                      )) : (
                        <span className="text-[11px] text-[hsl(var(--text-tertiary))]">使用默认模型</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard
              icon={<Users className="h-5 w-5 text-[hsl(var(--text-primary))]" />}
              title="角色素材与团队套件"
              status="已接入"
              description="角色素材作为团队成员模板复用；项目运行时优先使用团队套件内的成员定义和快照。"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-4">
                  <div className="text-[12px] font-bold text-[hsl(var(--text-primary))]">角色素材</div>
                  <div className="mt-2 text-[24px] font-black">{roleCards.length}</div>
                  <div className="mt-1 text-[11px] text-[hsl(var(--text-tertiary))]">{customRoleCards.length} 个自定义素材，{roleCards.length - customRoleCards.length} 个预置素材</div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-4">
                  <div className="text-[12px] font-bold text-[hsl(var(--text-primary))]">团队套件</div>
                  <div className="mt-2 text-[24px] font-black">{teamPacks.length}</div>
                  <div className="mt-1 text-[11px] text-[hsl(var(--text-tertiary))]">{selfContainedPacks.length} 个已固化成员快照</div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              icon={<Sparkles className="h-5 w-5 text-[hsl(var(--text-primary))]" />}
              title="技能库"
              status="已接入"
              description="技能可以绑定到角色或团队套件成员，运行时自动合并生效。"
            >
              {Object.keys(skillsMap).length === 0 ? (
                <EmptyLine>还没有导入技能。</EmptyLine>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(skillsMap).map(([skillId, skill]) => (
                    <span key={skillId} className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 py-1 text-[11px] font-bold text-[hsl(var(--text-secondary))]">
                      {skill.name}
                    </span>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard
              icon={<Route className="h-5 w-5 text-[hsl(var(--text-primary))]" />}
              title="供应商档案"
              status="已接入"
              description="把账号、可用模型和默认模型收口为统一的配置，供不同使用场景引用。"
            >
              <div className="grid gap-3 md:grid-cols-2">
                {providerProfiles.map((profile) => {
                  const providerAccounts = accounts.filter((account) => account.provider === profile.provider);
                  const accountValue = profile.accountIds[0] ?? '';
                  return (
                    <div key={profile.id} className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[13px] font-bold text-[hsl(var(--text-primary))]">{profile.displayName}</div>
                          <div className="mt-1 text-[11px] text-[hsl(var(--text-tertiary))]">{PROVIDER_LABELS[profile.provider]}</div>
                        </div>
                        <label className="flex items-center gap-1.5 text-[10px] font-bold text-[hsl(var(--text-tertiary))]">
                          <input
                            type="checkbox"
                            checked={profile.enabled}
                            onChange={(event) => updateProviderProfile(profile.id, { enabled: event.target.checked })}
                          />
                          启用
                        </label>
                      </div>
                      <div className="mt-3 grid gap-2">
                        <label className="space-y-1">
                          <span className="text-[10px] font-bold text-[hsl(var(--text-tertiary))]">默认账号</span>
                          <select
                            value={accountValue}
                            onChange={(event) => updateProviderProfile(profile.id, { accountIds: event.target.value ? [event.target.value] : [] })}
                            className="h-8 w-full rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] px-2 text-[11px] outline-none"
                          >
                            <option value="">未绑定</option>
                            {providerAccounts.map((account) => (
                              <option key={account.id} value={account.id}>{account.name}</option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1">
                          <span className="text-[10px] font-bold text-[hsl(var(--text-tertiary))]">默认模型</span>
                          <select
                            value={profile.defaultModel ?? ''}
                            onChange={(event) => updateProviderProfile(profile.id, { defaultModel: event.target.value || undefined })}
                            className="h-8 w-full rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] px-2 text-[11px] outline-none"
                          >
                            <option value="">使用账号默认</option>
                            {profile.models.map((model) => (
                              <option key={model} value={model}>{model}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </div>

          <aside className="space-y-6">
            <SectionCard
              icon={<Cable className="h-5 w-5 text-[hsl(var(--text-primary))]" />}
              title="执行环境"
              status="部分接入"
              description="后台已能探测并接入多类运行时，这里展示它们的健康状态。"
            >
              <div className="space-y-2">
                {daemonRuntimes.length === 0 ? (
                  <EmptyLine>尚未探测到运行时。启动后台服务后会显示状态。</EmptyLine>
                ) : daemonRuntimes.map((runtime) => (
                  <div key={runtime.engine} className="flex items-center justify-between rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 py-2">
                    <div>
                      <div className="text-[12px] font-bold text-[hsl(var(--text-primary))]">{ENGINE_LABELS[runtime.engine] ?? runtime.engine}</div>
                      <div className="text-[10px] text-[hsl(var(--text-tertiary))]">{runtime.version ?? runtime.path ?? '未返回版本'}</div>
                    </div>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', runtime.available ? 'bg-[hsl(var(--status-done-bg))] text-[hsl(var(--status-done))]' : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-tertiary))]')}>
                      {runtime.available ? '可用' : '不可用'}
                    </span>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard
              icon={<Route className="h-5 w-5 text-[hsl(var(--text-primary))]" />}
              title="渠道与默认策略"
              status="已接入"
              description="不同使用场景决定默认使用哪个运行时和配置；策略决定聊天、执行与评审的默认走向。"
            >
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[hsl(var(--text-tertiary))]">使用场景</div>
                  {channelConfigs.map((channel) => (
                    <div key={channel.id} className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-3">
                      <div className="text-[12px] font-bold text-[hsl(var(--text-primary))]">{channel.name}</div>
                      <div className="mt-2 grid gap-2">
                        <select
                          aria-label={`${channel.name} 默认执行环境`}
                          value={channel.defaultRuntimeId ?? ''}
                          onChange={(event) => updateChannelConfig(channel.id, { defaultRuntimeId: event.target.value as CliEngine })}
                          className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] px-2 text-[11px] outline-none"
                        >
                          {runtimeOptions.map((engine) => (
                            <option key={engine} value={engine}>{ENGINE_LABELS[engine] ?? engine}</option>
                          ))}
                        </select>
                        <select
                          aria-label={`${channel.name} 默认供应商档案`}
                          value={channel.defaultProviderProfileId ?? ''}
                          onChange={(event) => updateChannelConfig(channel.id, { defaultProviderProfileId: event.target.value || undefined })}
                          className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] px-2 text-[11px] outline-none"
                        >
                          <option value="">未指定供应商档案</option>
                          {providerProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>{profile.displayName}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[hsl(var(--text-tertiary))]">默认路由</div>
                  {routingPolicies.map((policy) => (
                    <div key={policy.id} className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] p-3">
                      <div className="text-[12px] font-bold text-[hsl(var(--text-primary))]">
                        {policy.scope === 'default_chat' ? '默认聊天' : policy.scope === 'default_execution' ? '默认执行' : '默认评审'}
                      </div>
                      <div className="mt-2 grid gap-2">
                        <select
                          aria-label={`${policy.id} 路由执行环境`}
                          value={policy.runtimeId ?? ''}
                          onChange={(event) => updateRoutingPolicy(policy.id, { runtimeId: event.target.value as CliEngine })}
                          className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] px-2 text-[11px] outline-none"
                        >
                          {runtimeOptions.map((engine) => (
                            <option key={engine} value={engine}>{ENGINE_LABELS[engine] ?? engine}</option>
                          ))}
                        </select>
                        <select
                          aria-label={`${policy.id} 路由供应商档案`}
                          value={policy.providerProfileId ?? ''}
                          onChange={(event) => updateRoutingPolicy(policy.id, { providerProfileId: event.target.value || undefined })}
                          className="h-8 rounded-[var(--radius-sm)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] px-2 text-[11px] outline-none"
                        >
                          <option value="">未指定供应商档案</option>
                          {providerProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>{profile.displayName}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>

            <SectionCard
              icon={<Route className="h-5 w-5 text-[hsl(var(--text-primary))]" />}
              title="后续增强"
              status="下一阶段"
              description="当前已具备可配置对象和持久化入口；下一阶段应把这些策略接入所有执行入口。"
            >
              <div className="space-y-2 text-[12px] text-[hsl(var(--text-secondary))]">
                {['让普通聊天优先读取默认聊天策略', '让任务执行读取默认执行策略', '让评审任务读取默认评审策略'].map((item) => (
                  <div key={item} className="rounded-[var(--radius-md)] border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] px-3 py-2">
                    {item}
                  </div>
                ))}
              </div>
            </SectionCard>

            <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4">
              <div className="flex items-center gap-2 text-[12px] font-bold text-[hsl(var(--text-primary))]">
                <BadgeCheck className="h-4 w-4" />
                当前边界
              </div>
              <p className="mt-2 text-[11px] leading-6 text-[hsl(var(--text-secondary))]">
                本页是独立配置中心入口与状态总览；账号编辑、角色素材编辑、技能导入和团队套件编辑仍保留在工作台设置抽屉中，避免复制两套编辑流程。
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[hsl(var(--text-tertiary))]">
                <div>API Key：{apiKeyAccounts.length}</div>
                <div>OAuth：{oauthAccounts.length}</div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
