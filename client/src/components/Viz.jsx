// Small inline visual encodings shared by the table, news feed and detail views.
import { RISK_LABELS, fmtSigned, riskLevel } from '../format.js';

/** Diverging bar: bearish (red, left) <- neutral gray midpoint -> bullish (blue, right). */
export function SentimentBar({ score, compact = false }) {
  const pct = Math.min(1, Math.abs(score)) * 50;
  const side = score >= 0 ? 'pos' : 'neg';
  return (
    <span className={`sentbar ${compact ? 'compact' : ''}`} title={`Sentiment ${fmtSigned(score)} (−1 bearish … +1 bullish)`}>
      <span className="sentbar-track" aria-hidden="true">
        <span className="sentbar-mid" />
        <span className={`sentbar-fill ${side}`} style={side === 'pos' ? { left: '50%', width: `${pct}%` } : { right: '50%', width: `${pct}%` }} />
      </span>
      <span className="sentbar-value tabular">{fmtSigned(score)}</span>
    </span>
  );
}

/** Status badge: icon + text label, so risk never relies on color alone. */
export function RiskBadge({ score, type, showType = true }) {
  const lvl = riskLevel(score);
  return (
    <span className={`risk risk-${lvl.key}`} title={`Risk score ${score.toFixed(2)}${type ? ` · ${RISK_LABELS[type] ?? type}` : ''}`}>
      <span aria-hidden="true">{lvl.icon}</span> {lvl.label}
      {showType && type && type !== 'none' && <span className="risk-type"> · {RISK_LABELS[type] ?? type}</span>}
    </span>
  );
}

export function SentimentPill({ label }) {
  const icon = { positive: '▲', negative: '▼', neutral: '■' }[label];
  return <span className={`pill pill-${label}`}><span aria-hidden="true">{icon}</span> {label}</span>;
}

export function Sparkline({ values, width = 96, height = 28 }) {
  if (!values || values.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * (width - pad * 2) + pad,
    height - pad - ((v - min) / span) * (height - pad * 2),
  ]);
  const [lx, ly] = pts[pts.length - 1];
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} className="spark" role="img" aria-label={`30-minute trend ${up ? 'up' : 'down'}`}>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--series-1)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="2.5" fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth="1" />
    </svg>
  );
}

/** Horizontal probability bars for a classifier head. */
export function ProbBars({ probs, labels = {}, highlight }) {
  const entries = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  return (
    <ul className="probs">
      {entries.map(([k, v]) => (
        <li key={k} className={k === highlight ? 'top' : ''}>
          <span className="probs-label">{labels[k] ?? k}</span>
          <span className="probs-track"><span className="probs-fill" style={{ width: `${(v * 100).toFixed(1)}%` }} /></span>
          <span className="probs-value tabular">{(v * 100).toFixed(1)}%</span>
        </li>
      ))}
    </ul>
  );
}
