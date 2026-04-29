'use client';
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useTaskHubStore } from '@/store/taskHubStore';
import '@xterm/xterm/css/xterm.css';

export function TerminalView({ taskId }: { taskId: string }) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  
  const logs = useTaskHubStore((s) => s.terminalLogs[taskId] || []);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#111111',
        foreground: '#D3BC8E',
        cursor: '#D3BC8E',
      },
      fontFamily: 'var(--font-geist-mono), monospace',
      fontSize: 12,
      cursorBlink: true,
      cursorStyle: 'block',
    });
    
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalRef.current);
    fit.fit();

    termInstance.current = term;
    fitAddon.current = fit;

    const handleResize = () => fit.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  // Write new logs
  useEffect(() => {
    if (termInstance.current && logs.length > 0) {
      // Clear and rewrite to simplify sync for mock (or track last written index)
      termInstance.current.clear();
      logs.forEach(log => termInstance.current?.write(log));
    }
  }, [logs]);

  return (
    <div className="w-full h-full p-2 bg-[#111111] border-t-2 border-[hsl(var(--border))]">
      <div ref={terminalRef} className="w-full h-full" />
    </div>
  );
}