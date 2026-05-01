/* eslint-disable */
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const registerDaemon = require('./daemon');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

registerDaemon(io);

httpServer.listen(4000, () => {
  console.log('Agent Daemon listening on port 4000');
});
