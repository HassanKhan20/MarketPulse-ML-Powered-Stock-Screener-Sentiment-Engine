// REST API. Every screener filter maps to a parameterised SQL predicate; sort keys
// are whitelisted so no user input is ever interpolated into SQL.
import express from 'express';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SORTABLE = {
  symbol: 'symbol',
  name: 'name',
  sector: 'sector',
  price: 'price',
  change: 'change_pct',
  volume: 'volume',
  relVolume: 'rel_volume',
  marketCap: 'market_cap',
  pe: 'pe',
  dividend: 'dividend_yield',
  beta: 'beta',
  sentiment: 'sentiment',
  risk: 'risk_score',
};

const STOCK_COLUMNS = `
  symbol, name, sector, industry, market_cap, pe, dividend_yield, beta, price, prev_close, day_open,
  day_high, day_low, volume, avg_volume, sentiment, risk_score, top_risk, news_count, updated_at,
  ROUND((price - prev_close) / prev_close * 100, 2) AS change_pct,
  ROUND(CAST(volume AS REAL) / avg_volume, 2) AS rel_volume`;

function num(query, key, { min = -Infinity, max = Infinity } = {}) {
  const raw = query[key];
  if (raw === undefined || raw === '') return undefined;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < min || v > max) {
    throw new HttpError(400, `"${key}" must be a number between ${min} and ${max}`);
  }
  return v;
}

const list = (raw) => (raw ? String(raw).split(',').map((s) => s.trim()).filter(Boolean) : []);
const bool = (raw) => raw === 'true' || raw === '1';

export function stockFromRow(r) {
  return {
    symbol: r.symbol,
    name: r.name,
    sector: r.sector,
    industry: r.industry,
    price: r.price,
    prevClose: r.prev_close,
    open: r.day_open,
    dayHigh: r.day_high,
    dayLow: r.day_low,
    changePct: r.change_pct,
    volume: r.volume,
    avgVolume: r.avg_volume,
    relVolume: r.rel_volume,
    marketCap: r.market_cap,
    pe: r.pe,
    dividendYield: r.dividend_yield,
    beta: r.beta,
    sentiment: r.sentiment,
    riskScore: r.risk_score,
    topRisk: r.top_risk,
    newsCount: r.news_count,
    updatedAt: r.updated_at,
  };
}

export function newsFromRow(r) {
  const probs = JSON.parse(r.probabilities);
  return {
    id: r.id,
    symbol: r.symbol,
    name: r.name,
    headline: r.headline,
    source: r.source,
    publishedAt: r.published_at,
    sentiment: {
      label: r.sentiment_label,
      score: r.sentiment_score,
      confidence: r.confidence,
      probabilities: probs.sentiment,
    },
    risk: { type: r.risk_type, score: r.risk_score, probabilities: probs.risk },
    modelVersion: r.model_version,
  };
}

