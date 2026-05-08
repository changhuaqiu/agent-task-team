'use client';

import { useMemo, useState } from 'react';
import { useTaskHubStore, type Task } from '@/store/taskHubStore';
import { useTeamPackStore } from '@/store/teamPackStore';
import { MiniKanban } from './MiniKanban';
import { cn } from '@/lib/utils';
import { PanelRightOpen, PanelRightClose, AlertTriangle, Users, Layout, Briefcase } from 'lucide-react';

type NextItem = {
  label: string;
  taskId?: string;
};

function buildNextItems(tasks: Task[]): NextItem[] {
  const items: NextItem[] = [];
  for (const t of tasks) {
    if (t.status === 'blocked') items.push({ label: `解除阻塞：${t.id} ${t.title}`, taskId: t.id });
    if (t.status === 'in_review') items.push({ label: `等待评审：${t.id} ${t.title}`, taskId: t.id });
    if (t.status === 'pending') items.push({ label: `可开始：${t.id} ${t.title}`, taskId: t.id });
  }
  return items.slice(0, 6);
}

function SyncStatusBar() {
  const syncError = useTaskHubStore((s) => s.taskSyncError);
  const lastSyncAt = useTaskHubStore((s) => s.lastTaskSyncAt);
  const selectedConvId = useTaskHubStore((s) => s.selectedConversationId);
  const clearError = useTaskHubStore((s) => s.clearTaskSyncError);

  if (syncError && syncError.conversationId === selectedConvId) {
    return (
      <div className="rounded border border-[hsl(var(--danger))] bg-[hsl(var(--status-rejected-bg))] px-3 py-2 flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-[hsl(var(--danger))] shrink-0" />
        <span className="text-xs text-[hsl(var(--danger))] flex-1">{syncError.message}</span>
        <button onClick={clearError} className="text-xs text-[hsl(var(--text-tertiary))] hover:underline shrink-0">dismiss</button>
      </div>
    );
  }

  if (lastSyncAt) {
    const seconds = Math.floor((Date.now() - new Date(lastSyncAt).getTime()) / 1000);
    const ago = seconds < 60 ? 'just now' : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : `${Math.floor(seconds / 3600)}h ago`;
    return (
      <div className="text-[10px] text-[hsl(var(--text-tertiary))]">
        synced: {ago}
      </div>
    );
  }

  return null;
}

