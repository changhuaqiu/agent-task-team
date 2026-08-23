'use client';

import { Plus, Settings } from 'lucide-react';

export function WorkspaceAppChrome({
  onCreateDelivery,
  onOpenSettings,
}: {
  onCreateDelivery: () => void;
  onOpenSettings: () => void;
}) {
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
            交付中心
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCreateDelivery}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[hsl(var(--text-primary))] px-3 text-xs font-medium text-[hsl(var(--text-inverse))] transition-colors hover:bg-[hsl(var(--text-secondary))]"
        >
          <Plus className="size-3.5" />
          新建交付
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="inline-flex size-8 items-center justify-center rounded-md text-[hsl(var(--text-secondary))] transition-colors hover:bg-[hsl(var(--bg-muted))] hover:text-[hsl(var(--text-primary))]"
          aria-label="设置"
        >
          <Settings className="size-4" />
        </button>
      </div>
    </header>
  );
}
