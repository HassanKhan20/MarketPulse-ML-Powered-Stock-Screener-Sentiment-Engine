import { fmtPct, fmtSigned, sentimentWord } from '../format.js';

function Tile({ label, value, sub, tone }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className={`tile-value ${tone ?? ''}`}>{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

export default function SummaryBar({ summary }) {
  if (!summary) return <section className="summary skeleton" aria-busy="true" />;
  const breadth = summary.total ? Math.round((summary.advancers / summary.total) * 100) : 0;
  return (
    <section className="summary" aria-label="Market summary">
      <Tile
        label="Breadth"
        value={`${summary.advancers} ▲ / ${summary.decliners} ▼`}
        sub={
          <span className="breadth" aria-label={`${breadth}% of stocks advancing`}>
            <span className="breadth-fill" style={{ width: `${breadth}%` }} />
          </span>
        }
      />
      <Tile
        label="Avg change"
        value={fmtPct(summary.avgChange)}
        tone={summary.avgChange > 0 ? 'up' : summary.avgChange < 0 ? 'down' : ''}
        sub={`${summary.total} listed names`}
      />
      <Tile label="News sentiment" value={fmtSigned(summary.avgSentiment)} sub={sentimentWord(summary.avgSentiment)} />
      <Tile label="Names at high risk" value={summary.atRisk} sub="risk score ≥ 0.60" />
      <Tile label="Risk alerts · 1h" value={summary.alertsLastHour} sub={`${summary.newsLastHour} headlines classified`} />
    </section>
  );
}
