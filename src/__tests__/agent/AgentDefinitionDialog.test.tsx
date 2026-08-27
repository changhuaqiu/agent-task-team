// @vitest-environment jsdom

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  AgentDefinitionDialog,
  type AgentDefinitionDraft,
} from '@/components/agent/AgentDefinitionDialog';

const baseDraft: AgentDefinitionDraft = {
  saveKey: 'agent-draft',
  name: '',
  instructions: '',
  responsibility: 'specialist',
  runtimeId: 'codex',
  accountIds: [],
  model: '',
  skillIds: [],
  emoji: '🤖',
  theme: 'mario',
  customExecution: false,
  canModifyCode: false,
  canReview: false,
  audienceMode: 'owner',
  audienceIds: [],
  parallelism: '',
  instanceNamePool: [],
  runLocation: 'local',
};

const runtimes = [{
  id: 'codex' as const,
  label: 'Codex',
  delivery: 'native' as const,
  available: true,
  capabilities: [],
  status: 'ready' as const,
}];

const accounts = [{
  id: 'account-codex', name: 'Codex Account', provider: 'openai' as const,
  authMode: 'oauth' as const, models: ['gpt-5.6'], enabled: true, status: 'valid' as const,
  createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
}];

afterEach(cleanup);

function ControlledDialog({ dirty = true, onClose = vi.fn() }: { dirty?: boolean; onClose?: () => void }) {
  const [draft, setDraft] = useState(baseDraft);
  return <AgentDefinitionDialog
    draft={draft}
    dirty={dirty}
    saving={false}
    error=""
    runtimes={runtimes}
    accounts={accounts}
    skills={[]}
    agents={[]}
    onChange={setDraft}
    onSave={vi.fn()}
    onClose={onClose}
  />;
}

describe('AgentDefinitionDialog', () => {
  it('keeps the default creation path identity-first and progressively reveals custom AI', () => {
    render(<ControlledDialog />);

    expect(screen.getByPlaceholderText('例如：代码审查员')).toBeDefined();
    expect((screen.getByRole('combobox', { name: /主要职责/ }) as HTMLSelectElement).value).toBe('specialist');
    expect(screen.queryByText('角色素材')).toBeNull();
    expect(screen.queryByRole('combobox', { name: /Agent Harness/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '为此 Agent 单独配置' }));
    expect(screen.getByRole('combobox', { name: /Agent Harness/ })).toBeDefined();
    expect(screen.getByText('Codex Account')).toBeDefined();
  });

  it('reveals audience, parallelism, instance names, and permissions only in advanced', () => {
    render(<ControlledDialog />);

    expect(screen.queryByText('谁可以向它发送指令')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '高级' }));
    expect(screen.getByText('谁可以向它发送指令')).toBeDefined();
    expect(screen.getByPlaceholderText('使用应用默认值')).toBeDefined();
    expect(screen.getByPlaceholderText('Birch, Compass, Ridge')).toBeDefined();
    expect(screen.getByRole('checkbox', { name: '可以修改代码' })).toBeDefined();
  });

  it('preserves a creation draft while visiting the import source', () => {
    render(<ControlledDialog />);

    fireEvent.change(screen.getByPlaceholderText('例如：代码审查员'), { target: { value: 'Reviewer' } });
    fireEvent.click(screen.getByRole('button', { name: '导入' }));
    expect(screen.getByText('拖入 .agent.json 文件')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '创建 Agent' }));
    expect((screen.getByPlaceholderText('例如：代码审查员') as HTMLInputElement).value).toBe('Reviewer');
  });

  it('guards dirty close and keeps the draft when discard is cancelled', () => {
    const onClose = vi.fn();
    render(<ControlledDialog onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText('例如：代码审查员'), { target: { value: 'Reviewer' } });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.getByRole('alertdialog', { name: '放弃 Agent 改动' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect((screen.getByPlaceholderText('例如：代码审查员') as HTMLInputElement).value).toBe('Reviewer');
    expect(onClose).not.toHaveBeenCalled();
  });
});
