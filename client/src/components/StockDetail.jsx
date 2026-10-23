import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { RISK_LABELS, fmtCap, fmtPct, fmtPrice, fmtVolume, sentimentWord } from '../format.js';
import { useInterval } from '../hooks.js';
import PriceChart from './PriceChart.jsx';
import { NewsItem } from './SidePanel.jsx';
import { RiskBadge, SentimentBar } from './Viz.jsx';

export default function StockDetail({ symbol, liveRow, historyTick, news, onClose }) {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(Date.now());
  useInterval(() => setNow(Date.now()), 5000);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    api.stock(symbol)
      .then((d) => { if (!cancelled) { setData(d); setHistory(d.history); } })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [symbol]);

  // Extend the chart with each persisted tick from the socket.
  useEffect(() => {
    const t = historyTick?.data.find((d) => d.symbol === symbol);
    if (t) setHistory((h) => (h.length && h[h.length - 1].ts >= historyTick.ts ? h : [...h, { ts: historyTick.ts, price: t.price }].slice(-1500)));
  }, [historyTick, symbol]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const s = data ? { ...data, ...liveRow } : null;
  const stockNews = useMemo(() => {
    if (!data) return [];
    const seen = new Set();
    return [...news.filter((n) => n.symbol === symbol), ...data.news]
      .filter((n) => (seen.has(n.id) ? false : seen.add(n.id)))
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(0, 25);
  }, [news, data, symbol]);

  const riskMix = useMemo(() => {
    // Count of risk-flagged headlines per type (risk score >= 0.5).
    const counts = {};
    for (const n of stockNews) if (n.risk.type !== 'none' && n.risk.score >= 0.5) counts[n.risk.type] = (counts[n.risk.type] ?? 0) + 1;
    const max = Math.max(0, ...Object.values(counts));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v, w: max ? v / max : 0 }));
  }, [stockNews]);

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`${symbol} details`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn ghost drawer-close" onClick={onClose} aria-label="Close details">✕</button>
        {error && <div className="error" role="alert">{error}</div>}
        {!s ? (
          !error && <div className="empty">Loading {symbol}…</div>
        ) : (
          <>
            <header className="detail-head">
              <div>
                <h2>{s.symbol} <span className="muted detail-name">{s.name}</span></h2>
                <div className="muted small">{s.sector} · {s.industry}</div>
              </div>
              <div className="detail-price">
                <div className="big tabular">${fmtPrice(s.price)}</div>
                <div className={`tabular ${s.changePct > 0 ? 'up' : s.changePct < 0 ? 'down' : ''}`}>
                  {s.changePct > 0 ? '▲' : s.changePct < 0 ? '▼' : ''} {fmtPct(s.changePct)} today
                </div>
              </div>
            </header>

            <PriceChart points={history} prevClose={s.prevClose} />

            <dl className="stats">
              <div><dt>Open</dt><dd className="tabular">{fmtPrice(s.open)}</dd></div>
              <div><dt>Day range</dt><dd className="tabular">{fmtPrice(s.dayLow)} – {fmtPrice(s.dayHigh)}</dd></div>
              <div><dt>Volume</dt><dd className="tabular">{fmtVolume(s.volume)}</dd></div>
              <div><dt>Avg volume</dt><dd className="tabular">{fmtVolume(s.avgVolume)}</dd></div>
              <div><dt>Market cap</dt><dd className="tabular">{fmtCap(s.marketCap)}</dd></div>
              <div><dt>P/E</dt><dd className="tabular">{s.pe == null ? 'n/m' : s.pe.toFixed(1)}</dd></div>
              <div><dt>Dividend</dt><dd className="tabular">{s.dividendYield.toFixed(2)}%</dd></div>
              <div><dt>Beta</dt><dd className="tabular">{s.beta.toFixed(2)}</dd></div>
            </dl>

            <section className="detail-ml">
              <div>
                <h3>News sentiment · {sentimentWord(s.sentiment)}</h3>
                <SentimentBar score={s.sentiment} />
                <p className="muted small">Time-decayed (45-min half-life) average of {s.newsCount} classified headlines over 6h.</p>
              </div>
              <div>
                <h3>Risk</h3>
                <RiskBadge score={s.riskScore} type={s.topRisk} />
                <p className="muted small">Score {s.riskScore.toFixed(2)} · risk-flagged headlines by type:</p>
                {riskMix.length > 0 && (
                  <ul className="probs">
                    {riskMix.map(({ k, v, w }) => (
                      <li key={k}>
                        <span className="probs-label">{RISK_LABELS[k]}</span>
                        <span className="probs-track"><span className="probs-fill risk-fill" style={{ width: `${w * 100}%` }} /></span>
                        <span className="probs-value tabular">{v}×</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <h3>Recent headlines</h3>
            <ul className="news-list">
              {stockNews.map((n) => <NewsItem key={n.id} item={n} now={now} showSymbol={false} />)}
            </ul>
            {stockNews.length === 0 && <div className="empty">No headlines in the last 6 hours.</div>}
          </>
        )}
      </aside>
    </div>
  );
}
