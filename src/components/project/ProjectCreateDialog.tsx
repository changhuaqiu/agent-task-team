'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Plus, Check } from 'lucide-react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { useTeamPackStore } from '@/store/teamPackStore';
import { cn } from '@/lib/utils';
import { FolderPicker } from '@/components/ui/FolderPicker';
import type { TeamPack } from '@/types/teamPack';

const TEAM_MODE_CONFIG: Record<TeamPack['teamMode'], { emoji: string; label: string }> = {
  pipeline: { emoji: '🔄', label: '流水线' },
  parallel: { emoji: '⚡', label: '并行' },
  hub_spoke: { emoji: '🎯', label: '中枢' },
  custom: { emoji: '⚙️', label: '自定义' },
};

export function ProjectCreateDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const createConversation = useTaskHubStore((s) => s.createConversation);
  const { teamPacks, fetchTeamPacks } = useTeamPackStore();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [selectedTeamPackId, setSelectedTeamPackId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => titleRef.current?.focus(), 50);
    fetchTeamPacks();
  }, [open, fetchTeamPacks]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleCreate = () => {
    const trimmedTitle = title.trim();
    const trimmedGoal = goal.trim();
    if (!trimmedTitle || !trimmedGoal) return;
    createConversation({
      title: trimmedTitle,
      goal: trimmedGoal,
      projectPath: projectPath || undefined,
      teamPackId: selectedTeamPackId ?? undefined,
    });
    setTitle('');
    setGoal('');
    setProjectPath('');
    setSelectedTeamPackId(null);
    onClose();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-[560px] max-h-[90vh] flex flex-col rounded-[var(--radius-xl)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-[var(--shadow-lg)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-[hsl(var(--border))] shrink-0">
            <div>
              <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
                新建项目
              </div>
              <div className="text-[14px] font-semibold text-[hsl(var(--text-primary))] mt-1">
                起个头，细节在对话中梳理
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                项目标题
              </label>
              <input
                ref={titleRef}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：支付链路重构"
                className="w-full h-10 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[13px] font-medium outline-none focus:border-[hsl(var(--accent))]"
              />
            </div>

            <div className="space-y-1.5">
              <FolderPicker value={projectPath} onChange={setProjectPath} />
            </div>

            {teamPacks.length > 0 && (
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                  选择团队套件
                </label>
                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedTeamPackId(null)}
                    className={cn(
                      'relative flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] border text-left transition-colors',
                      selectedTeamPackId === null
                        ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/5'
                        : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] hover:border-[hsl(var(--text-tertiary))]'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-[hsl(var(--text-secondary))]">
                        不选择
                      </div>
                      <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-0.5">
                        使用默认配置创建项目
                      </div>
                    </div>
                    {selectedTeamPackId === null && (
                      <Check className="w-4 h-4 text-[hsl(var(--accent))] shrink-0" />
                    )}
                  </button>

                  {teamPacks.map((pack) => {
                    const modeConfig = TEAM_MODE_CONFIG[pack.teamMode];
                    return (
                      <button
                        key={pack.id}
                        type="button"
                        onClick={() => setSelectedTeamPackId(pack.id)}
                        className={cn(
                          'relative flex items-start gap-3 px-3 py-2.5 rounded-[var(--radius-md)] border text-left transition-colors',
                          selectedTeamPackId === pack.id
                            ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/5'
                            : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] hover:border-[hsl(var(--text-tertiary))]'
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-[hsl(var(--text-primary))]">
                              {pack.displayName}
                            </span>
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[hsl(var(--bg-elevated))] text-[10px] font-medium text-[hsl(var(--text-tertiary))] border border-[hsl(var(--border))]">
                              {modeConfig.emoji} {modeConfig.label}
                            </span>
                            <span className="text-[10px] text-[hsl(var(--text-tertiary))]">
                              {pack.roles.length} 个角色
                            </span>
                          </div>
                          <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-0.5 line-clamp-1">
                            {pack.description}
                          </div>
                        </div>
                        {selectedTeamPackId === pack.id && (
                          <Check className="w-4 h-4 text-[hsl(var(--accent))] shrink-0 mt-0.5" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                一句话描述
              </label>
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="简单描述你想做什么，细节可以稍后在对话中补充。"
                rows={2}
                className="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[13px] font-medium outline-none resize-none focus:border-[hsl(var(--accent))]"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 px-5 py-4 border-t border-[hsl(var(--border))] shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-[var(--radius-md)] bg-[hsl(var(--bg-muted))] text-[12px] font-semibold text-[hsl(var(--text-secondary))]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!title.trim() || !goal.trim()}
              className={cn(
                'inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] text-[12px] font-semibold',
                'bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] hover:opacity-90',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              创建项目
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
