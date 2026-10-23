// Market engine: simulates live prices, runs incoming news through the classifier,
// persists everything to SQL and emits events that the WebSocket layer broadcasts.
//
// Prices follow geometric Brownian motion whose drift leans on each stock's news
// sentiment, and every classified headline applies an immediate price shock, so
// what the model reads visibly moves the tape.
import { EventEmitter } from 'node:events';
import { transaction } from './db.js';
import { UNIVERSE } from './universe.js';
import { generateHeadline } from './newsgen.js';

const SENTIMENT_HALF_LIFE_MS = 45 * 60_000;
const SENTIMENT_WINDOW_MS = 6 * 3_600_000;
const HISTORY_EVERY_MS = 5_000;
const HISTORY_RETAIN_MS = 3 * 3_600_000;
const PRIOR_WEIGHT = 0.6; // shrinks aggregates toward 0 when a stock has little news

const gaussian = () => {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const round2 = (v) => Math.round(v * 100) / 100;

export class MarketEngine extends EventEmitter {
  constructor({ db, model, tickMs = 1000, newsMinMs = 3500, newsMaxMs = 8000 }) {
    super();
    this.db = db;
    this.model = model;
    this.tickMs = tickMs;
    this.newsMinMs = newsMinMs;
    this.newsMaxMs = newsMaxMs;
    this.lastHistoryAt = 0;
    this.timers = [];

    this.stmt = {
      allStocks: db.prepare('SELECT * FROM stocks'),
      updatePrice: db.prepare(`UPDATE stocks SET price = ?, day_high = ?, day_low = ?, volume = ?, updated_at = ?
                               WHERE symbol = ?`),
      insertHistory: db.prepare('INSERT INTO price_history (symbol, ts, price) VALUES (?, ?, ?)'),
      pruneHistory: db.prepare('DELETE FROM price_history WHERE ts < ?'),
      insertNews: db.prepare(`INSERT INTO news (symbol, headline, source, published_at, sentiment_label,
                                sentiment_score, confidence, risk_type, risk_score, probabilities, model_version)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      recentNews: db.prepare(`SELECT published_at, sentiment_score, risk_type, risk_score FROM news
                              WHERE symbol = ? AND published_at > ? ORDER BY published_at DESC LIMIT 60`),
      updateSentiment: db.prepare(`UPDATE stocks SET sentiment = ?, risk_score = ?, top_risk = ?, news_count = ?
                                   WHERE symbol = ?`),
    };
    this.stocks = new Map();
  }

  /** Load the universe from SQL, seeding prices, history and a news backlog on first run. */
  init() {
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM stocks').get().n;
    if (count === 0) this.seed();
    for (const row of this.stmt.allStocks.all()) this.stocks.set(row.symbol, row);
    return this;
  }

  seed(now = Date.now()) {
    const insert = this.db.prepare(`INSERT INTO stocks (symbol, name, sector, industry, market_cap, pe,
        dividend_yield, beta, price, prev_close, day_open, day_high, day_low, volume, avg_volume, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const HISTORY_POINTS = 360;
    const HISTORY_STEP_MS = 10_000;

    transaction(this.db, () => {
      for (const s of UNIVERSE) {
        const prevClose = s.price;
        let price = prevClose * (1 + gaussian() * 0.006);
        const open = price;
        let high = price;
        let low = price;
        const sigma = 0.0012 * s.beta;
        const path = [];
        for (let i = HISTORY_POINTS; i > 0; i--) {
          price *= Math.exp(sigma * gaussian());
          high = Math.max(high, price);
          low = Math.min(low, price);
          path.push([now - i * HISTORY_STEP_MS, round2(price)]);
        }
        const volume = Math.round(s.avgVolume * (0.35 + Math.random() * 0.4));
        insert.run(s.symbol, s.name, s.sector, s.industry, s.marketCap, s.pe, s.dividendYield, s.beta,
          round2(price), prevClose, round2(open), round2(high), round2(low), volume, s.avgVolume, now);
        for (const [ts, p] of path) this.stmt.insertHistory.run(s.symbol, ts, p);
      }
    });

    // Backfill three hours of classified news so sentiment scores exist on first load.
    const stocks = this.db.prepare('SELECT * FROM stocks').all();
    transaction(this.db, () => {
      for (let i = 0; i < 140; i++) {
        const stock = stocks[Math.floor(Math.random() * stocks.length)];
        const { headline, source } = generateHeadline({ ...stock, sentiment: 0 });
        this.classifyAndStore(stock.symbol, headline, source, now - Math.floor(Math.random() * 3 * 3_600_000));
      }
      for (const s of stocks) this.refreshSentiment(s.symbol, now);
    });
  }

  start() {
    this.timers.push(setInterval(() => this.tick(), this.tickMs));
    const scheduleNews = () => {
      const delay = this.newsMinMs + Math.random() * (this.newsMaxMs - this.newsMinMs);
      this.timers.push(setTimeout(() => { this.publishRandomNews(); scheduleNews(); }, delay));
    };
    scheduleNews();
    return this;
  }

  stop() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  tick(now = Date.now()) {
    const writeHistory = now - this.lastHistoryAt >= HISTORY_EVERY_MS;
    const ticks = [];
    transaction(this.db, () => {
      for (const s of this.stocks.values()) {
        const drift = 0.00004 * s.sentiment - 0.00002 * s.risk_score;
        const sigma = 0.0011 * s.beta;
        s.price = round2(Math.max(0.5, s.price * Math.exp(drift + sigma * gaussian())));
        s.day_high = Math.max(s.day_high, s.price);
        s.day_low = Math.min(s.day_low, s.price);
        s.volume += Math.round((s.avg_volume / 23_400) * Math.random() * 2 * (1 + Math.abs(s.sentiment)));
        s.updated_at = now;
        this.stmt.updatePrice.run(s.price, s.day_high, s.day_low, s.volume, now, s.symbol);
        if (writeHistory) this.stmt.insertHistory.run(s.symbol, now, s.price);
        ticks.push(toTick(s));
      }
      if (writeHistory) {
        this.lastHistoryAt = now;
        this.stmt.pruneHistory.run(now - HISTORY_RETAIN_MS);
      }
    });
    this.emit('ticks', { ts: now, history: writeHistory, data: ticks });
  }

  publishRandomNews() {
    const all = [...this.stocks.values()];
    // Higher-beta names make the news more often.
    const weights = all.map((s) => s.beta);
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    const stock = all.find((_, i) => (r -= weights[i]) <= 0) ?? all[0];
    const { headline, source } = generateHeadline(stock);
    return this.ingestNews(stock.symbol, headline, source);
  }

  /** Classify a headline, persist it, update aggregates, shock the price and notify listeners. */
  ingestNews(symbol, headline, source, now = Date.now()) {
    const stock = this.stocks.get(symbol);
    if (!stock) throw new Error(`unknown symbol ${symbol}`);
    const item = transaction(this.db, () => {
      const stored = this.classifyAndStore(symbol, headline, source, now);
      this.refreshSentiment(symbol, now);
      return stored;
    });

    const shock = item.sentiment.score * (0.004 + Math.random() * 0.012) * stock.beta;
    stock.price = round2(stock.price * (1 + shock));
    stock.day_high = Math.max(stock.day_high, stock.price);
    stock.day_low = Math.min(stock.day_low, stock.price);

    this.emit('news', item);
    this.emit('sentiment', {
      symbol,
      sentiment: stock.sentiment,
      riskScore: stock.risk_score,
      topRisk: stock.top_risk,
      newsCount: stock.news_count,
    });
    return item;
  }

  classifyAndStore(symbol, headline, source, publishedAt) {
    const p = this.model.predict(headline);
    const probabilities = { sentiment: p.sentiment.probabilities, risk: p.risk.probabilities };
    const { lastInsertRowid } = this.stmt.insertNews.run(symbol, headline, source, publishedAt,
      p.sentiment.label, p.sentiment.score, p.sentiment.confidence, p.risk.type, p.risk.score,
      JSON.stringify(probabilities), this.model.meta.version);
    const stock = this.stocks.get(symbol);
    return {
      id: Number(lastInsertRowid),
      symbol,
      name: stock?.name,
      headline,
      source,
      publishedAt,
      sentiment: p.sentiment,
      risk: p.risk,
      modelVersion: this.model.meta.version,
    };
  }

  /** Time-decayed, prior-shrunk aggregate of recent news for one symbol. */
  refreshSentiment(symbol, now = Date.now()) {
    const rows = this.stmt.recentNews.all(symbol, now - SENTIMENT_WINDOW_MS);
    let wSum = 0;
    let sSum = 0;
    let rSum = 0;
    const byType = {};
    for (const n of rows) {
      const w = Math.pow(0.5, (now - n.published_at) / SENTIMENT_HALF_LIFE_MS);
      wSum += w;
      sSum += w * n.sentiment_score;
      rSum += w * n.risk_score;
      if (n.risk_type !== 'none') byType[n.risk_type] = (byType[n.risk_type] ?? 0) + w * n.risk_score;
    }
    const sentiment = Math.round((sSum / (wSum + PRIOR_WEIGHT)) * 10000) / 10000;
    const risk = Math.round((rSum / (wSum + PRIOR_WEIGHT)) * 10000) / 10000;
    const top = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
    const topRisk = top && risk >= 0.15 ? top[0] : null;
    this.stmt.updateSentiment.run(sentiment, risk, topRisk, rows.length, symbol);
    const s = this.stocks.get(symbol);
    if (s) Object.assign(s, { sentiment, risk_score: risk, top_risk: topRisk, news_count: rows.length });
  }
}

function toTick(s) {
  return {
    symbol: s.symbol,
    price: s.price,
    changePct: Math.round(((s.price - s.prev_close) / s.prev_close) * 10000) / 100,
    volume: s.volume,
    dayHigh: s.day_high,
    dayLow: s.day_low,
  };
}
