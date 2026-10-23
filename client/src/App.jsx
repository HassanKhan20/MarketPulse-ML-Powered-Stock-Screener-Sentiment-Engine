import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useDebounced, useInterval, useMarketSocket } from './hooks.js';
import Header from './components/Header.jsx';
import SummaryBar from './components/SummaryBar.jsx';
import SectorStrip from './components/SectorStrip.jsx';
import FilterPanel, { DEFAULT_FILTERS, filtersFromUrl, filtersToUrl } from './components/FilterPanel.jsx';
import ScreenerTable from './components/ScreenerTable.jsx';
import SidePanel from './components/SidePanel.jsx';
import StockDetail from './components/StockDetail.jsx';

const MAX_NEWS = 150;

export default function App() {
  const initial = useMemo(filtersFromUrl, []);
  const [filters, setFilters] = useState(initial.filters);
  const [sort, setSort] = useState(initial.sort);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [live, setLive] = useState({});           // symbol -> latest tick / sentiment
  const [sparks, setSparks] = useState({});
  const [news, setNews] = useState([]);
  const [summary, setSummary] = useState(null);
  const [sectors, setSectors] = useState([]);
  const [model, setModel] = useState(null);
  const [selected, setSelected] = useState(initial.selected);
  const [lastTickTs, setLastTickTs] = useState(null);
  const [historyTick, setHistoryTick] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const query = useDebounced({ ...filters, sort: sort.key, order: sort.order }, 250);

  const loadStocks = useCallback(async () => {
    try {
      const res = await api.stocks({ ...query, limit: 200 });
      setRows(res.items);
      setTotal(res.total);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { loadStocks(); }, [loadStocks]);
  useEffect(() => { filtersToUrl(filters, sort, selected); }, [filters, sort, selected]);

  const loadAux = useCallback(() => {
    api.summary().then(setSummary).catch(() => {});
    api.sectors().then(setSectors).catch(() => {});
  }, []);

  useEffect(() => {
    loadAux();
    api.sparklines().then(setSparks).catch(() => {});
    api.news({ limit: 60 }).then(setNews).catch(() => {});
    api.model().then(setModel).catch(() => {});
  }, [loadAux]);

  // Live ticks update rows in place; periodic refetch keeps filter membership and sort order honest.
  useInterval(loadStocks, 4000);
  useInterval(loadAux, 5000);
  useInterval(() => api.sparklines().then(setSparks).catch(() => {}), 30_000);

  const status = useMarketSocket({
    ticks: ({ ts, history, data }) => {
      setLive((prev) => {
        const next = { ...prev };
        for (const t of data) next[t.symbol] = { ...prev[t.symbol], ...t };
        return next;
      });
      setLastTickTs(ts);
      if (history) setHistoryTick({ ts, data });
    },
    sentiment: (s) => {
      setLive((prev) => ({
        ...prev,
        [s.symbol]: { ...prev[s.symbol], sentiment: s.sentiment, riskScore: s.riskScore, topRisk: s.topRisk, newsCount: s.newsCount },
      }));
    },
    news: (item) => setNews((prev) => (prev.some((n) => n.id === item.id) ? prev : [item, ...prev].slice(0, MAX_NEWS))),
    open: () => { loadStocks(); api.news({ limit: 60 }).then(setNews).catch(() => {}); },
  });

  const merged = useMemo(
    () => rows.map((r) => {
      const l = live[r.symbol];
      return l ? { ...r, ...l, relVolume: l.volume ? Math.round((l.volume / r.avgVolume) * 100) / 100 : r.relVolume } : r;
    }),
    [rows, live],
  );
  const visibleSymbols = useMemo(() => new Set(rows.map((r) => r.symbol)), [rows]);
  const selectedRow = merged.find((r) => r.symbol === selected) ?? null;

  return (
    <div className="app">
      <Header status={status} model={model} lastTickTs={lastTickTs} onToggleFilters={() => setFiltersOpen((o) => !o)} />
      <SummaryBar summary={summary} />
      <SectorStrip
        sectors={sectors}
        active={filters.sector}
        onToggle={(sector) => setFilters((f) => ({
          ...f,
          sector: f.sector.includes(sector) ? f.sector.filter((s) => s !== sector) : [...f.sector, sector],
        }))}
      />
      <main className="layout">
        <FilterPanel
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          filters={filters}
          sectors={sectors.map((s) => s.sector)}
          onChange={setFilters}
          onPreset={(preset) => { setFilters({ ...DEFAULT_FILTERS, ...preset.filters }); if (preset.sort) setSort(preset.sort); }}
          onReset={() => { setFilters(DEFAULT_FILTERS); setSort({ key: 'marketCap', order: 'desc' }); }}
        />
        <ScreenerTable
          rows={merged}
          total={total}
          loading={loading}
          error={error}
          sort={sort}
          onSort={(key) => setSort((s) => ({ key, order: s.key === key && s.order === 'desc' ? 'asc' : 'desc' }))}
          sparks={sparks}
          selected={selected}
          onSelect={setSelected}
        />
        <SidePanel news={news} visibleSymbols={visibleSymbols} onSelect={setSelected} model={model} />
      </main>
      {selected && (
        <StockDetail
          symbol={selected}
          liveRow={selectedRow ?? live[selected]}
          historyTick={historyTick}
          news={news}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
