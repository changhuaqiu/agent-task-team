export interface AgentPaneEntry {
  invocationId: string;
  worktreeId: string;
  paneId: string;
  userId: string;
  createdAt: string;
  crashedAt: string | null;
  crashMessage: string | null;
}

export class AgentPaneRegistry {
  private entries = new Map<string, AgentPaneEntry>();

  register(invocationId: string, worktreeId: string, paneId: string, userId: string): void {
    this.entries.set(invocationId, {
      invocationId,
      worktreeId,
      paneId,
      userId,
      createdAt: new Date().toISOString(),
      crashedAt: null,
      crashMessage: null,
    });
  }

  markCrashed(invocationId: string, message: string | null): void {
    const entry = this.entries.get(invocationId);
    if (!entry) return;
    entry.crashedAt = new Date().toISOString();
    entry.crashMessage = message;
  }

  get(invocationId: string): AgentPaneEntry | undefined {
    return this.entries.get(invocationId);
  }

  listByWorktree(worktreeId: string): AgentPaneEntry[] {
    return [...this.entries.values()].filter((e) => e.worktreeId === worktreeId);
  }

  listAll(): AgentPaneEntry[] {
    return [...this.entries.values()];
  }

  remove(invocationId: string): void {
    this.entries.delete(invocationId);
  }
}
