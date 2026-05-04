import type { NextApiRequest } from 'next';
import type { NextApiResponse } from 'next';
import { Server as IOServer } from 'socket.io';
import registerDaemon from '@/server/daemon';

type NextApiResponseWithSocket = NextApiResponse & {
  socket: NextApiResponse['socket'] & {
    server: {
      io?: IOServer;
    };
  } & Record<string, any>;
};

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponseWithSocket) {
  if (!res.socket.server.io) {
    const io = new IOServer(res.socket.server as any, { path: '/api/socketio', cors: { origin: '*' } });
    res.socket.server.io = io;

    // Re-register daemon handlers on each new IO server instance.
    // Also clear stale handlers on existing sockets when they reconnect.
    registerDaemon(io);

    io.on('connection', (socket) => {
      // Health-check: client can ping to verify daemon is active
      socket.on('daemon:ping', (cb) => cb?.({ ok: true }));
    });
  }

  res.end();
}
