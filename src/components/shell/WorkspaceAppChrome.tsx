export function WorkspaceAppChrome() {
  return (
    <header
      className="flex h-11 shrink-0 cursor-default select-none items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] px-3"
      data-tauri-drag-region
      data-testid="workspace-app-chrome"
    >
      <div className="flex min-w-0 items-center gap-2" data-tauri-drag-region>
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--text-primary))] text-xs font-medium text-[hsl(var(--text-inverse))]">
          OS
        </div>
        <div className="min-w-0" data-tauri-drag-region>
          <h1 className="truncate text-sm font-medium text-[hsl(var(--text-primary))]" data-tauri-drag-region>
            Agent 工作台
          </h1>
        </div>
      </div>

      <div className="pr-1 text-[10px] text-[hsl(var(--text-tertiary))]" data-tauri-drag-region>本地工作区</div>
    </header>
  );
}
