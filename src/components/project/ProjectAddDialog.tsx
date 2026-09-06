'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, FolderKanban, FolderOpen, Plus, Search, X } from 'lucide-react';
import { FolderPicker } from '@/components/ui/FolderPicker';
import { cn } from '@/lib/utils';
import { useTaskHubStore, type WorkspaceProject } from '@/store/taskHubStore';

type Pane = 'browse' | 'create';
type PendingDiscardAction = 'close' | 'browse' | null;

function nameFromPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).pop() || normalized;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN');
}

export function ProjectAddDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (project: WorkspaceProject) => void;
}) {
  const addProject = useTaskHubStore((state) => state.addProject);
  const projects = useTaskHubStore((state) => state.projects);
  const [pane, setPane] = useState<Pane>('browse');
  const [query, setQuery] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [pendingDiscardAction, setPendingDiscardAction] = useState<PendingDiscardAction>(null);
  const wasOpen = useRef(false);

  const filteredProjects = useMemo(() => {
    const needle = normalized(query);
    if (!needle) return projects;
    return projects.filter((project) => normalized(`${project.name} ${project.rootPath}`).includes(needle));
  }, [projects, query]);
  const hasExactName = useMemo(() => {
    const needle = normalized(query);
    return Boolean(needle) && projects.some((project) => normalized(project.name) === needle);
  }, [projects, query]);
  const dirty = pane === 'create' && Boolean(name.trim() || rootPath.trim());

  useEffect(() => {
    if (open && !wasOpen.current) {
      // A newly opened browser always starts from the reusable object list.
      setPane('browse');
      setQuery('');
      setRootPath('');
      setName('');
      setNameTouched(false);
      setSubmitting(false);
      setError('');
      setPendingDiscardAction(null);
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (pendingDiscardAction) {
        setPendingDiscardAction(null);
        return;
      }
      requestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!open) return null;

  function openCreate(seed = '') {
    setPane('create');
    setName(seed.trim());
    setNameTouched(Boolean(seed.trim()));
    setRootPath('');
    setError('');
  }

  function requestClose() {
    if (dirty) {
      setPendingDiscardAction('close');
      return;
    }
    onClose();
  }

  function requestBrowse() {
    if (dirty) {
      setPendingDiscardAction('browse');
      return;
    }
    setPane('browse');
  }

  function discardDraft() {
    const action = pendingDiscardAction;
    setPendingDiscardAction(null);
    setRootPath('');
    setName('');
    setNameTouched(false);
    setError('');
    if (action === 'close') onClose();
    else setPane('browse');
  }

  function openExisting(project: WorkspaceProject) {
    onCreated?.(project);
    onClose();
  }

  async function handleSubmit() {
    if (!rootPath.trim() || !name.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const project = await addProject({ name: name.trim(), rootPath: rootPath.trim() });
      onCreated?.(project);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]" onClick={requestClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="添加项目"
          className="w-full max-w-[540px] overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] shadow-[var(--shadow-lg)]"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex h-14 items-center justify-between border-b border-[hsl(var(--border))] px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              {pane === 'create' ? (
                <button type="button" onClick={requestBrowse} className="rounded-md p-1.5 text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-muted))]" aria-label="返回项目浏览">
                  <ArrowLeft className="size-4" />
                </button>
              ) : (
                <div className="flex size-8 items-center justify-center rounded-lg bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]">
                  <FolderKanban className="size-4" />
                </div>
              )}
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-[hsl(var(--text-primary))]">
                  {pane === 'browse' ? '添加或打开项目' : '连接新项目'}
                </h2>
                <p className="truncate text-[11px] text-[hsl(var(--text-tertiary))]">
                  {pane === 'browse' ? '先查找已有项目；需要时再连接新目录' : '项目名称和本地工作目录'}
                </p>
              </div>
            </div>
            <button type="button" onClick={requestClose} className="rounded-md p-1.5 text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-muted))]" aria-label="关闭">
              <X className="size-4" />
            </button>
          </header>

          {pane === 'browse' ? (
            <div className="p-4">
              <label className="flex h-10 items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 focus-within:border-[hsl(var(--accent))]">
                <Search className="size-4 shrink-0 text-[hsl(var(--text-tertiary))]" />
                <span className="sr-only">搜索项目</span>
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索项目名称或目录"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[hsl(var(--text-tertiary))]"
                />
              </label>

              <div className="mt-3 max-h-[360px] overflow-y-auto" aria-label="项目浏览器">
                {!hasExactName && (
                  <button
                    type="button"
                    onClick={() => openCreate(query)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-[hsl(var(--bg-muted))]"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-[hsl(var(--border))] text-[hsl(var(--text-secondary))]">
                      <Plus className="size-4" />
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{query.trim() ? `连接“${query.trim()}”` : '连接新项目'}</span>
                      <span className="mt-0.5 block text-[11px] text-[hsl(var(--text-tertiary))]">选择本地目录并创建长期项目</span>
                    </span>
                  </button>
                )}

                {filteredProjects.length > 0 ? (
                  <div className={cn(!hasExactName && 'mt-1 border-t border-[hsl(var(--border-subtle))] pt-1')}>
                    {filteredProjects.map((project) => (
                      <button
                        key={project.id}
                        type="button"
                        onClick={() => openExisting(project)}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-[hsl(var(--bg-muted))]"
                      >
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]">
                          <FolderOpen className="size-4" />
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">{project.name}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-[hsl(var(--text-tertiary))]">{project.rootPath}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : query.trim() && hasExactName ? null : query.trim() ? (
                  <div className="px-3 py-8 text-center text-xs text-[hsl(var(--text-tertiary))]">没有其他匹配项目</div>
                ) : projects.length === 0 ? (
                  <div className="px-3 py-8 text-center text-xs text-[hsl(var(--text-tertiary))]">还没有已连接的项目</div>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-4 p-5">
                <div className="space-y-1.5">
                  <label htmlFor="project-name" className="text-[11px] font-semibold text-[hsl(var(--text-secondary))]">项目名称</label>
                  <input
                    id="project-name"
                    autoFocus
                    value={name}
                    onChange={(event) => {
                      setNameTouched(true);
                      setName(event.target.value);
                    }}
                    placeholder="例如：桌面工作台"
                    className="h-10 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] px-3 text-sm outline-none focus:border-[hsl(var(--accent))]"
                  />
                </div>
                <FolderPicker value={rootPath} onChange={(value) => {
                  setRootPath(value);
                  if (!nameTouched && !name.trim()) setName(nameFromPath(value));
                  setError('');
                }} />
                <p className="text-xs leading-5 text-[hsl(var(--text-tertiary))]">连接后进入项目概览。创建工作项、交给团队安排，再查看进度与验收；每项工作都有独立讨论。</p>
                {error && <div role="alert" className="rounded-md bg-[hsl(var(--status-rejected-bg))] px-3 py-2 text-xs text-[hsl(var(--status-rejected))]">{error}</div>}
              </div>

              <footer className="flex justify-end gap-2 border-t border-[hsl(var(--border))] px-5 py-4">
                <button type="button" onClick={requestBrowse} className="h-9 rounded-md px-4 text-xs font-medium text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-muted))]">返回</button>
                <button type="button" onClick={() => void handleSubmit()} disabled={!rootPath.trim() || !name.trim() || submitting} className="h-9 rounded-md bg-[hsl(var(--text-primary))] px-4 text-xs font-medium text-[hsl(var(--text-inverse))] disabled:opacity-50">
                  {submitting ? '正在连接…' : '连接项目'}
                </button>
              </footer>
            </>
          )}
        </div>
      </div>

      {pendingDiscardAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-4">
          <div role="alertdialog" aria-modal="true" aria-label="放弃项目草稿" className="w-full max-w-sm rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))] p-5 shadow-[var(--shadow-lg)]">
            <h3 className="text-sm font-semibold">放弃未保存的项目？</h3>
            <p className="mt-2 text-xs leading-5 text-[hsl(var(--text-secondary))]">项目名称和目录还没有连接。放弃后这份草稿不会保留。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingDiscardAction(null)} className="h-9 rounded-md px-3 text-xs font-medium hover:bg-[hsl(var(--bg-muted))]">继续编辑</button>
              <button type="button" onClick={discardDraft} className="h-9 rounded-md bg-red-600 px-3 text-xs font-medium text-white hover:bg-red-700">放弃改动</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
