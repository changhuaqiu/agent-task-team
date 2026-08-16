'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Plus, Check, GitBranch } from 'lucide-react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { useTeamPackStore } from '@/store/teamPackStore';
import { cn } from '@/lib/utils';
import { FolderPicker } from '@/components/ui/FolderPicker';
import type { TeamPack } from '@/types/teamPack';

type ProjectContextClassification =
  | 'codebase'
  | 'empty'
  | 'existing_context'
  | 'single_candidate'
  | 'ambiguous_workspace';

interface ProjectContextInspectionState {
  selectedPath: string;
  classification: ProjectContextClassification;
  existingContext: boolean;
  activeWorkstreamCount: number;
  candidates: string[];
  projectName: string;
}

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
  const deleteConversation = useTaskHubStore((s) => s.deleteConversation);
  const { teamPacks, fetchTeamPacks } = useTeamPackStore();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [selectedTeamPackId, setSelectedTeamPackId] = useState<string | null>(null);
  const [gitDetected, setGitDetected] = useState(false);
  const [gitRepoRoot, setGitRepoRoot] = useState<string | null>(null);
  const [gitChecking, setGitChecking] = useState(false);
  const [contextInspection, setContextInspection] = useState<ProjectContextInspectionState | null>(null);
  const [contextCheckFailure, setContextCheckFailure] = useState<{ path: string; message: string } | null>(null);
  const [autonomous, setAutonomous] = useState(true);
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [allowAutoMerge, setAllowAutoMerge] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [teamChoiceTouched, setTeamChoiceTouched] = useState(false);

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

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    fetch('/api/git/detect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: projectPath }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setGitDetected(data.isGit === true);
        setGitRepoRoot(data.repoRoot ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setGitDetected(false);
        setGitRepoRoot(null);
      })
      .finally(() => {
        if (!cancelled) setGitChecking(false);
      });
    return () => { cancelled = true; };
  }, [projectPath]);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    fetch('/api/project-context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: projectPath }),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.ok) throw new Error(body.error ?? '项目目录检查失败');
        return body.inspection as ProjectContextInspectionState;
      })
      .then((inspection) => {
        if (cancelled) return;
        setContextInspection(inspection);
        setContextCheckFailure(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setContextCheckFailure({
          path: projectPath,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => { cancelled = true; };
  }, [projectPath]);

  const contextCheckError = contextCheckFailure?.path === projectPath
    ? contextCheckFailure.message
    : '';
  const contextChecking = Boolean(projectPath)
    && contextInspection?.selectedPath !== projectPath
    && contextCheckFailure?.path !== projectPath;

  if (!open) return null;

  const defaultTeamPackId = (teamPacks.find((pack) => pack.isPreset) ?? teamPacks[0])?.id ?? null;
  const effectiveTeamPackId = selectedTeamPackId
    ?? (autonomous && !teamChoiceTouched ? defaultTeamPackId : null);

  const handleCreate = async () => {
    const trimmedTitle = title.trim();
    const trimmedGoal = goal.trim();
    if (!trimmedTitle || !trimmedGoal) return;
    const criteria = acceptanceCriteria
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    if (autonomous && criteria.length === 0) {
      setCreateError('自主交付至少需要一条验收标准');
      return;
    }
    if (autonomous && !projectPath.trim()) {
      setCreateError('自主交付需要选择项目目录');
      return;
    }
    if (autonomous && !effectiveTeamPackId) {
      setCreateError('自主交付需要选择一个 Agent 团队');
      return;
    }
    if (projectPath && contextChecking) {
      setCreateError('正在识别项目目录，请稍候');
      return;
    }
    if (projectPath && contextCheckError) {
      setCreateError(contextCheckError);
      return;
    }
    if (
      contextInspection?.classification === 'ambiguous_workspace'
      || contextInspection?.classification === 'single_candidate'
    ) {
      setCreateError('请选择具体的代码项目目录后再创建');
      return;
    }
    setCreating(true);
    setCreateError('');
    let createdConversationId: string | undefined;
    try {
      const conversationId = await createConversation({
        title: trimmedTitle,
        goal: trimmedGoal,
        projectPath: projectPath || undefined,
        teamPackId: effectiveTeamPackId ?? undefined,
        useWorktree: gitDetected || undefined,
        gitRepoRoot: gitRepoRoot ?? undefined,
        autonomous,
      });
      if (!conversationId) {
        throw new Error('创建交付失败，请稍后重试');
      }
      createdConversationId = conversationId;
      if (autonomous) {
        const response = await fetch('/api/autonomous-delivery', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'start',
            contract: {
              idempotencyKey: `project-create:${conversationId}`,
              correlationId: `project-create:${conversationId}`,
              goal: trimmedGoal,
              acceptanceCriteria: criteria,
              scope: {
                conversationId,
                projectPath: projectPath || undefined,
                repository: gitRepoRoot ?? undefined,
              },
              authorization: {
                allowCodeChanges: true,
                allowPush: gitDetected,
                allowPullRequest: gitDetected,
                allowAutoMerge: gitDetected && allowAutoMerge,
                allowedBranches: [],
              },
              recoveryPolicy: {
                maxAttemptsPerAction: 3,
                maxRepairCycles: 2,
                stallTimeoutMs: 30 * 60 * 1000,
              },
              deliveryPolicy: {
                requireReview: true,
                requireWebE2E: true,
                requireMerge: gitDetected && allowAutoMerge,
              },
            },
          }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? '启动自主交付失败');
        }
      }
      setTitle('');
      setGoal('');
      setProjectPath('');
      setSelectedTeamPackId(null);
      setGitDetected(false);
      setGitRepoRoot(null);
      setContextInspection(null);
      setContextCheckFailure(null);
      setAcceptanceCriteria('');
      setAllowAutoMerge(false);
      setAutonomous(true);
      setTeamChoiceTouched(false);
      onClose();
    } catch (error) {
      let createFailure = error instanceof Error ? error.message : String(error);
      if (createdConversationId) {
        const runCheck = await fetch(
          `/api/autonomous-delivery?conversationId=${encodeURIComponent(createdConversationId)}`,
        ).catch(() => undefined);
        if (runCheck?.ok) {
          onClose();
          return;
        }
        const rolledBack = await deleteConversation(createdConversationId);
        if (!rolledBack) {
          createFailure = `${createFailure}；自动回滚失败，交付记录已保留，请稍后重试或手动删除`;
        }
      }
      setCreateError(createFailure);
    } finally {
      setCreating(false);
    }
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
                新建交付
              </div>
              <div className="text-[14px] font-semibold text-[hsl(var(--text-primary))] mt-1">
                说清目标、验收标准、工作范围和授权
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
                交付标题
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
              <FolderPicker
                value={projectPath}
                onChange={(nextPath) => {
                  setProjectPath(nextPath);
                  if (nextPath) {
                    setGitChecking(true);
                  } else {
                    setGitDetected(false);
                    setGitRepoRoot(null);
                    setGitChecking(false);
                  }
                }}
              />
              {projectPath && gitChecking && (
                <div className="text-[11px] text-[hsl(var(--text-tertiary))]">检测中…</div>
              )}
              {projectPath && !gitChecking && gitDetected && (
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-[hsl(var(--accent))]">
                  <GitBranch className="w-3.5 h-3.5" />
                  Git 仓库已检测到，将创建独立 worktree 开发
                </div>
              )}
              {projectPath && contextChecking && (
                <div className="text-[11px] text-[hsl(var(--text-tertiary))]">
                  正在识别项目规范、约束和代码结构…
                </div>
              )}
              {projectPath && !contextChecking && contextInspection?.classification === 'existing_context' && (
                <div className="text-[11px] font-medium text-[hsl(var(--accent))]">
                  已找到 {contextInspection.projectName} 的项目知识，将直接复用
                  {contextInspection.activeWorkstreamCount > 0
                    ? `；同目录有 ${contextInspection.activeWorkstreamCount} 个进行中项目`
                    : ''}
                </div>
              )}
              {projectPath && !contextChecking && contextInspection?.classification === 'codebase' && (
                <div className="text-[11px] text-[hsl(var(--text-secondary))]">
                  创建时将自动建立分层项目知识，包括规范、约束、代码 Topology、开发命令和评测证据
                </div>
              )}
              {projectPath && !contextChecking && contextInspection?.classification === 'empty' && (
                <div className="text-[11px] text-[hsl(var(--text-secondary))]">
                  这是一个新目录，将从当前目标建立项目边界，不会扫描父目录
                </div>
              )}
              {projectPath && !contextChecking && (
                contextInspection?.classification === 'ambiguous_workspace'
                || contextInspection?.classification === 'single_candidate'
              ) && (
                <div className="text-[11px] font-medium text-red-500">
                  该目录包含独立代码项目，请选择具体项目目录
                  {contextInspection.candidates[0] ? `（例如 ${contextInspection.candidates[0]}）` : ''}
                </div>
              )}
              {projectPath && !contextChecking && contextCheckError && (
                <div className="text-[11px] font-medium text-red-500">{contextCheckError}</div>
              )}
            </div>

            {teamPacks.length > 0 && (
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--text-tertiary))]">
                  选择团队套件
                </label>
                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTeamChoiceTouched(true);
                      setSelectedTeamPackId(null);
                    }}
                    className={cn(
                      'relative flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] border text-left transition-colors',
                      effectiveTeamPackId === null
                        ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/5'
                        : 'border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] hover:border-[hsl(var(--text-tertiary))]'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-[hsl(var(--text-secondary))]">
                        不选择
                      </div>
                      <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-0.5">
                        使用默认团队创建交付
                      </div>
                    </div>
                    {effectiveTeamPackId === null && (
                      <Check className="w-4 h-4 text-[hsl(var(--accent))] shrink-0" />
                    )}
                  </button>

                  {teamPacks.map((pack) => {
                    const modeConfig = TEAM_MODE_CONFIG[pack.teamMode];
                    return (
                      <button
                        key={pack.id}
                        type="button"
                        onClick={() => {
                          setTeamChoiceTouched(true);
                          setSelectedTeamPackId(pack.id);
                        }}
                        className={cn(
                          'relative flex items-start gap-3 px-3 py-2.5 rounded-[var(--radius-md)] border text-left transition-colors',
                          effectiveTeamPackId === pack.id
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
                        {effectiveTeamPackId === pack.id && (
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
                交付目标
              </label>
              <textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="描述需要得到的结果，后续可以向团队补充要求。"
                rows={2}
                className="w-full px-3 py-2 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] text-[13px] font-medium outline-none resize-none focus:border-[hsl(var(--accent))]"
              />
            </div>

            <div className="rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-muted))] p-3">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  data-testid="autonomous-delivery-toggle"
                  type="checkbox"
                  checked={autonomous}
                  onChange={(event) => setAutonomous(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-[12px] font-semibold text-[hsl(var(--text-primary))]">
                    由 Agent 团队自主交付
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[hsl(var(--text-tertiary))]">
                    创建后自动规划、执行、评审和验收；你只需查看最终结果或处理真正的例外。
                  </span>
                </span>
              </label>

              {autonomous && (
                <div className="mt-3 space-y-3 border-t border-[hsl(var(--border-subtle))] pt-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold text-[hsl(var(--text-secondary))]">
                      验收标准（每行一条）
                    </label>
                    <textarea
                      data-testid="autonomous-acceptance-criteria"
                      value={acceptanceCriteria}
                      onChange={(event) => setAcceptanceCriteria(event.target.value)}
                      placeholder={'例如：\n用户可以通过 Web UI 完成核心流程\n构建、测试和端到端测试全部通过'}
                      rows={3}
                      className="w-full resize-none rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-3 py-2 text-[12px] outline-none focus:border-[hsl(var(--accent))]"
                    />
                  </div>
                  {gitDetected && (
                    <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[hsl(var(--text-secondary))]">
                      <input
                        data-testid="autonomous-auto-merge"
                        type="checkbox"
                        checked={allowAutoMerge}
                        onChange={(event) => setAllowAutoMerge(event.target.checked)}
                      />
                      验收通过后允许自动合并
                    </label>
                  )}
                </div>
              )}
            </div>

            {createError && (
              <div className="text-[11px] font-medium text-red-500">{createError}</div>
            )}
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
              disabled={
                !title.trim()
                || !goal.trim()
                || creating
                || contextChecking
                || Boolean(contextCheckError)
                || contextInspection?.classification === 'ambiguous_workspace'
                || contextInspection?.classification === 'single_candidate'
              }
              className={cn(
                'inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] text-[12px] font-semibold',
                'bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] hover:opacity-90',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              {creating ? '正在创建…' : '创建交付'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
