import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { RISK_LABELS, timeAgo } from '../format.js';
import { useInterval } from '../hooks.js';
import { ProbBars, RiskBadge, SentimentPill } from './Viz.jsx';

const ALERT_MIN_RISK = 0.6;
const isAlert = (n) => n.risk.score >= ALERT_MIN_RISK && n.sentiment.label === 'negative';

export function NewsItem({ item, onSelect, now, showSymbol = true }) {
  return (
    <li className={`news-item ${isAlert(item) ? 'alert' : ''}`}>
      <div className="news-meta small">
        {showSymbol && (
          <button type="button" className="sym-link" onClick={() => onSelect?.(item.symbol)}>{item.symbol}</button>
        )}
        <span className="muted">{item.source} · {timeAgo(item.publishedAt, now)}</span>
      </div>
      <p className="headline">{item.headline}</p>
      <div className="news-tags">
        <SentimentPill label={item.sentiment.label} />
        <span className="muted small tabular" title="Classifier confidence">{Math.round(item.sentiment.confidence * 100)}% conf.</span>
        {item.risk.score >= 0.15 && <RiskBadge score={item.risk.score} type={item.risk.type} />}
      </div>
    </li>
  );
}

function Lab({ model }) {
  const [text, setText] = useState('Meridian Payments discloses data breach as regulators open probe');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (e) => {
    e?.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await api.predict(text);
      setResult(res.predictions[0]);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const m = model?.metrics?.primary?.pytorch;
  const stress = model?.metrics?.stress_unseen_phrases?.pytorch;
  return (
    <div className="lab">
      <form onSubmit={run}>
        <label className="field">
          <span className="legend">Try any financial headline</span>
          <textarea rows={3} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
        </label>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Classifying…' : 'Classify headline'}</button>
      </form>
      {error && <div className="error" role="alert">{error}</div>}
      {result && (
        <div className="lab-result">
          <div className="row gap-s wrap">
            <SentimentPill label={result.sentiment.label} />
            <RiskBadge score={result.risk.score} type={result.risk.type} />
            {result.knownTerms === 0 && <span className="muted small">No known vocabulary — prediction is the prior.</span>}
          </div>
          <h3>Sentiment</h3>
          <ProbBars probs={result.sentiment.probabilities} highlight={result.sentiment.label} />
          <h3>Risk type</h3>
          <ProbBars probs={result.risk.probabilities} labels={RISK_LABELS} highlight={result.risk.type} />
        </div>
      )}
      {model && (
        <div className="model-card small">
          <h3>About the model</h3>
          <p className="muted">
            TF-IDF (1–2 grams, {model.vocabularySize.toLocaleString()} terms) → PyTorch MLP ({model.architecture.hidden} hidden units)
            with two heads: sentiment and risk type. Trained on {model.dataset.train.toLocaleString()} labeled
            {model.dataset.synthetic ? ' synthetic' : ''} headlines; served in Node with no Python runtime.
          </p>
          {m && (
            <table className="metrics">
              <thead><tr><th>Held-out test</th><th className="num">Sentiment acc.</th><th className="num">Risk F1</th></tr></thead>
              <tbody>
                <tr><td>Unseen sentences</td><td className="num tabular">{(m.sentiment_accuracy * 100).toFixed(1)}%</td><td className="num tabular">{m.risk_macro_f1.toFixed(2)}</td></tr>
                {stress && <tr><td>Unseen phrasings</td><td className="num tabular">{(stress.sentiment_accuracy * 100).toFixed(1)}%</td><td className="num tabular">{stress.risk_macro_f1.toFixed(2)}</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default function SidePanel({ news, visibleSymbols, onSelect, model }) {
  const [tab, setTab] = useState('feed');
  const [onlyScreened, setOnlyScreened] = useState(false);
  const [now, setNow] = useState(Date.now());
  useInterval(() => setNow(Date.now()), 5000);

  let items = news;
  if (onlyScreened) items = items.filter((n) => visibleSymbols.has(n.symbol));
  if (tab === 'alerts') items = items.filter(isAlert);
  const alertCount = news.filter(isAlert).length;

  return (
    <aside className="panel side" aria-label="News and model">
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'feed'} className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>Live news</button>
        <button type="button" role="tab" aria-selected={tab === 'alerts'} className={tab === 'alerts' ? 'on' : ''} onClick={() => setTab('alerts')}>
          Risk alerts {alertCount > 0 && <span className="count-badge">{alertCount}</span>}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'lab'} className={tab === 'lab' ? 'on' : ''} onClick={() => setTab('lab')}>Model lab</button>
      </div>
      {tab === 'lab' ? (
        <Lab model={model} />
      ) : (
        <>
          <label className="check small">
            <input type="checkbox" checked={onlyScreened} onChange={(e) => setOnlyScreened(e.target.checked)} />
            Only stocks in current screen
          </label>
          <ul className="news-list" aria-live="polite">
            {items.slice(0, 80).map((n) => <NewsItem key={n.id} item={n} onSelect={onSelect} now={now} />)}
          </ul>
          {items.length === 0 && <div className="empty">{tab === 'alerts' ? 'No high-risk negative headlines right now.' : 'Waiting for headlines…'}</div>}
        </>
      )}
    </aside>
  );
}
