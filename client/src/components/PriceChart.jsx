import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtPct, fmtPrice } from '../format.js';

const HEIGHT = 240;
const M = { top: 12, right: 56, bottom: 26, left: 8 };

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

const fmtClock = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Intraday price line with a previous-close reference, crosshair and tooltip. */
export default function PriceChart({ points, prevClose }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const prices = points.map((p) => p.price);
    let lo = Math.min(...prices, prevClose);
    let hi = Math.max(...prices, prevClose);
    const pad = (hi - lo) * 0.08 || 1;
    lo -= pad; hi += pad;
    const t0 = points[0].ts;
    const t1 = points[points.length - 1].ts;
    const iw = width - M.left - M.right;
    const ih = HEIGHT - M.top - M.bottom;
    const x = (ts) => M.left + ((ts - t0) / (t1 - t0 || 1)) * iw;
    const y = (v) => M.top + (1 - (v - lo) / (hi - lo)) * ih;
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(p.price).toFixed(1)}`).join('');
    const xTicks = Array.from({ length: 5 }, (_, i) => t0 + ((t1 - t0) * i) / 4);
    return { x, y, path, yTicks: niceTicks(lo, hi), xTicks, iw, ih };
  }, [points, prevClose, width]);

  const onMove = (e) => {
    if (!geo) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(geo.x(p.ts) - px);
      if (d < bestD) { bestD = d; best = i; }
    });
    setHover(best);
  };

  const hp = hover != null ? points[hover] : null;
  return (
    <div className="chart" ref={wrapRef}>
      {!geo ? (
        <div className="empty" style={{ height: HEIGHT }}>Collecting price history…</div>
      ) : (
        <svg width={width} height={HEIGHT} role="img" aria-label="Intraday price chart" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          {geo.yTicks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={M.left + geo.iw} y1={geo.y(t)} y2={geo.y(t)} className="grid" />
              <text x={M.left + geo.iw + 6} y={geo.y(t)} dy="0.32em" className="axis-label">{fmtPrice(t)}</text>
            </g>
          ))}
          {geo.xTicks.map((t, i) => (
            <text key={t} x={geo.x(t)} y={HEIGHT - 6} className="axis-label" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{fmtClock(t)}</text>
          ))}
          <line x1={M.left} x2={M.left + geo.iw} y1={geo.y(prevClose)} y2={geo.y(prevClose)} className="ref-line" />
          <text x={M.left + 4} y={geo.y(prevClose) - 5} className="axis-label halo">Prev close {fmtPrice(prevClose)}</text>
          <path d={geo.path} className="price-line" />
          {hp && (
            <g>
              <line x1={geo.x(hp.ts)} x2={geo.x(hp.ts)} y1={M.top} y2={M.top + geo.ih} className="crosshair" />
              <circle cx={geo.x(hp.ts)} cy={geo.y(hp.price)} r="4.5" className="hover-dot" />
            </g>
          )}
          <rect x={M.left} y={M.top} width={geo.iw} height={geo.ih} fill="transparent" />
        </svg>
      )}
      {hp && geo && (
        <div className="tooltip" style={{ left: Math.min(width - 150, Math.max(0, geo.x(hp.ts) + 12)), top: 8 }}>
          <div className="muted small">{new Date(hp.ts).toLocaleTimeString()}</div>
          <div className="tabular strong">${fmtPrice(hp.price)}</div>
          <div className="small tabular">{fmtPct(((hp.price - prevClose) / prevClose) * 100)} vs prev close</div>
        </div>
      )}
    </div>
  );
}
