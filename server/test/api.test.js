import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createServer } from '../src/app.js';

let ctx;
let base;

before(async () => {
  ctx = createServer({ dbPath: ':memory:', simulate: false });
  await new Promise((resolve) => ctx.server.listen(0, resolve));
  base = `http://localhost:${ctx.server.address().port}`;
});
after(() => ctx.close());

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
};
const post = async (path, body) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('lists the seeded universe with live fields and ML scores', async () => {
  const { status, body } = await get('/api/stocks');
  assert.equal(status, 200);
  assert.equal(body.total, 36);
  const s = body.items[0];
  for (const k of ['symbol', 'price', 'changePct', 'marketCap', 'sentiment', 'riskScore']) assert.ok(k in s, k);
  // default sort: market cap desc
  assert.ok(body.items[0].marketCap >= body.items[1].marketCap);
});

test('filters combine as SQL predicates', async () => {
  const { body } = await get('/api/stocks?sector=Technology,Healthcare&minPrice=50&maxPe=40&sort=price&order=asc');
  assert.ok(body.items.length > 0);
  for (const s of body.items) {
    assert.ok(['Technology', 'Healthcare'].includes(s.sector));
    assert.ok(s.price >= 50);
    assert.ok(s.pe !== null && s.pe <= 40);
  }
  const prices = body.items.map((s) => s.price);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
});

test('sentiment range filter and text search', async () => {
  const { body } = await get('/api/stocks?minSentiment=-1&maxSentiment=0');
  for (const s of body.items) assert.ok(s.sentiment <= 0);
  const search = await get('/api/stocks?q=solaris');
  assert.deepEqual(search.body.items.map((s) => s.symbol), ['SOLS']);
});

test('rejects bad filter input', async () => {
  assert.equal((await get('/api/stocks?minPrice=abc')).status, 400);
  assert.equal((await get('/api/stocks?minPrice=10&maxPrice=5')).status, 400);
  assert.equal((await get('/api/stocks?sort=price;DROP TABLE stocks')).status, 400);
  assert.equal((await get('/api/stocks/NOPE')).status, 404);
});

test('stock detail includes history and classified news', async () => {
  const { body } = await get('/api/stocks/sols');
  assert.equal(body.symbol, 'SOLS');
  assert.ok(body.history.length > 100);
  assert.ok(Array.isArray(body.news));
});

test('sparklines are downsampled per symbol', async () => {
  const { body } = await get('/api/sparklines?minutes=60&points=20');
  assert.equal(Object.keys(body).length, 36);
  assert.equal(body.SOLS.length, 20);
});

test('predict endpoint returns sentiment and risk', async () => {
  const { status, body } = await post('/api/predict', { text: 'Regulators fine the bank $2 billion for compliance violations' });
  assert.equal(status, 200);
  const [p] = body.predictions;
  assert.equal(p.sentiment.label, 'negative');
  assert.equal(p.risk.type, 'regulatory');
  const batch = await post('/api/predict', { texts: ['Apex beats estimates', 'Apex misses estimates'] });
  assert.equal(batch.body.predictions.length, 2);
  assert.equal((await post('/api/predict', {})).status, 400);
  assert.equal((await post('/api/predict', '{bad json')).status, 400);
});

test('ingested news is classified, stored and broadcast over WebSocket', async () => {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
  const messages = [];
  await new Promise((resolve) => ws.on('open', resolve));
  ws.on('message', (m) => messages.push(JSON.parse(m)));

  const { status, body } = await post('/api/news', {
    symbol: 'BLRV', headline: 'BlueRiver Bank discloses data breach exposing millions of customers',
  });
  assert.equal(status, 201);
  assert.equal(body.risk.type, 'cyber');

  ctx.engine.tick();
  await new Promise((r) => setTimeout(r, 100));
  ws.close();
  const types = messages.map((m) => m.type);
  assert.ok(types.includes('news') && types.includes('sentiment') && types.includes('ticks'), types.join());

  const alerts = await get('/api/alerts?minRisk=0.5');
  assert.ok(alerts.body.some((a) => a.id === body.id));
  const sectors = await get('/api/sectors');
  assert.ok(sectors.body.length >= 8);
  const summary = await get('/api/market/summary');
  assert.equal(summary.body.total, 36);
});
