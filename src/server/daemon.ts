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
};

export default function registerDaemon(io: IOServer) {
  const activeProcesses = new Map<string, ReturnType<typeof spawn>>();

  io.on('connection', (socket: Socket) => {
    socket.on('terminal:start', ({ projectId, taskId, agentId, prompt, sessionId }: TerminalStartPayload) => {
      if (activeProcesses.has(agentId)) {
        activeProcesses.get(agentId)?.kill();
      }

      const primaryCommand = 'opencode';
      const primaryArgs = ['run', prompt || '', '--format', 'json'];
      if (sessionId) primaryArgs.push('--session', sessionId);

      let sessionEmitted = false;

      const wireChild = (child: ReturnType<typeof spawn>) => {
        if (child.stdout) {
          child.stdout.on('data', (data) => {
            const str = data.toString();
            socket.emit('terminal:data', { agentId, data: str.replace(/\n/g, '\r\n') });
          });

          const rl = createInterface({ input: child.stdout });
          rl.on('line', (line) => {
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
              socket.emit('agent:event', { taskId, agentId, type: 'message', message: `🔧 Used tool: ${toolName}` });
            } else if (type === 'step_start') {
              socket.emit('agent:event', { taskId, agentId, type: 'step_start', message: `🚀 Started task execution.` });
            } else if (type === 'step_finish') {
              socket.emit('agent:event', { taskId, agentId, type: 'message', message: `✅ Finished task execution.` });
            } else if (type === 'error') {
              const errorObj = (obj.error && typeof obj.error === 'object') ? (obj.error as Record<string, unknown>) : undefined;
              const errorName = typeof errorObj?.name === 'string' ? errorObj.name : undefined;
              socket.emit('agent:event', { taskId, agentId, type: 'message', message: `❌ Error: ${errorName || 'Unknown Error'}` });
            }
          });

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

      socket.emit('terminal:data', {
        agentId,
        data: `\x1b[33m$ ${primaryCommand} ${primaryArgs.join(' ')}\x1b[0m\r\n`,
      });

      const child = spawn(primaryCommand, primaryArgs);
      activeProcesses.set(agentId, child);

      child.on('error', (err) => {
        const code = (err as unknown as { code?: string }).code;
        if (code === 'ENOENT') {
          if (process.env.ENABLE_MOCK_RUNNER !== '1') {
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
          activeProcesses.set(agentId, fallback);
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
