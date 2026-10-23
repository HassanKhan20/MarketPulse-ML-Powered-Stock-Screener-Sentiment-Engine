import { fmtPct, fmtSigned } from '../format.js';

export default function SectorStrip({ sectors, active, onToggle }) {
  if (!sectors.length) return null;
  return (
    <nav className="sectors" aria-label="Sectors">
      {sectors.map((s) => {
        const on = active.includes(s.sector);
        const tone = s.avgChange > 0 ? 'up' : s.avgChange < 0 ? 'down' : '';
        return (
          <button
            type="button"
            key={s.sector}
            className={`sector ${on ? 'on' : ''}`}
            aria-pressed={on}
            onClick={() => onToggle(s.sector)}
            title={`${s.count} stocks · sentiment ${fmtSigned(s.avgSentiment)} · max risk ${s.maxRisk.toFixed(2)}`}
          >
            <span className="sector-name">{s.sector}</span>
            <span className={`sector-chg tabular ${tone}`}>
              {s.avgChange > 0 ? '▲' : s.avgChange < 0 ? '▼' : ''} {fmtPct(s.avgChange)}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