/** Build the WHERE clause for the screener from query-string filters. */
export function buildScreenerQuery(query) {
  const where = [];
  const params = [];
  const add = (sql, ...values) => { where.push(sql); params.push(...values); };

  const q = query.q ? String(query.q).trim() : '';
  if (q) add('(symbol LIKE ? OR name LIKE ? OR industry LIKE ?)', `%${q}%`, `%${q}%`, `%${q}%`);

  const sectors = list(query.sector);
  if (sectors.length) add(`sector IN (${sectors.map(() => '?').join(',')})`, ...sectors);

  const range = (key, column, opts) => {
    const lo = num(query, `min${key}`, opts);
    const hi = num(query, `max${key}`, opts);
    if (lo !== undefined && hi !== undefined && lo > hi) {
      throw new HttpError(400, `"min${key}" cannot exceed "max${key}"`);
    }
    if (lo !== undefined) add(`${column} >= ?`, lo);
    if (hi !== undefined) add(`${column} <= ?`, hi);
  };
  range('Price', 'price', { min: 0 });
  range('Cap', 'market_cap', { min: 0 });
  range('Pe', 'pe', { min: 0 });
  range('Change', '((price - prev_close) / prev_close * 100)', { min: -100, max: 1000 });
  range('Sentiment', 'sentiment', { min: -1, max: 1 });
  range('Risk', 'risk_score', { min: 0, max: 1 });
  range('Dividend', 'dividend_yield', { min: 0, max: 100 });
  range('Beta', 'beta', { min: 0, max: 10 });
  range('RelVolume', '(CAST(volume AS REAL) / avg_volume)', { min: 0 });

  if (bool(query.profitable)) add('pe IS NOT NULL');
  const riskTypes = list(query.riskType);
  if (riskTypes.length) add(`top_risk IN (${riskTypes.map(() => '?').join(',')})`, ...riskTypes);

  const sortKey = query.sort ?? 'marketCap';
  const column = SORTABLE[sortKey];
  if (!column) throw new HttpError(400, `"sort" must be one of: ${Object.keys(SORTABLE).join(', ')}`);
  const order = String(query.order ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const limit = num(query, 'limit', { min: 1, max: 500 }) ?? 100;
  const offset = num(query, 'offset', { min: 0 }) ?? 0;

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return {
    sql: `SELECT ${STOCK_COLUMNS} FROM stocks ${whereSql}
          ORDER BY ${column} IS NULL, ${column} ${order}, symbol ASC LIMIT ? OFFSET ?`,
    countSql: `SELECT COUNT(*) AS n FROM stocks ${whereSql}`,
    params,
    limit,
    offset,
  };
}

export function createApi({ db, model, engine }) {
  const router = express.Router();
  // Parsed inside the router so malformed JSON reaches this router's error handler.
  router.use(express.json({ limit: '64kb' }));
  const stmt = {
    stock: db.prepare(`SELECT ${STOCK_COLUMNS} FROM stocks WHERE symbol = ?`),
    history: db.prepare(`SELECT ts, price FROM (SELECT ts, price FROM price_history WHERE symbol = ?
                         ORDER BY ts DESC LIMIT ?) ORDER BY ts ASC`),
    sectors: db.prepare(`SELECT sector, COUNT(*) AS count,
                           ROUND(AVG((price - prev_close) / prev_close * 100), 2) AS avg_change,
                           ROUND(AVG(sentiment), 4) AS avg_sentiment,
                           ROUND(MAX(risk_score), 4) AS max_risk,
                           ROUND(SUM(market_cap), 1) AS market_cap
                         FROM stocks GROUP BY sector ORDER BY market_cap DESC`),
    summary: db.prepare(`SELECT COUNT(*) AS total,
                           SUM(price > prev_close) AS advancers,
                           SUM(price < prev_close) AS decliners,
                           ROUND(AVG(sentiment), 4) AS avg_sentiment,
                           ROUND(AVG((price - prev_close) / prev_close * 100), 2) AS avg_change,
                           SUM(risk_score >= ?) AS at_risk
                         FROM stocks`),
    newsLastHour: db.prepare(`SELECT COUNT(*) AS news, SUM(risk_score >= ? AND sentiment_label = 'negative') AS alerts
                              FROM news WHERE published_at > ?`),
    logPrediction: db.prepare(`INSERT INTO prediction_log (text, sentiment_label, risk_type, created_at)
                               VALUES (?, ?, ?, ?)`),
  };
  const ALERT_THRESHOLD = 0.6;

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', model: model.meta.version, time: Date.now() });
  });

  router.get('/stocks', (req, res) => {
    const { sql, countSql, params, limit, offset } = buildScreenerQuery(req.query);
    const rows = db.prepare(sql).all(...params, limit, offset);
    const { n } = db.prepare(countSql).get(...params);
    res.json({ total: n, count: rows.length, limit, offset, items: rows.map(stockFromRow) });
  });

  router.get('/stocks/:symbol', (req, res) => {
    const row = stmt.stock.get(req.params.symbol.toUpperCase());
    if (!row) throw new HttpError(404, `unknown symbol ${req.params.symbol}`);
    const news = db.prepare(`SELECT n.*, s.name FROM news n JOIN stocks s USING (symbol)
                             WHERE n.symbol = ? ORDER BY published_at DESC LIMIT 25`).all(row.symbol);
    res.json({
      ...stockFromRow(row),
      history: stmt.history.all(row.symbol, 720),
      news: news.map(newsFromRow),
    });
  });

  router.get('/stocks/:symbol/history', (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    if (!stmt.stock.get(symbol)) throw new HttpError(404, `unknown symbol ${req.params.symbol}`);
    const limit = num(req.query, 'limit', { min: 1, max: 5000 }) ?? 360;
    res.json({ symbol, points: stmt.history.all(symbol, limit) });
  });

  router.get('/sparklines', (req, res) => {
    // Downsampled recent price paths for every listed symbol, keyed by symbol.
    const minutes = num(req.query, 'minutes', { min: 1, max: 180 }) ?? 30;
    const points = num(req.query, 'points', { min: 2, max: 500 }) ?? 60;
    const rows = db.prepare('SELECT symbol, price FROM price_history WHERE ts > ? ORDER BY symbol, ts')
      .all(Date.now() - minutes * 60_000);
    const bySymbol = {};
    for (const r of rows) (bySymbol[r.symbol] ??= []).push(r.price);
    for (const [symbol, prices] of Object.entries(bySymbol)) {
      if (prices.length <= points) continue;
      const step = (prices.length - 1) / (points - 1);
      bySymbol[symbol] = Array.from({ length: points }, (_, i) => prices[Math.round(i * step)]);
    }
    res.json(bySymbol);
  });

  router.get('/sectors', (_req, res) => {
    res.json(stmt.sectors.all().map((r) => ({
      sector: r.sector,
      count: r.count,
      avgChange: r.avg_change,
      avgSentiment: r.avg_sentiment,
      maxRisk: r.max_risk,
      marketCap: r.market_cap,
    })));
  });

  router.get('/market/summary', (_req, res) => {
    const s = stmt.summary.get(ALERT_THRESHOLD);
    const n = stmt.newsLastHour.get(ALERT_THRESHOLD, Date.now() - 3_600_000);
    res.json({
      total: s.total,
      advancers: s.advancers,
      decliners: s.decliners,
      avgSentiment: s.avg_sentiment,
      avgChange: s.avg_change,
      atRisk: s.at_risk,
      newsLastHour: n.news,
      alertsLastHour: n.alerts ?? 0,
    });
  });

  router.get('/news', (req, res) => {
    const where = [];
    const params = [];
    const symbols = list(req.query.symbol).map((s) => s.toUpperCase());
    if (symbols.length) { where.push(`n.symbol IN (${symbols.map(() => '?').join(',')})`); params.push(...symbols); }
    const sentiments = list(req.query.sentiment);
    if (sentiments.length) { where.push(`sentiment_label IN (${sentiments.map(() => '?').join(',')})`); params.push(...sentiments); }
    const riskTypes = list(req.query.riskType);
    if (riskTypes.length) { where.push(`risk_type IN (${riskTypes.map(() => '?').join(',')})`); params.push(...riskTypes); }
    const minRisk = num(req.query, 'minRisk', { min: 0, max: 1 });
    if (minRisk !== undefined) { where.push('n.risk_score >= ?'); params.push(minRisk); }
    const before = num(req.query, 'before', { min: 0 });
    if (before !== undefined) { where.push('published_at < ?'); params.push(before); }
    const limit = num(req.query, 'limit', { min: 1, max: 200 }) ?? 50;
    const rows = db.prepare(`SELECT n.*, s.name FROM news n JOIN stocks s USING (symbol)
                             ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                             ORDER BY published_at DESC LIMIT ?`).all(...params, limit);
    res.json(rows.map(newsFromRow));
  });

  router.get('/alerts', (req, res) => {
    const minRisk = num(req.query, 'minRisk', { min: 0, max: 1 }) ?? ALERT_THRESHOLD;
    const limit = num(req.query, 'limit', { min: 1, max: 100 }) ?? 20;
    const rows = db.prepare(`SELECT n.*, s.name FROM news n JOIN stocks s USING (symbol)
                             WHERE n.risk_score >= ? AND n.sentiment_label = 'negative'
                             ORDER BY published_at DESC LIMIT ?`).all(minRisk, limit);
    res.json(rows.map(newsFromRow));
  });

  router.post('/predict', (req, res) => {
    const body = req.body ?? {};
    const texts = Array.isArray(body.texts) ? body.texts : body.text !== undefined ? [body.text] : null;
    if (!texts || texts.length === 0) throw new HttpError(400, 'provide "text" (string) or "texts" (array of strings)');
    if (texts.length > 50) throw new HttpError(400, 'at most 50 texts per request');
    for (const t of texts) {
      if (typeof t !== 'string' || !t.trim()) throw new HttpError(400, 'every text must be a non-empty string');
      if (t.length > 1000) throw new HttpError(400, 'texts are limited to 1000 characters');
    }
    const now = Date.now();
    const predictions = texts.map((t) => {
      const p = model.predict(t.trim());
      stmt.logPrediction.run(p.text, p.sentiment.label, p.risk.type, now);
      return p;
    });
    res.json({ model: model.meta.version, predictions });
  });

  router.post('/news', (req, res) => {
    // Ingest an external headline: classify, store, move the stock, broadcast.
    const { symbol, headline, source = 'API' } = req.body ?? {};
    if (typeof symbol !== 'string' || typeof headline !== 'string' || !headline.trim()) {
      throw new HttpError(400, 'provide "symbol" and "headline" strings');
    }
    if (headline.length > 300) throw new HttpError(400, 'headline is limited to 300 characters');
    if (!stmt.stock.get(symbol.toUpperCase())) throw new HttpError(404, `unknown symbol ${symbol}`);
    res.status(201).json(engine.ingestNews(symbol.toUpperCase(), headline.trim(), String(source).slice(0, 40)));
  });

  router.get('/model', (_req, res) => res.json(model.meta));

  router.use((_req, _res, next) => next(new HttpError(404, 'not found')));
  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, _next) => {
    const status = err.status ?? (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'internal server error' : err.message });
  });
  return router;
}
