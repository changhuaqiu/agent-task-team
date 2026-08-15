'use client';

import { useState } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';
import { X, Home } from 'lucide-react';
import { RoleCardListPage } from '@/components/role-card/RoleCardListPage';
import { RoleCardDetailDrawer } from '@/components/role-card/RoleCardDetailDrawer';
import { RoleCardEditor } from '@/components/role-card/RoleCardEditor';
import { SkillLibrary } from '@/components/skill/SkillLibrary';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { SettingsAccountsTab } from './SettingsAccountsTab';
import { SettingsTeamPacksTab } from './SettingsTeamPacksTab';

type SettingsTab = 'accounts' | 'roles' | 'skills' | 'team-packs';

const TAB_CONFIG: Array<{ id: SettingsTab; label: string }> = [
  { id: 'accounts', label: '模型账号' },
  { id: 'roles', label: '角色素材' },
  { id: 'skills', label: '技能' },
  { id: 'team-packs', label: '团队套件' },
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
        className="fixed top-0 right-0 h-full w-full max-w-[520px] bg-[hsl(var(--bg-elevated))] border-l-2 border-[hsl(var(--text-primary))] shadow-[-4px_0_0px_hsl(var(--text-primary))] z-50 flex flex-col animate-slide-in-r"
        role="dialog"
        aria-label="设置"
      >
        <div className="flex items-center justify-between p-5 border-b-2 border-[hsl(var(--text-primary))]">
          <div className="flex items-center gap-3">
            <div className="flex border-2 border-[hsl(var(--text-primary))] rounded-[4px] overflow-hidden shadow-[2px_2px_0px_hsl(var(--text-primary))]">
              {TAB_CONFIG.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase transition-colors',
                    activeTab === tab.id
                      ? 'bg-[hsl(var(--accent))] text-white'
                      : 'bg-[hsl(var(--bg-muted))] text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors" aria-label="关闭">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          <Breadcrumb
            items={[
              { label: '主页', href: '/', icon: Home },
              { label: '设置' },
              { label: tabLabel },
            ]}
            className="mb-3"
          />
          <div className="p-5 space-y-3">
            {activeTab === 'accounts' && <SettingsAccountsTab />}
            {activeTab === 'roles' && <RoleCardListPage />}
            {activeTab === 'skills' && <SkillLibrary />}
            {activeTab === 'team-packs' && <SettingsTeamPacksTab />}
          </div>
        </div>
      </div>

      <RoleCardDetailDrawer />
      <RoleCardEditor />
    </>
  );
}
