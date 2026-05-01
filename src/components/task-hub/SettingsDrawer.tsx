'use client';

import { useState } from 'react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { cn } from '@/lib/utils';
import { X, RefreshCw, Plug, Database, Wrench } from 'lucide-react';

export function SettingsDrawer() {
  const isOpen = useTaskHubStore((s) => s.isSettingsOpen);
  const setOpen = useTaskHubStore((s) => s.setSettingsOpen);
  const enableMockRunner = useTaskHubStore((s) => s.enableMockRunner);
  const setEnableMockRunner = useTaskHubStore((s) => s.setEnableMockRunner);
  const opencodeStatus = useTaskHubStore((s) => s.opencodeStatus);
  const setOpencodeStatus = useTaskHubStore((s) => s.setOpencodeStatus);
  const daemonConnection = useTaskHubStore((s) => s.daemonConnection);
  const connectDaemon = useTaskHubStore((s) => s.connectDaemon);

  const [checkingOpencode, setCheckingOpencode] = useState(false);
  const [checkingDaemon, setCheckingDaemon] = useState(false);

  if (!isOpen) return null;

  const checkOpencode = async () => {
    setCheckingOpencode(true);
    try {
      const res = await fetch('/api/opencode/status', { method: 'GET' });
      const data = (await res.json()) as {
        available: boolean;
        path?: string;
        version?: string;
        error?: string;
      };
      setOpencodeStatus({ checked: true, ...data });
    } catch (e) {
      setOpencodeStatus({ checked: true, available: false, error: String((e as any)?.message || e) });
    } finally {
      setCheckingOpencode(false);
    }
  };

  const checkDaemon = async () => {
    setCheckingDaemon(true);
    try {
      await fetch('/api/daemon/init', { method: 'GET' });
    } catch {
    } finally {
      connectDaemon();
      setCheckingDaemon(false);
    }
  };

  const clearLocalData = () => {
    try {
      localStorage.removeItem('agent-task-hub-store-clean');
      localStorage.removeItem('agent-task-hub-store');
    } catch {
    }
    window.location.reload();
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black/25 backdrop-blur-[2px] z-40 animate-fade-in"
        onClick={() => setOpen(false)}
      />
      <div
        className="fixed top-0 right-0 h-full w-full max-w-[520px] bg-[hsl(var(--bg-elevated))] border-l border-[hsl(var(--border))] shadow-[var(--shadow-lg)] z-50 flex flex-col animate-slide-in-r"
        role="dialog"
        aria-label="设置"
      >
        <div className="flex items-center justify-between p-5 border-b border-[hsl(var(--border))]">
          <div>
            <div className="text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
              设置
            </div>
            <div className="text-[14px] font-semibold text-[hsl(var(--text-primary))] mt-1">
              初始化与调试
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="p-1.5 rounded-[var(--radius-sm)] text-[hsl(var(--text-tertiary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-muted))] transition-colors"
            aria-label="关闭"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-thin">
          <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
                  <Plug className="w-4 h-4 text-[hsl(var(--accent))]" />
                  环境初始化
                </div>
                <div className="text-[12px] text-[hsl(var(--text-secondary))] mt-2">
                  {!opencodeStatus.checked && 'Opencode：未检测'}
                  {opencodeStatus.checked && opencodeStatus.available && `Opencode：可用（${opencodeStatus.version || 'OK'}）`}
                  {opencodeStatus.checked && !opencodeStatus.available && 'Opencode：不可用'}
                </div>
                {opencodeStatus.checked && opencodeStatus.path && (
                  <div className="text-[11px] text-[hsl(var(--text-tertiary))] mt-1">{opencodeStatus.path}</div>
                )}
                {opencodeStatus.checked && opencodeStatus.error && (
                  <div className="text-[11px] text-[hsl(var(--danger))] mt-1">{opencodeStatus.error}</div>
                )}
              </div>

              <button
                type="button"
                className="h-9 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[12px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={checkOpencode}
                disabled={checkingOpencode}
              >
                {checkingOpencode ? '检测中…' : '检测 Opencode'}
              </button>
            </div>

            <div className="mt-4 pt-4 border-t border-[hsl(var(--border-subtle))] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12px] text-[hsl(var(--text-secondary))]">
                  Daemon：{daemonConnection.status === 'connected' ? '已连接' : daemonConnection.status === 'connecting' ? '连接中…' : '未连接'}
                </div>
                {daemonConnection.error && (
                  <div className="text-[11px] text-[hsl(var(--danger))] mt-1">{daemonConnection.error}</div>
                )}
              </div>

              <button
                type="button"
                className="h-9 px-3 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-app))] text-[12px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={checkDaemon}
                disabled={checkingDaemon}
              >
                {checkingDaemon ? '重连中…' : '重连'}
              </button>
            </div>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
                  <Wrench className="w-4 h-4 text-[hsl(var(--accent))]" />
                  调试开关
                </div>
                <div className="text-[12px] text-[hsl(var(--text-secondary))] mt-2">
                  Opencode 缺失时是否允许使用内置模拟执行器（不生成任何种子数据）。
                </div>
              </div>

              <button
                type="button"
                onClick={() => setEnableMockRunner(!enableMockRunner)}
                className={cn(
                  'h-9 px-3 rounded-[var(--radius-md)] border text-[12px] font-semibold transition-colors',
                  enableMockRunner
                    ? 'bg-[hsl(var(--accent-soft))] border-[hsl(var(--accent))] text-[hsl(var(--accent))]'
                    : 'bg-[hsl(var(--bg-app))] border-[hsl(var(--border))] text-[hsl(var(--text-secondary))]'
                )}
              >
                {enableMockRunner ? '已开启' : '已关闭'}
              </button>
            </div>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))] p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest uppercase text-[hsl(var(--text-tertiary))]">
                  <Database className="w-4 h-4 text-[hsl(var(--accent))]" />
                  数据管理
                </div>
                <div className="text-[12px] text-[hsl(var(--text-secondary))] mt-2">
                  清空本地持久化数据（会话/任务/聊天/时间线），并刷新页面。
                </div>
              </div>
              <button
                type="button"
                onClick={clearLocalData}
                className="h-9 px-3 rounded-[var(--radius-md)] bg-[hsl(var(--status-rejected))] text-white text-[12px] font-semibold hover:brightness-110"
              >
                一键清空
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]">
          <button
            type="button"
            onClick={() => {
              checkOpencode();
              checkDaemon();
            }}
            className="w-full h-10 rounded-[var(--radius-md)] bg-[hsl(var(--text-primary))] text-[hsl(var(--text-inverse))] text-[12px] font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90"
          >
            <RefreshCw className="w-4 h-4" />
            一键检测并重连
          </button>
        </div>
      </div>
    </>
  );
}

