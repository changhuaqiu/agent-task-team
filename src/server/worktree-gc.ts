import { getDb } from './db';
import type { WorkdirManager } from './workdir-manager';

const DEFAULT_GC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let gcTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Query active worktree slugs from DB.
 * A slug is "active" when its conversation has use_worktree=1 and is not archived/deleted.
 */
function queryActiveSlugs(): Set<string> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id FROM conversation
       WHERE use_worktree = 1
         AND status IS NOT NULL
         AND status NOT IN ('archived', 'deleted')`,
    )
    .all() as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/**
 * Run a single GC pass: collect active slugs, then delegate to WorkdirManager.gcWorktrees().
 * Errors are caught and logged — never crash the process.
 */
async function runWorktreeGC(workdirManager: WorkdirManager): Promise<string[]> {
  console.log('[worktree-gc] starting GC pass');
  try {
    const activeSlugs = queryActiveSlugs();
    console.log(`[worktree-gc] active slugs: ${activeSlugs.size > 0 ? Array.from(activeSlugs).join(', ') : '(none)'}`);
    const removed = await workdirManager.gcWorktrees(activeSlugs);
    console.log(`[worktree-gc] GC complete, removed ${removed.length} worktree(s)${removed.length > 0 ? `: ${removed.join(', ')}` : ''}`);
    return removed;
  } catch (err) {
    console.error('[worktree-gc] GC pass failed:', err);
    return [];
  }
}

/**
 * Start the periodic worktree GC scheduler.
 * Returns a handle that can be passed to stopWorktreeGCScheduler().
 */
export function startWorktreeGCScheduler(workdirManager: WorkdirManager): void {
  if (gcTimer) return; // already running

  const intervalMs = Number(process.env.WORKTREE_GC_INTERVAL_MS) || DEFAULT_GC_INTERVAL_MS;
  console.log(`[worktree-gc] scheduler started, interval=${intervalMs}ms (${Math.round(intervalMs / 3600000)}h)`);

  gcTimer = setInterval(() => {
    runWorktreeGC(workdirManager).catch((err) => {
      console.error('[worktree-gc] unhandled error in GC tick:', err);
    });
  }, intervalMs);
  gcTimer.unref(); // don't keep the process alive
}

/**
 * Stop the periodic worktree GC scheduler (for graceful shutdown).
 */
export function stopWorktreeGCScheduler(): void {
  if (gcTimer) {
    clearInterval(gcTimer);
    gcTimer = null;
    console.log('[worktree-gc] scheduler stopped');
  }
}
