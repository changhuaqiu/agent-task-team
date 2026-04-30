/* eslint-disable */
const next = require('next');
const { createServer } = require('http');
const { Server } = require('socket.io');
const registerDaemon = require('./backend/daemon');

const dev = true;
const port = Number(process.env.PORT || 3000);

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));

  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  registerDaemon(io);

  httpServer.listen(port, () => {
    console.log(`Dev server listening on http://localhost:${port}`);
  });
});

