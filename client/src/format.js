export const fmtPrice = (v) => (v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export const fmtPct = (v, digits = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`);

export const fmtSigned = (v, digits = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}`);

export function fmtCap(billions) {
  if (billions == null) return '—';
  return billions >= 1000 ? `$${(billions / 1000).toFixed(2)}T` : `$${billions.toFixed(1)}B`;
}

export function fmtVolume(v) {
  if (v == null) return '—';
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
}

export function timeAgo(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const RISK_LABELS = {
  none: 'None',
  earnings: 'Earnings',
  legal: 'Legal',
  regulatory: 'Regulatory',
  debt: 'Debt / Credit',
  supply_chain: 'Supply chain',
  leadership: 'Leadership',
  cyber: 'Cyber',
  macro: 'Macro',
};

/** Risk score -> status level. Every level renders with an icon + text label, never color alone. */
export function riskLevel(score) {
  if (score >= 0.6) return { key: 'critical', label: 'High', icon: '▲' };
  if (score >= 0.35) return { key: 'serious', label: 'Elevated', icon: '◆' };
  if (score >= 0.15) return { key: 'warning', label: 'Watch', icon: '●' };
  return { key: 'low', label: 'Low', icon: '○' };
}

export function sentimentWord(score) {
  if (score >= 0.15) return 'Bullish';
  if (score <= -0.15) return 'Bearish';
  return 'Neutral';
}