export function ProjectRightPanel({ teamPackId }: { teamPackId: string }) {
  const selectedConversationId = useTaskHubStore((s) => s.selectedConversationId);
  const tasks = useTaskHubStore((s) => s.tasks);
  const blockers = useTaskHubStore((s) => s.getOpenBlockersForSelectedConversation());
  const setSelectedTaskId = useTaskHubStore((s) => s.setSelectedTaskId);
  
  const { teamPacks, fetchTeamPacks } = useTeamPackStore();
  const teamPack = teamPacks.find(p => p.id === teamPackId && teamPackId);

  const [open, setOpen] = useState(() => {
    const scopedTasks = tasks.filter(t => t.conversationId === selectedConversationId);
    const scopedBlockers = blockers.filter(b => b.conversationId === selectedConversationId);
    return scopedTasks.length > 0 || scopedBlockers.length > 0;
  });

  const nextItems = useMemo(() => buildNextItems(tasks.filter(t => t.conversationId === selectedConversationId)), [tasks, selectedConversationId]);
  const openBlockers = useMemo(() => blockers.filter(b => b.conversationId === selectedConversationId), [blockers]);

  return (
    <>
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'shrink-0 h-full flex items-center justify-center',
          'w-6 border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-app))]',
          'hover:bg-[hsl(var(--bg-muted))] transition-colors',
          'text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))]'
        )}
        title={open ? '收起面板' : '展开面板'}
      >
        {open ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
      </button>

      {/* Collapsible panel */}
      {open && (
        <aside className="w-[520px] shrink-0 h-full border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] flex flex-col animate-slide-in-r">
          <div className="flex-1 overflow-y-auto scrollbar-thin p-4 flex flex-col gap-4">
            <SyncStatusBar />
            <MiniKanban expanded={true} />

            {/* Team Pack Info Section */}
            {teamPack && (
              <div className="space-y-4">
                {/* Header */}
                <div className="p-4 border-b border-[hsl(var(--border-subtle))] rounded-lg">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-bold">团队套件</h2>
                    <div className="text-xs text-[hsl(var(--text-tertiary))]">
                      当前激活
                    </div>
                  </div>
                </div>

                {/* Team Pack Details */}
                <div className="bg-white rounded-lg border border-[hsl(var(--border-subtle))] shadow-sm p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 flex items-center justify-center">
                      {teamPack.teamMode === 'pipeline' && (
                        <Briefcase className="text-blue-600" />
                      )}
                      {teamPack.teamMode === 'parallel' && (
                        <Layout className="text-green-600" />
                      )}
                      {teamPack.teamMode === 'hub_spoke' && (
                        <Layout className="text-purple-600" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-lg">{teamPack.displayName}</div>
                      <div className="text-xs text-[hsl(var(--text-tertiary))] mt-1">
                        {teamPack.teamMode === 'pipeline' && '🔄 流水线模式'}
                        {teamPack.teamMode === 'parallel' && '⚡ 并行模式'}
                        {teamPack.teamMode === 'hub_spoke' && '🎯 中心辐射模式'}
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        {teamPack.description}
                      </div>
                    </div>
                  </div>

                  {/* Team Members */}
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Users className="w-4 h-4 text-gray-600" />
                      <div className="font-semibold text-sm">团队成员 ({teamPack.roles.length})</div>
                    </div>
                    <div className="space-y-2">
                      {teamPack.roles.map((role, index) => (
                        <div key={role.id} className="flex items-start gap-2 p-2 border-b border-[hsl(var(--border-subtle))] rounded">
                          <span className="text-xl">{role.displayName.charAt(0)}</span>
                          <div className="flex-1">
                            <div className="font-medium">{role.displayName}</div>
                            <div className="text-xs text-gray-500">{role.description}</div>
                          </div>
                           {index < teamPack.roles.length - 1 && (
                             <div className="w-px h-px rounded-full bg-gray-200" />
                           )}
                         </div>
                       ))}
                     </div>
                   </div>

                   {/* Team Rules */}
                   {teamPack.rules && (
                     <div className="p-4 bg-gray-50 rounded">
                       <div className="text-xs font-semibold mb-2 uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                         团队规则
                       </div>
                       <div className="space-y-1 text-sm text-gray-700">
                         {teamPack.rules.maxIterations && <div>最大重试次数：{teamPack.rules.maxIterations}</div>}
                         {teamPack.rules.escalationTimeoutHours && <div>升级超时：{teamPack.rules.escalationTimeoutHours} 小时</div>}
                         {teamPack.rules.requireEvidence && <div>产出必须附带证据</div>}
                         {teamPack.rules.autoAssign && <div>自动分配任务</div>}
                       </div>
                     </div>
                   )}
                 </div>
              </div>
            )}

            {/* Next actions */}
            <div className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] shadow-sm p-4">
              <div className="p-3 border-b border-[hsl(var(--border-subtle))]">
                <div className="text-xs font-semibold mb-2 uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                  代办
                </div>
                <div className="p-3 flex flex-col gap-2">
                  {nextItems.length === 0 ? (
                    <div className="text-xs text-gray-500 p-2">暂无代办。</div>
                  ) : (
                    nextItems.map((it, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => it.taskId && setSelectedTaskId(it.taskId)}
                        className={cn(
                          'text-left rounded-sm border px-3 py-2 transition-colors',
                          'bg-[hsl(var(--bg-app))] hover:bg-[hsl(var(--bg-card-hover))]',
                          'border-[hsl(var(--border-subtle))]'
                        )}
                      >
                        <div className="text-xs text-[hsl(var(--text-tertiary))]">{it.label}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Blockers */}
              {blockers.length > 0 && (
                <div className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] shadow-sm p-4 mt-4">
                  <div className="p-3 border-b border-[hsl(var(--border-subtle))]">
                    <div className="text-xs font-semibold mb-2 uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                      风险 / 阻塞
                    </div>
                    <div className="space-y-2">
                      {openBlockers.slice(0, 6).map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setSelectedTaskId(b.taskId)}
                          className={cn(
                            'text-left rounded-sm border px-3 py-2 transition-colors',
                            'bg-[hsl(var(--status-rejected-bg))] hover:bg-[hsl(var(--bg-card-hover))]',
                            'border-[hsl(var(--status-rejected-border))]'
                          )}
                        >
                          <div className="text-xs text-[hsl(var(--text-primary))]">
                            {b.taskId} · {b.reasonSummary}
                          </div>
                          {b.evidenceRef && (
                            <div className="text-xs text-[hsl(var(--text-tertiary))] mt-1">{b.evidenceRef}</div>
                          )}
                        </button>
                      ))}
                      {blockers.length > 6 && (
                        <div className="text-center mt-2">
                          <button className="text-xs text-[hsl(var(--text-tertiary))] underline hover:text-[hsl(var(--text-primary))]">
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
