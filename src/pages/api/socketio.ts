import type { NextApiRequest } from 'next';
import type { NextApiResponse } from 'next';
import { Server as IOServer } from 'socket.io';
import registerDaemon from '@/server/daemon';

type NextApiResponseWithSocket = NextApiResponse & {
  socket: NextApiResponse['socket'] & {
    server: NextApiResponse['socket']['server'] & {
      io?: IOServer;
    };
  };
};

export const config = {
  api: {
    bodyParser: false,
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponseWithSocket) {
  if (!res.socket.server.io) {
    const io = new IOServer(res.socket.server, { path: '/api/socketio', cors: { origin: '*' } });
    res.socket.server.io = io;
    registerDaemon(io);
  }

  res.end();
}
