import { execFile, execFileSync } from 'child_process';
import { accessSync, constants, statSync } from 'fs';
import { promisify } from 'util';

const exec = promisify(execFile);

function isExecutable(p: string): boolean {
  try {
    if (!statSync(p).isFile()) return false;
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveTmuxBin(): string {
  const envPath = process.env.ATH_TMUX_PATH;
  if (envPath && isExecutable(envPath)) return envPath;

  const candidates = [
    '/opt/homebrew/bin/tmux',
    '/usr/local/bin/tmux',
    '/usr/bin/tmux',
  ];
  for (const p of candidates) {
    if (isExecutable(p)) return p;
  }

  try {
    return execFileSync('/usr/bin/which', ['tmux'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('tmux not found. Install tmux or set ATH_TMUX_PATH.');
  }
}

function isNoServerRunningError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const details = `${error.message}\n${'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : ''}`;
  return details.includes('no server running') || details.includes('server exited unexpectedly');
}

export interface PaneInfo {
  paneId: string;
  panePid: number;
  paneWidth: number;
  paneHeight: number;
}

export interface CreatePaneOpts {
  cwd?: string;
  cols?: number;
  rows?: number;
  shell?: string;
}

export class TmuxGateway {
  readonly tmuxBin: string;
  private activeServers = new Set<string>();

  constructor() {
    this.tmuxBin = resolveTmuxBin();
  }

  socketName(worktreeId: string): string {
    return `ath-${worktreeId}`;
  }

  async ensureServer(worktreeId: string): Promise<string> {
    const sock = this.socketName(worktreeId);
    if (this.activeServers.has(worktreeId)) return sock;

    try {
      await exec(this.tmuxBin, ['-L', sock, 'list-sessions']);
      this.activeServers.add(worktreeId);
    } catch {
      // Server not running — will be created on first createPane
    }
    return sock;
  }

  async createPane(worktreeId: string, opts: CreatePaneOpts = {}): Promise<string> {
    const sock = this.socketName(worktreeId);
    const shell = opts.shell ?? process.env.SHELL ?? '/bin/zsh';
    const cwd = opts.cwd ?? process.env.HOME ?? '/tmp';
    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;

    if (!this.activeServers.has(worktreeId)) {
      const args = ['-L', sock, 'new-session', '-d', '-x', String(cols), '-y', String(rows), '-c', cwd, shell];
      try {
        await exec(this.tmuxBin, args);
        this.activeServers.add(worktreeId);
      } catch (error) {
        if (!isNoServerRunningError(error)) throw error;
        try { execFileSync(this.tmuxBin, ['-L', sock, 'kill-server'], { stdio: 'ignore' }); } catch { /* stale */ }
        await exec(this.tmuxBin, args);
        this.activeServers.add(worktreeId);
      }
    } else {
      try {
        await exec(this.tmuxBin, ['-L', sock, 'new-window', '-c', cwd, shell]);
      } catch (error) {
        if (!isNoServerRunningError(error)) throw error;
        await exec(this.tmuxBin, ['-L', sock, 'new-session', '-d', '-x', String(cols), '-y', String(rows), '-c', cwd, shell]);
      }
    }

    const { stdout } = await exec(this.tmuxBin, ['-L', sock, 'display-message', '-p', '#{pane_id}']);
    return stdout.trim();
  }

  async createAgentPane(worktreeId: string, opts: CreatePaneOpts = {}): Promise<string> {
    const paneId = await this.createPane(worktreeId, opts);
    const sock = this.socketName(worktreeId);
    await exec(this.tmuxBin, ['-L', sock, 'set-option', '-t', paneId, 'remain-on-exit', 'on']);
    return paneId;
  }

  async setPaneReadOnly(worktreeId: string, paneId: string, readOnly: boolean): Promise<void> {
    const sock = this.socketName(worktreeId);
    await exec(this.tmuxBin, ['-L', sock, 'select-pane', '-t', paneId, readOnly ? '-d' : '-e']);
  }

  async execInPane(worktreeId: string, paneId: string, command: string): Promise<void> {
    const sock = this.socketName(worktreeId);
    await exec(this.tmuxBin, ['-L', sock, 'send-keys', '-t', paneId, command, 'Enter']);
  }

  async capturePane(worktreeId: string, paneId: string): Promise<string> {
    const sock = this.socketName(worktreeId);
    const { stdout } = await exec(this.tmuxBin, ['-L', sock, 'capture-pane', '-t', paneId, '-p']);
    return stdout;
  }

  async listPanes(worktreeId: string): Promise<PaneInfo[]> {
    const sock = this.socketName(worktreeId);
    try {
      const { stdout } = await exec(this.tmuxBin, [
        '-L', sock, 'list-panes', '-a', '-F',
        '#{pane_id} #{pane_pid} #{pane_width} #{pane_height}',
      ]);
      return stdout.trim().split('\n').filter(Boolean).map((line) => {
        const parts = line.split(' ');
        return {
          paneId: parts[0] ?? '',
          panePid: Number(parts[1]),
          paneWidth: Number(parts[2]),
          paneHeight: Number(parts[3]),
        };
      });
    } catch {
      return [];
    }
  }

  async killPane(worktreeId: string, paneId: string): Promise<void> {
    const sock = this.socketName(worktreeId);
    try {
      await exec(this.tmuxBin, ['-L', sock, 'kill-pane', '-t', paneId]);
    } catch { /* already dead */ }
  }

  async destroyServer(worktreeId: string): Promise<void> {
    const sock = this.socketName(worktreeId);
    try {
      execFileSync(this.tmuxBin, ['-L', sock, 'kill-server'], { stdio: 'ignore' });
    } catch { /* already dead */ }
    this.activeServers.delete(worktreeId);
  }
}
