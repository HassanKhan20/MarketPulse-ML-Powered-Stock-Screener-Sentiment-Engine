// Wires SQL, the model, the market engine, REST and WebSockets into one HTTP server.
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { openDatabase } from './db.js';
import { NewsModel } from './model.js';
import { MarketEngine } from './market.js';
import { createApi } from './api.js';

const CLIENT_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

export function createServer({ dbPath, simulate = true, engineOptions = {} } = {}) {
  const db = openDatabase(dbPath);
  const model = NewsModel.load();
  const engine = new MarketEngine({ db, model, ...engineOptions }).init();

  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use('/api', createApi({ db, model, engine }));
  if (existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST));
    app.get('*', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const broadcast = (type, data) => {
    const msg = JSON.stringify({ type, data });
    for (const client of wss.clients) if (client.readyState === client.OPEN) client.send(msg);
  };

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => ws.terminate());
    ws.send(JSON.stringify({ type: 'hello', data: { model: model.meta.version, serverTime: Date.now() } }));
  });

  // Drop clients that stop answering pings (closed laptop lids, dead proxies).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);

  engine.on('ticks', (data) => broadcast('ticks', data));
  engine.on('news', (data) => broadcast('news', data));
  engine.on('sentiment', (data) => broadcast('sentiment', data));
  if (simulate) engine.start();

  const close = () => new Promise((resolve) => {
    engine.stop();
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    server.close(() => { db.close(); resolve(); });
  });

  return { app, server, wss, db, model, engine, close };
}
