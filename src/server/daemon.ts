import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type { Server as IOServer, Socket } from 'socket.io';
import { join } from 'path';

type TerminalStartPayload = {
  projectId?: string;
  taskId?: string;
  agentId: string;
  prompt: string;
  sessionId?: string;
  allowMockRunner?: boolean;
  opencodeBridgeUrl?: string;
};

export default function registerDaemon(io: IOServer) {
  const activeProcesses = new Map<string, { kill: () => void }>();

  io.on('connection', (socket: Socket) => {
    socket.on('terminal:start', async ({ projectId, taskId, agentId, prompt, sessionId, allowMockRunner, opencodeBridgeUrl }: TerminalStartPayload) => {
      if (activeProcesses.has(agentId)) {
        activeProcesses.get(agentId)?.kill();
      }

      const primaryCommand = 'opencode';
      const primaryArgs = ['run', prompt || '', '--format', 'json'];
      if (sessionId) primaryArgs.push('--session', sessionId);

      let sessionEmitted = false;

      const handleJsonLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          return;
        }

        if (!parsed || typeof parsed !== 'object') return;
        const obj = parsed as Record<string, unknown>;
        const part = (obj.part && typeof obj.part === 'object') ? (obj.part as Record<string, unknown>) : undefined;
        const parsedSessionId =
          (typeof obj.sessionID === 'string' ? obj.sessionID : undefined) ||
          (typeof obj.sessionId === 'string' ? obj.sessionId : undefined) ||
          (typeof part?.sessionID === 'string' ? part.sessionID : undefined) ||
          (typeof part?.sessionId === 'string' ? part.sessionId : undefined);

        if (!sessionEmitted && parsedSessionId) {
          sessionEmitted = true;
          socket.emit('agent:session', { projectId: projectId || 'default', agentId, sessionId: parsedSessionId });
        }

        const type = typeof obj.type === 'string' ? obj.type : undefined;

        if (type === 'text') {
          const text =
            (typeof part?.text === 'string' ? part.text : undefined) ||
            (typeof obj.content === 'string' ? obj.content : undefined);
          if (text) socket.emit('agent:event', { taskId, agentId, type: 'message', message: text });
        } else if (type === 'tool_use') {
          const toolName = typeof part?.tool === 'string' ? part.tool : undefined;
          socket.emit('agent:event', { taskId, agentId, type: 'message', message: `🔧 使用工具：${toolName}` });
        } else if (type === 'step_start') {
          socket.emit('agent:event', { taskId, agentId, type: 'step_start', message: `🚀 开始执行任务。` });
        } else if (type === 'step_finish') {
          socket.emit('agent:event', { taskId, agentId, type: 'message', message: `✅ 任务执行完成。` });
        } else if (type === 'error') {
          const errorObj = (obj.error && typeof obj.error === 'object') ? (obj.error as Record<string, unknown>) : undefined;
          const errorName = typeof errorObj?.name === 'string' ? errorObj.name : undefined;
          socket.emit('agent:event', { taskId, agentId, type: 'message', message: `❌ 错误：${errorName || '未知错误'}` });
        }
      };

      const wireChild = (child: ReturnType<typeof spawn>) => {
        if (child.stdout) {
          child.stdout.on('data', (data) => {
            const str = data.toString();
            socket.emit('terminal:data', { agentId, data: str.replace(/\n/g, '\r\n') });
          });

          const rl = createInterface({ input: child.stdout });
          rl.on('line', (line) => handleJsonLine(line));

          child.on('close', () => rl.close());
        }

        if (child.stderr) {
          child.stderr.on('data', (data) => {
            const str = data.toString();
            socket.emit('terminal:data', { agentId, data: str.replace(/\n/g, '\r\n') });
          });
        }

        child.on('close', (code) => {
          socket.emit('terminal:exit', { agentId, code });
          activeProcesses.delete(agentId);
        });
      };

      if (opencodeBridgeUrl) {
        const url = String(opencodeBridgeUrl).trim().replace(/\/+$/, '');
        const controller = new AbortController();
        activeProcesses.set(agentId, { kill: () => controller.abort() });

        socket.emit('terminal:data', {
          agentId,
          data: `\x1b[33m$ opencode-bridge ${url}\x1b[0m\r\n`,
        });

        try {
          const r = await fetch(`${url}/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ prompt: prompt || '', sessionId }),
            signal: controller.signal,
          });

          if (!r.ok || !r.body) {
            socket.emit('terminal:data', {
              agentId,
              data: `\r\n\x1b[31m[bridge error]\x1b[0m HTTP ${r.status}\r\n`,
            });
            socket.emit('terminal:exit', { agentId, code: 127 });
            activeProcesses.delete(agentId);
            return;
          }

          const decoder = new TextDecoder();
          const reader = r.body.getReader();
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const str = decoder.decode(value, { stream: true });
            socket.emit('terminal:data', { agentId, data: str.replace(/\n/g, '\r\n') });
            buffer += str;
            let idx = buffer.indexOf('\n');
            while (idx !== -1) {
              const line = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 1);
              handleJsonLine(line);
              idx = buffer.indexOf('\n');
            }
          }
          if (buffer.trim()) handleJsonLine(buffer);

          socket.emit('terminal:exit', { agentId, code: 0 });
          activeProcesses.delete(agentId);
          return;
        } catch (e) {
          socket.emit('terminal:data', {
            agentId,
            data: `\r\n\x1b[31m[bridge error]\x1b[0m ${String((e as any)?.message || e)}\r\n`,
          });
          socket.emit('terminal:exit', { agentId, code: 127 });
          activeProcesses.delete(agentId);
          return;
        }
      }

      socket.emit('terminal:data', {
        agentId,
        data: `\x1b[33m$ ${primaryCommand} ${primaryArgs.join(' ')}\x1b[0m\r\n`,
      });

      const child = spawn(primaryCommand, primaryArgs);
      activeProcesses.set(agentId, { kill: () => child.kill() });

      child.on('error', (err) => {
        const code = (err as unknown as { code?: string }).code;
        if (code === 'ENOENT') {
          if (!allowMockRunner && process.env.ENABLE_MOCK_RUNNER !== '1') {
            socket.emit('terminal:data', {
              agentId,
              data: `\r\n\x1b[31m[未找到 opencode]\x1b[0m 如需使用内置模拟执行器，请设置 ENABLE_MOCK_RUNNER=1。\r\n`,
            });
            socket.emit('terminal:exit', { agentId, code: 127 });
            activeProcesses.delete(agentId);
            return;
          }

          const fallbackCommand = process.execPath;
          const fallbackScript = join(process.cwd(), 'backend', 'mock-opencode.js');
          const fallbackArgs = [fallbackScript];

          socket.emit('terminal:data', {
            agentId,
            data: `\r\n\x1b[33m[未找到 opencode]\x1b[0m 已切换到内置模拟执行器。\r\n`,
          });
          socket.emit('terminal:data', {
            agentId,
            data: `\x1b[33m$ ${fallbackCommand} ${fallbackArgs.join(' ')}\x1b[0m\r\n`,
          });

          const fallback = spawn(fallbackCommand, fallbackArgs, { env: { ...process.env, OPENCODE_PROMPT: prompt } });
          activeProcesses.set(agentId, { kill: () => fallback.kill() });
          wireChild(fallback);
          return;
        }

        socket.emit('terminal:data', {
          agentId,
          data: `\r\n\x1b[31m[spawn error]\x1b[0m ${String((err as unknown as { message?: string }).message || err)}\r\n`,
        });
        socket.emit('terminal:exit', { agentId, code: 127 });
        activeProcesses.delete(agentId);
      });

      wireChild(child);
    });
  });
}
