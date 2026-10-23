import { createServer } from './app.js';

const PORT = Number(process.env.PORT ?? 4000);
const { server, model, close } = createServer();

server.listen(PORT, () => {
  console.log(`MarketPulse API on http://localhost:${PORT}  (REST /api, WebSocket /ws)`);
  console.log(`model ${model.meta.name}@${model.meta.version}, vocabulary ${model.meta.vocabularySize}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await close();
    process.exit(0);
  });
}
