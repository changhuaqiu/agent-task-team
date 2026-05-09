// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { IntegrationSettingsPage } from '@/components/settings/IntegrationSettingsPage';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { useTaskHubStore, type Account } from '@/store/taskHubStore';
import { useTeamPackStore } from '@/store/teamPackStore';
import type { TeamPack } from '@/types/teamPack';
import { DEFAULT_CHANNEL_CONFIGS, DEFAULT_PROVIDER_PROFILES, DEFAULT_ROUTING_POLICIES } from '@/types/integrationConfig';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const now = '2026-05-09T00:00:00.000Z';

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-openai',
    name: 'OpenAI 主账号',
    authMode: 'api_key',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5.4'],
    enabled: true,
    status: 'valid',
    hasApiKey: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function teamPack(): TeamPack {
  return {
    id: 'pack-eng',
    specVersion: 'team-pack/0.1',
    name: 'engineering-trio',
    displayName: '工程三件套',
    description: '规划、实现、评审',
    version: '1.0.0',
    tags: [],
    category: 'team/engineering',
    source: { type: 'preset', importedAt: now },
    teamMode: 'pipeline',
    roles: [{
      id: 'planner',
      displayName: '规划师',
      soul: '# Planner',
      required: true,
      roleCardSnapshot: {
        sourceRoleCardId: 'preset-planner',
        name: 'planner',
        displayName: '规划师',
        description: '规划任务',
        category: 'planner',
        tags: [],
        applicableScenarios: [],
        responsibilities: [],
        nonResponsibilities: [],
        successCriteria: [],
        clarifyBeforeExecute: 'when_ambiguous',
        outputStyle: 'concise',
        preferStructuredOutput: false,
        allowedActions: [],
        requiresConfirmation: [],
        forbiddenActions: [],
        preferredEngines: [],
        allowedTools: [],
        accountIds: [],
        outputFormat: 'freeform',
        requiresEvidence: false,
        riskGrading: 'none',
        snapshotVersion: 1,
        snapshottedAt: now,
      },
    }],
    workflow: { type: 'state_machine' },
    communicationMatrix: {},
    sharedContext: {},
    rules: {},
    isPreset: true,
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(() => {
  useTaskHubStore.setState({
    hasHydrated: true,
    accounts: [account()],
    roleCards: PRESET_ROLE_CARDS.slice(0, 2),
    skillsMap: {
      'skill-git': { name: 'Git Collaboration', content: '# Git Collaboration' },
    },
    daemonRuntimes: [
      { engine: 'codex', available: true, version: '1.0.0' },
      { engine: 'claude', available: false },
    ],
    providerProfiles: DEFAULT_PROVIDER_PROFILES,
    channelConfigs: DEFAULT_CHANNEL_CONFIGS,
    routingPolicies: DEFAULT_ROUTING_POLICIES,
  });
  useTeamPackStore.setState({
    teamPacks: [teamPack()],
    isLoading: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('IntegrationSettingsPage', () => {
  it('summarizes the implemented integration objects without exposing edit-only flows', () => {
    render(<IntegrationSettingsPage />);

    expect(screen.getByRole('heading', { name: '集成配置中心' })).toBeDefined();
    expect(screen.getByText('模型账号')).toBeDefined();
    expect(screen.getAllByText('OpenAI 主账号').length).toBeGreaterThan(0);
    expect(screen.getByText('角色素材与团队套件')).toBeDefined();
    expect(screen.getByText('Git Collaboration')).toBeDefined();
    expect(screen.getByText('执行环境')).toBeDefined();
    expect(screen.getAllByText('Codex CLI').length).toBeGreaterThan(0);
    expect(screen.getByText('供应商档案')).toBeDefined();
    expect(screen.getByText('渠道与默认策略')).toBeDefined();
    expect(screen.getByText('后续增强')).toBeDefined();
  });

  it('updates channel runtime configuration from the settings center', () => {
    render(<IntegrationSettingsPage />);

    fireEvent.change(screen.getByLabelText('默认聊天 默认执行环境'), {
      target: { value: 'codex' },
    });

    const channel = useTaskHubStore.getState().channelConfigs.find((item) => item.id === 'channel-chat');
    expect(channel?.defaultRuntimeId).toBe('codex');
  });
});
