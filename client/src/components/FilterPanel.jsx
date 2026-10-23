import { RISK_LABELS } from '../format.js';

export const DEFAULT_FILTERS = {
  q: '',
  sector: [],
  minPrice: '',
  maxPrice: '',
  minCap: '',
  maxPe: '',
  profitable: false,
  minChange: '',
  maxChange: '',
  minSentiment: -1,
  maxSentiment: 1,
  minRisk: 0,
  riskType: [],
};

const PRESETS = [
  { name: 'Bullish momentum', filters: { minSentiment: 0.15, minChange: 0 }, sort: { key: 'sentiment', order: 'desc' } },
  { name: 'Emerging risks', filters: { minRisk: 0.3 }, sort: { key: 'risk', order: 'desc' } },
  { name: 'Value + good news', filters: { maxPe: 20, profitable: true, minSentiment: 0.05 }, sort: { key: 'pe', order: 'asc' } },
  { name: 'Bearish news, still up', filters: { maxSentiment: -0.1, minChange: 0 }, sort: { key: 'change', order: 'desc' } },
];

const ARRAY_KEYS = ['sector', 'riskType'];
const NUMERIC_DEFAULT_KEYS = ['minSentiment', 'maxSentiment', 'minRisk'];

export function filtersFromUrl() {
  const p = new URLSearchParams(location.search);
  const filters = { ...DEFAULT_FILTERS };
  for (const key of Object.keys(DEFAULT_FILTERS)) {
    if (!p.has(key)) continue;
    const v = p.get(key);
    if (ARRAY_KEYS.includes(key)) filters[key] = v.split(',').filter(Boolean);
    else if (key === 'profitable') filters[key] = v === 'true';
    else if (NUMERIC_DEFAULT_KEYS.includes(key)) filters[key] = Number(v);
    else filters[key] = v;
  }
  return {
    filters,
    sort: { key: p.get('sort') ?? 'marketCap', order: p.get('order') ?? 'desc' },
    selected: p.get('symbol'),
  };
}

export function filtersToUrl(filters, sort, selected) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (JSON.stringify(v) === JSON.stringify(DEFAULT_FILTERS[k])) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  if (sort.key !== 'marketCap' || sort.order !== 'desc') { p.set('sort', sort.key); p.set('order', sort.order); }
  if (selected) p.set('symbol', selected);
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

function Range({ label, min, max, onMin, onMax, unit, step = 'any' }) {
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      <div className="range-inputs">
        <input type="number" inputMode="decimal" step={step} placeholder="Min" value={min} onChange={(e) => onMin(e.target.value)} aria-label={`${label} minimum`} />
        <span className="muted">–</span>
        <input type="number" inputMode="decimal" step={step} placeholder="Max" value={max} onChange={(e) => onMax(e.target.value)} aria-label={`${label} maximum`} />
        {unit && <span className="muted small">{unit}</span>}
      </div>
    </fieldset>
  );
}

export default function FilterPanel({ open, onClose, filters, sectors, onChange, onPreset, onReset }) {
  const set = (key) => (value) => onChange((f) => ({ ...f, [key]: value }));
  const toggle = (key, value) => onChange((f) => ({
    ...f,
    [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value],
  }));

  return (
    <aside className={`panel filters ${open ? 'open' : ''}`} aria-label="Screener filters">
      <div className="panel-head">
        <h2>Filters</h2>
        <div className="row gap-s">
          <button type="button" className="btn ghost small" onClick={onReset}>Reset</button>
          <button type="button" className="btn ghost small close-filters" onClick={onClose} aria-label="Close filters">✕</button>
        </div>
      </div>

      <div className="presets">
        {PRESETS.map((p) => (
          <button type="button" key={p.name} className="btn preset" onClick={() => onPreset(p)}>{p.name}</button>
        ))}
      </div>

      <label className="field">
        <span className="legend">Search</span>
        <input type="search" placeholder="Symbol, name or industry" value={filters.q} onChange={(e) => set('q')(e.target.value)} />
      </label>

      <fieldset className="field">
        <legend>Sector</legend>
        <div className="chips">
          {sectors.map((s) => (
            <button type="button" key={s} className={`chip toggle ${filters.sector.includes(s) ? 'on' : ''}`} aria-pressed={filters.sector.includes(s)} onClick={() => toggle('sector', s)}>
              {s}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>News sentiment <span className="muted tabular">{filters.minSentiment.toFixed(2)} to {filters.maxSentiment.toFixed(2)}</span></legend>
        <div className="slider-pair">
          <label className="small muted">Min
            <input type="range" min="-1" max="1" step="0.05" value={filters.minSentiment}
              onChange={(e) => { const v = Number(e.target.value); onChange((f) => ({ ...f, minSentiment: v, maxSentiment: Math.max(v, f.maxSentiment) })); }} />
          </label>
          <label className="small muted">Max
            <input type="range" min="-1" max="1" step="0.05" value={filters.maxSentiment}
              onChange={(e) => { const v = Number(e.target.value); onChange((f) => ({ ...f, maxSentiment: v, minSentiment: Math.min(v, f.minSentiment) })); }} />
          </label>
        </div>
        <div className="scale-labels small muted"><span>Bearish</span><span>Neutral</span><span>Bullish</span></div>
      </fieldset>

      <fieldset className="field">
        <legend>Minimum risk score <span className="muted tabular">{filters.minRisk.toFixed(2)}</span></legend>
        <input type="range" min="0" max="1" step="0.05" value={filters.minRisk} onChange={(e) => set('minRisk')(Number(e.target.value))} aria-label="Minimum risk score" />
        <div className="chips">
          {Object.entries(RISK_LABELS).filter(([k]) => k !== 'none').map(([k, label]) => (
            <button type="button" key={k} className={`chip toggle ${filters.riskType.includes(k) ? 'on' : ''}`} aria-pressed={filters.riskType.includes(k)} onClick={() => toggle('riskType', k)}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <Range label="Price" unit="$" min={filters.minPrice} max={filters.maxPrice} onMin={set('minPrice')} onMax={set('maxPrice')} />
      <Range label="Day change" unit="%" min={filters.minChange} max={filters.maxChange} onMin={set('minChange')} onMax={set('maxChange')} />

      <div className="two-col">
        <label className="field">
          <span className="legend">Min market cap ($B)</span>
          <input type="number" min="0" inputMode="decimal" value={filters.minCap} onChange={(e) => set('minCap')(e.target.value)} />
        </label>
        <label className="field">
          <span className="legend">Max P/E</span>
          <input type="number" min="0" inputMode="decimal" value={filters.maxPe} onChange={(e) => set('maxPe')(e.target.value)} />
        </label>
      </div>

      <label className="check">
        <input type="checkbox" checked={filters.profitable} onChange={(e) => set('profitable')(e.target.checked)} />
        Profitable only (has P/E)
      </label>
    </aside>
  );
}
