import { fmtTime } from '../format.js';

const STATUS_TEXT = { live: 'Live', connecting: 'Connecting…', reconnecting: 'Reconnecting…' };

export default function Header({ status, model, lastTickTs, onToggleFilters }) {
  return (
    <header className="header">
      <div className="brand">
        <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
          <rect width="32" height="32" rx="7" fill="var(--series-1)" />
          <path d="M5 18h5l3-8 4 13 3-9 2 4h5" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <h1>MarketPulse</h1>
          <p className="muted small">ML-powered stock screener &amp; news risk engine</p>
        </div>
      </div>
      <div className="header-meta">
        {model && (
          <span className="chip subtle" title={`Trained ${new Date(model.trainedAt).toLocaleString()}`}>
            Model v{model.version.slice(0, 8)} · {model.vocabularySize.toLocaleString()} terms
          </span>
        )}
        <span className={`conn conn-${status}`} role="status">
          <span className="dot" aria-hidden="true" />
          {STATUS_TEXT[status]}
          {status === 'live' && lastTickTs && <span className="muted tabular"> · {fmtTime(lastTickTs)}</span>}
        </span>
        <button type="button" className="btn ghost filters-toggle" onClick={onToggleFilters}>Filters</button>
      </div>
    </header>
  );
}
