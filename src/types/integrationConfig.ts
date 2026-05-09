import type { AccountProvider } from '@/store/agentStore';
import type { CliEngine } from '@/server/types';

export type ChannelPurpose = 'chat' | 'execution' | 'review';
export type RoutingPolicyScope = 'default_chat' | 'default_execution' | 'default_review';

export interface ProviderProfile {
  id: string;
  provider: AccountProvider;
  displayName: string;
  models: string[];
  defaultModel?: string;
  accountIds: string[];
  enabled: boolean;
}

export interface ChannelConfig {
  id: string;
  name: string;
  purpose: ChannelPurpose;
  defaultRuntimeId?: CliEngine;
  defaultProviderProfileId?: string;
  enabled: boolean;
}

export interface RoutingPolicy {
  id: string;
  scope: RoutingPolicyScope;
  channelId: string;
  runtimeId?: CliEngine;
  providerProfileId?: string;
  fallbackRuntimeIds: CliEngine[];
  enabled: boolean;
}

export const DEFAULT_PROVIDER_PROFILES: ProviderProfile[] = [
  { id: 'provider-anthropic', provider: 'anthropic', displayName: 'Claude', models: ['claude-sonnet-4-6'], defaultModel: 'claude-sonnet-4-6', accountIds: [], enabled: true },
  { id: 'provider-openai', provider: 'openai', displayName: 'OpenAI / Codex', models: ['gpt-5.4', 'gpt-5.3-codex'], defaultModel: 'gpt-5.4', accountIds: [], enabled: true },
  { id: 'provider-google', provider: 'google', displayName: 'Gemini', models: ['gemini-2.5-pro'], defaultModel: 'gemini-2.5-pro', accountIds: [], enabled: true },
  { id: 'provider-opencode', provider: 'opencode', displayName: 'OpenCode', models: ['claude-sonnet-4-6'], defaultModel: 'claude-sonnet-4-6', accountIds: [], enabled: true },
];

export const DEFAULT_CHANNEL_CONFIGS: ChannelConfig[] = [
  { id: 'channel-chat', name: '默认聊天', purpose: 'chat', defaultRuntimeId: 'claude', defaultProviderProfileId: 'provider-anthropic', enabled: true },
  { id: 'channel-execution', name: '任务执行', purpose: 'execution', defaultRuntimeId: 'codex', defaultProviderProfileId: 'provider-openai', enabled: true },
  { id: 'channel-review', name: '代码评审', purpose: 'review', defaultRuntimeId: 'claude', defaultProviderProfileId: 'provider-anthropic', enabled: true },
];

export const DEFAULT_ROUTING_POLICIES: RoutingPolicy[] = [
  { id: 'route-chat', scope: 'default_chat', channelId: 'channel-chat', runtimeId: 'claude', providerProfileId: 'provider-anthropic', fallbackRuntimeIds: ['codex', 'opencode'], enabled: true },
  { id: 'route-execution', scope: 'default_execution', channelId: 'channel-execution', runtimeId: 'codex', providerProfileId: 'provider-openai', fallbackRuntimeIds: ['opencode', 'claude'], enabled: true },
  { id: 'route-review', scope: 'default_review', channelId: 'channel-review', runtimeId: 'claude', providerProfileId: 'provider-anthropic', fallbackRuntimeIds: ['codex'], enabled: true },
];
