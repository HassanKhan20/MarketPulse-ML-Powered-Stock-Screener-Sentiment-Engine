async function request(path, options) {
  const res = await fetch(`/api${path}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`);
  return body;
}

export function toQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    q.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return q.toString();
}

export const api = {
  stocks: (params) => request(`/stocks?${toQuery(params)}`),
  stock: (symbol) => request(`/stocks/${encodeURIComponent(symbol)}`),
  sparklines: () => request('/sparklines?minutes=30&points=60'),
  sectors: () => request('/sectors'),
  summary: () => request('/market/summary'),
  news: (params = {}) => request(`/news?${toQuery(params)}`),
  model: () => request('/model'),
  predict: (text) => request('/predict', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  }),
};
