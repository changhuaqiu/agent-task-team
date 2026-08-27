'use client';

import { useState } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';
import { X, Home } from 'lucide-react';
import { SkillLibrary } from '@/components/skill/SkillLibrary';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { SettingsAccountsTab } from './SettingsAccountsTab';
import { SettingsRuntimesTab } from './SettingsRuntimesTab';

type SettingsTab = 'accounts' | 'runtimes' | 'skills';

const TAB_CONFIG: Array<{ id: SettingsTab; label: string }> = [
  { id: 'accounts', label: '模型账号' },
  { id: 'runtimes', label: '运行环境' },
  { id: 'skills', label: '技能' },
];

export function SettingsDrawer() {
  const isOpen = useTaskHubStore((s) => s.isSettingsOpen);
  const setOpen = useTaskHubStore((s) => s.setSettingsOpen);
  const [activeTab, setActiveTab] = useState<SettingsTab>('accounts');

  if (!isOpen) return null;

  const tabLabel = TAB_CONFIG.find((t) => t.id === activeTab)?.label ?? '设置';

  return (
    <>
      <div className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-40 animate-fade-in" onClick={() => setOpen(false)} />
      <div
        className="fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-[920px] flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-[-16px_0_48px_rgba(0,0,0,0.18)] animate-slide-in-r"
        role="dialog"
        aria-label="设置"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[hsl(var(--border))] px-5">
          <div>
            <div className="text-sm font-semibold text-[hsl(var(--text-primary))]">设置</div>
            <div className="mt-0.5 text-[11px] text-[hsl(var(--text-tertiary))]">管理全局资源与这台设备的执行能力</div>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="flex size-9 items-center justify-center rounded-md text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-muted))] hover:text-[hsl(var(--text-primary))]" aria-label="关闭">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="w-48 shrink-0 border-r border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-3" aria-label="设置导航">
            <div className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--text-tertiary))]">工作环境</div>
            {TAB_CONFIG.slice(0, 2).map((tab) => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={cn(
                'mb-1 flex h-9 w-full items-center rounded-md px-2.5 text-left text-xs transition-colors',
                activeTab === tab.id ? 'bg-[hsl(var(--accent-soft))] font-medium text-[hsl(var(--text-primary))]' : 'text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-muted))]',
              )}>{tab.label}</button>
            ))}
            <div className="mt-4 px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--text-tertiary))]">共享资源</div>
            {TAB_CONFIG.slice(2).map((tab) => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={cn(
                'mb-1 flex h-9 w-full items-center rounded-md px-2.5 text-left text-xs transition-colors',
                activeTab === tab.id ? 'bg-[hsl(var(--accent-soft))] font-medium text-[hsl(var(--text-primary))]' : 'text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-muted))]',
              )}>{tab.label}</button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto scrollbar-thin">
            <div className="mx-auto max-w-2xl p-6">
              <Breadcrumb
                items={[
                  { label: '主页', href: '/', icon: Home },
                  { label: '设置' },
                  { label: tabLabel },
                ]}
                className="mb-5"
              />
              {activeTab === 'accounts' && <SettingsAccountsTab />}
              {activeTab === 'runtimes' && <SettingsRuntimesTab />}
              {activeTab === 'skills' && <SkillLibrary />}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
