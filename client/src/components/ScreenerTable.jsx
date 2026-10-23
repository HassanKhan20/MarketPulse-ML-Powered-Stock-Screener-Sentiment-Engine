import { memo } from 'react';
import { fmtCap, fmtPct, fmtPrice, fmtVolume } from '../format.js';
import { useFlash } from '../hooks.js';
import { RiskBadge, SentimentBar, Sparkline } from './Viz.jsx';

const COLUMNS = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'price', label: 'Price', num: true },
  { key: 'change', label: 'Chg %', num: true },
  { key: null, label: '30m trend' },
  { key: 'relVolume', label: 'Volume', num: true, title: 'Volume (relative to average)' },
  { key: 'marketCap', label: 'Mkt cap', num: true },
  { key: 'pe', label: 'P/E', num: true },
  { key: 'sentiment', label: 'News sentiment' },
  { key: 'risk', label: 'Risk' },
];

const Row = memo(function Row({ row, spark, selected, onSelect }) {
  const flash = useFlash(row.price);
  const tone = row.changePct > 0 ? 'up' : row.changePct < 0 ? 'down' : '';
  const values = spark ? [...spark.slice(0, -1), row.price] : null;
  return (
    <tr
      className={`${selected ? 'selected' : ''}`}
      onClick={() => onSelect(row.symbol)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(row.symbol); } }}
      tabIndex={0}
      aria-selected={selected}
    >
      <td>
        <div className="sym">{row.symbol}</div>
        <div className="muted small ellipsis">{row.name}</div>
      </td>
      <td className={`num tabular flash-${flash}`}>{fmtPrice(row.price)}</td>
      <td className={`num tabular ${tone}`}>
        <span aria-hidden="true">{row.changePct > 0 ? '▲' : row.changePct < 0 ? '▼' : ''}</span> {fmtPct(row.changePct)}
      </td>
      <td><Sparkline values={values} /></td>
      <td className="num tabular">
        {fmtVolume(row.volume)}
        <div className={`small ${row.relVolume >= 1.2 ? 'emph' : 'muted'}`}>{row.relVolume?.toFixed(2)}× avg</div>
      </td>
      <td className="num tabular">{fmtCap(row.marketCap)}</td>
      <td className="num tabular">{row.pe == null ? <span className="muted">n/m</span> : row.pe.toFixed(1)}</td>
      <td><SentimentBar score={row.sentiment} /><div className="muted small">{row.newsCount} headlines · 6h</div></td>
      <td><RiskBadge score={row.riskScore} type={row.topRisk} /></td>
    </tr>
  );
});

export default function ScreenerTable({ rows, total, loading, error, sort, onSort, sparks, selected, onSelect }) {
  return (
    <section className="panel screener" aria-label="Stock screener">
      <div className="panel-head">
        <h2>Screener <span className="muted count">{rows.length} of {total} match{total === 1 ? '' : 'es'}</span></h2>
        <span className="muted small">Click a row for chart, news &amp; model breakdown</span>
      </div>
      {error && <div className="error" role="alert">Couldn’t load stocks: {error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const active = c.key && sort.key === c.key;
                return (
                  <th key={c.label} className={c.num ? 'num' : ''} title={c.title}
                    aria-sort={active ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.key ? (
                      <button type="button" className={`th-btn ${active ? 'active' : ''}`} onClick={() => onSort(c.key)}>
                        {c.label}
                        <span className="sort-ind" aria-hidden="true">{active ? (sort.order === 'asc' ? '↑' : '↓') : '↕'}</span>
                      </button>
                    ) : c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.symbol} row={r} spark={sparks[r.symbol]} selected={r.symbol === selected} onSelect={onSelect} />
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && !error && (
          <div className="empty">No stocks match these filters. Loosen a range or reset.</div>
        )}
      </div>
    </section>
  );
}
