// SQLite storage via Node's built-in node:sqlite driver (no native build step).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stocks (
  symbol          TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  sector          TEXT NOT NULL,
  industry        TEXT NOT NULL,
  market_cap      REAL NOT NULL,          -- USD billions
  pe              REAL,                   -- NULL when earnings are negative
  dividend_yield  REAL NOT NULL DEFAULT 0, -- percent
  beta            REAL NOT NULL,
  price           REAL NOT NULL,
  prev_close      REAL NOT NULL,
  day_open        REAL NOT NULL,
  day_high        REAL NOT NULL,
  day_low         REAL NOT NULL,
  volume          INTEGER NOT NULL DEFAULT 0,
  avg_volume      INTEGER NOT NULL,
  sentiment       REAL NOT NULL DEFAULT 0, -- time-decayed mean of news sentiment, -1..1
  risk_score      REAL NOT NULL DEFAULT 0, -- time-decayed mean of news risk, 0..1
  top_risk        TEXT,                    -- dominant recent risk type
  news_count      INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol  TEXT NOT NULL REFERENCES stocks(symbol),
  ts      INTEGER NOT NULL,
  price   REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_symbol_ts ON price_history(symbol, ts);

CREATE TABLE IF NOT EXISTS news (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol           TEXT NOT NULL REFERENCES stocks(symbol),
  headline         TEXT NOT NULL,
  source           TEXT NOT NULL,
  published_at     INTEGER NOT NULL,
  sentiment_label  TEXT NOT NULL,
  sentiment_score  REAL NOT NULL,
  confidence       REAL NOT NULL,
  risk_type        TEXT NOT NULL,
  risk_score       REAL NOT NULL,
  probabilities    TEXT NOT NULL,          -- JSON {sentiment:{...}, risk:{...}}
  model_version    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_symbol_time ON news(symbol, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_time ON news(published_at DESC);

CREATE TABLE IF NOT EXISTS prediction_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  text             TEXT NOT NULL,
  sentiment_label  TEXT NOT NULL,
  risk_type        TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);
`;

export function openDatabase(file = process.env.DB_PATH ?? path.resolve('data', 'marketpulse.db')) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
