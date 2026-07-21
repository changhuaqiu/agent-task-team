import type { Server as HTTPServer } from 'node:http';
import type { NextApiResponse } from 'next';
import { Server as IOServer } from 'socket.io';
import registerDaemon from './daemon';

type SocketRuntimeHost = HTTPServer & {
  io?: IOServer;
};

export interface SocketRuntime {
  io: IOServer;
  created: boolean;
}

function responseServer(res: NextApiResponse): SocketRuntimeHost | undefined {
  return (res.socket as typeof res.socket & { server?: SocketRuntimeHost } | null)
    ?.server;
}

export function ensureProjectSocketRuntime(
  res: NextApiResponse,
): SocketRuntime | undefined {
  const server = responseServer(res);
  if (!server) return undefined;
  if (server.io) return { io: server.io, created: false };

  const io = new IOServer(server, {
    path: '/api/socketio',
    cors: { origin: '*' },
  });
  server.io = io;
  registerDaemon(io);
  io.on('connection', (socket) => {
    socket.on('daemon:ping', (callback) => callback?.({ ok: true }));
  });
  return { io, created: true };
}
