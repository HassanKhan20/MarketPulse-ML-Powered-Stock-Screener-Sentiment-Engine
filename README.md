# MarketPulse — ML-Powered Stock Screener & Sentiment Engine

A real-time stock screening dashboard where you filter live market data alongside
ML-powered news sentiment and risk scores. A PyTorch NLP model classifies every
incoming financial headline by **sentiment** (bearish / neutral / bullish) and **risk type**
(earnings, legal, regulatory, debt, supply chain, leadership, cyber, macro), so traders
can spot emerging risks as they hit the wire.

- **Frontend:** React (JavaScript), HTML, CSS, built with Vite
- **Backend:** Node.js + Express REST API, SQL (SQLite via Node's built-in `node:sqlite`),
  WebSockets (`ws`) for real-time prices, headlines and sentiment updates
- **ML:** Python, PyTorch, scikit-learn. TF-IDF features feed a multi-task MLP, which is
  exported to JSON and served from Node with no Python runtime

```
┌──────────────── ml/ (Python) ─────────────────┐
│ generate_dataset.py → financial_news.csv      │
│ train.py: TF-IDF (sklearn) → PyTorch MLP      │
│           ├─ sentiment head (3 classes)       │
│           └─ risk head (9 classes)            │
│        → artifacts/model.json (weights+vocab) │
└───────────────────────┬───────────────────────┘
                        │ loaded at boot
┌───────────────────────▼──────── server/ (Node) ──────────────────────────┐
│ model.js   JS port of TF-IDF + MLP inference (parity-tested vs PyTorch)  │
│ market.js  price simulator + newswire → classify → SQL → events          │
│ api.js     Express REST: screener filters → parameterised SQL            │
│ app.js     HTTP + WebSocket /ws (ticks, news, sentiment broadcasts)      │
└───────────────────────┬──────────────────────────────────────────────────┘
                        │ REST + WebSocket
┌───────────────────────▼──────── client/ (React) ─────────────────────────┐
│ Filters · Screener table (live flashes, sparklines, sentiment, risk)     │
│ Live news / risk alerts feed · Stock detail drawer · Model lab           │
└──────────────────────────────────────────────────────────────────────────┘
```

## Quick start

Requires **Node 22.13+** (for the built-in `node:sqlite` module). Python is only needed to retrain.

```bash
npm run setup     # install server + client dependencies
npm run build     # build the React app into client/dist
npm start         # API + dashboard on http://localhost:4000
```

For development with hot reload, run these in two terminals:

```bash
npm run dev:server   # API on :4000 (restarts on change)
npm run dev:client   # Vite on :5173, proxies /api and /ws to :4000
```

The database lives at `server/data/marketpulse.db`. On first boot it is seeded with 36
fictional companies, an hour of price history and three hours of classified news.
Delete the file to reset.

### Retraining the model

```bash
pip install -r ml/requirements.txt
npm run train     # regenerates the dataset, trains, writes ml/artifacts/model.json
npm test          # includes a JS-vs-PyTorch parity test on the new export
```

## Features

**Screener**
- Filter by text search, sector, price, day change, market cap, P/E, profitability,
  **news sentiment range**, **minimum risk score** and **dominant risk type**
- One-click presets: *Bullish momentum*, *Emerging risks*, *Value + good news*,
  *Bearish news, still up*
- Server-side sort on any column. Filter state lives in the URL, so a screen can be shared as a link.
- Rows update in place from WebSocket ticks, with price flashes and 30-minute sparklines.

**ML-driven risk detection**
- Every headline is classified on arrival and broadcast with its probabilities.
- Per-stock sentiment and risk are time-decayed aggregates (45-minute half-life,
  shrunk toward neutral when a stock has little coverage).
- A *Risk alerts* tab collects negative headlines with risk ≥ 0.6, and summary tiles track
  names at high risk.
- Classified news feeds back into prices: each headline applies a price shock and tilts
  the stock's drift, so the model's reading moves the tape.

**Stock detail:** intraday chart with previous-close reference and hover tooltip,
fundamentals, sentiment gauge, risk-type breakdown and recent classified headlines.

**Model lab:** classify any headline and inspect both heads' probability distributions,
with the model's held-out test metrics.

## The model

| | |
|---|---|
| Features | scikit-learn `TfidfVectorizer`: word 1–2 grams, sublinear TF, L2 norm, 4,000 terms |
| Network | PyTorch: `Linear(4000→96) → ReLU → Dropout(0.4)`, then two linear heads |
| Loss | cross-entropy on both heads (summed), label smoothing 0.05, AdamW |
| Baseline | scikit-learn `LogisticRegression` per head on the same features |
| Serving | weights exported to JSON; `server/src/model.js` reimplements vectorizer and forward pass |

Held-out test results (`ml/artifacts/model.json → metrics`):

| Evaluation | Model | Sentiment acc. | Risk macro-F1 |
|---|---|---|---|
| Unseen sentences (deduplicated random split) | PyTorch MLP | 96.8% | 1.00 |
| Unseen sentences (deduplicated random split) | LogReg baseline | 96.8% | 1.00 |
| Unseen catalyst phrases (stress test) | PyTorch MLP | 74.3% | 0.40 |
| Unseen catalyst phrases (stress test) | LogReg baseline | 73.5% | 0.27 |

**Read these numbers honestly.** The training corpus is *synthetic*. `generate_dataset.py`
composes headlines from company names, price-move verbs and catalyst phrases, and flips 4%
of sentiment labels to imitate annotator disagreement. That label noise caps sentiment
accuracy at about 97%. The random split shares catalyst vocabulary between train and test,
so it measures generalisation to new sentences, not new concepts. The stress test holds out
entire catalyst phrases (e.g. "jury verdict" never appears in training) and is the better
indicator of real-world behaviour. On that test the MLP's shared representation clearly beats
the linear baseline on risk typing. To train on real data, swap in a labelled corpus such as
Financial PhraseBank with the same `text,sentiment,risk` columns.

## REST API

All endpoints are under `/api`. Bad input returns `400 {"error": "..."}`.

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness and model version |
| GET | `/stocks` | Screener. Query: `q`, `sector` (comma list), `minPrice`/`maxPrice`, `minCap`/`maxCap`, `minPe`/`maxPe`, `minChange`/`maxChange`, `minSentiment`/`maxSentiment`, `minRisk`/`maxRisk`, `minDividend`/`maxDividend`, `minBeta`/`maxBeta`, `minRelVolume`, `profitable`, `riskType`, `sort` (`symbol,name,sector,price,change,volume,relVolume,marketCap,pe,dividend,beta,sentiment,risk`), `order`, `limit`, `offset` |
| GET | `/stocks/:symbol` | Quote, fundamentals, price history, 25 latest classified headlines |
| GET | `/stocks/:symbol/history?limit=` | Price history |
| GET | `/sparklines?minutes=&points=` | Downsampled recent prices for every symbol |
| GET | `/sectors` | Per-sector count, avg change, avg sentiment, max risk, total cap (SQL `GROUP BY`) |
| GET | `/market/summary` | Breadth, average change and sentiment, at-risk names, alerts in the last hour |
| GET | `/news` | Query: `symbol`, `sentiment`, `riskType`, `minRisk`, `before`, `limit` |
| GET | `/alerts?minRisk=0.6` | Negative headlines at or above a risk threshold |
| POST | `/predict` | `{"text": "..."}` or `{"texts": [...]}` (≤50) → sentiment and risk predictions |
| POST | `/news` | `{"symbol","headline","source?"}`: ingest, classify, store, move price, broadcast |
| GET | `/model` | Model metadata and evaluation metrics |

```bash
curl -s localhost:4000/api/predict -H 'content-type: application/json' \
  -d '{"text":"Regulators fine BlueRiver Bank $2 billion for compliance violations"}'
```

## WebSocket protocol

Connect to `ws://<host>/ws`. Every message is `{ "type": ..., "data": ... }`:

| type | data |
|---|---|
| `hello` | `{ model, serverTime }` |
| `ticks` | `{ ts, history, data: [{ symbol, price, changePct, volume, dayHigh, dayLow }] }`, every second |
| `news` | A classified headline: `{ id, symbol, headline, source, publishedAt, sentiment{label,score,confidence,probabilities}, risk{type,score,probabilities} }` |
| `sentiment` | `{ symbol, sentiment, riskScore, topRisk, newsCount }` after each headline |

## Tests

```bash
npm test
```

- **Parity:** the JS tokenizer and forward pass reproduce PyTorch's probabilities (to within 1e-3) on 45 fixtures exported at train time.
- **API:** SQL filter composition, sorting, validation (including rejecting SQL in `sort`),
  detail and sparkline endpoints, prediction, and an end-to-end check that `POST /news` is
  classified, stored, surfaced in `/alerts` and broadcast over the WebSocket.

## Notes

- **Market data is simulated.** Prices follow geometric Brownian motion, scaled by each stock's
  beta and nudged by its news sentiment. Companies are fictional so that generated headlines
  never make claims about real issuers. Connecting a real feed means replacing `MarketEngine.tick()`
  and `publishRandomNews()` with a data-provider adapter; the API, SQL schema and UI stay as they are.
- No Docker or cloud setup is required. The whole stack runs as one Node process plus a static build.

## Project layout

```
ml/        generate_dataset.py, train.py, artifacts/model.json (exported model)
server/    src/{index,app,api,db,market,model,newsgen,universe}.js, test/
client/    src/{App.jsx, api.js, hooks.js, format.js, styles.css}, src/components/
```
