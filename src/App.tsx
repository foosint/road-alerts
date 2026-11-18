import { useEffect, useMemo, useState } from 'react';
import RoadMap, { BASEMAPS } from './RoadMap';
import { POLL_MS, useRoadData } from './data';

const BASEMAP_KEY = 'road-alerts.basemap';

function readBasemap() {
  try {
    const v = localStorage.getItem(BASEMAP_KEY);
    if (v && BASEMAPS.some((b) => b.id === v)) return v;
  } catch { /* storage unavailable */ }
  return BASEMAPS[0].id;
}

function ago(date: Date | string | null | undefined, now: number) {
  if (!date) return '—';
  const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export default function App() {
  const { roads, cities, checkedAt, error, loading, refresh } = useRoadData();
  const [basemap, setBasemap] = useState(readBasemap);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, []);

  const chooseBasemap = (id: string) => {
    setBasemap(id);
    try { localStorage.setItem(BASEMAP_KEY, id); } catch { /* ignore */ }
  };

  // Legend: one row per status present in the data, with the colour the backend assigned.
  const legend = useMemo(() => {
    const m = new Map<string, { color: string; count: number }>();
    for (const f of roads?.features ?? []) {
      const { status, stroke } = f.properties;
      const e = m.get(status) ?? { color: stroke, count: 0 };
      e.count += 1;
      m.set(status, e);
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [roads]);

  const latestSegment = useMemo(() => {
    let max = 0;
    for (const f of roads?.features ?? []) {
      const t = f.properties.updatedAt ? Date.parse(f.properties.updatedAt) : 0;
      if (t > max) max = t;
    }
    return max ? new Date(max) : null;
  }, [roads]);

  return (
    <div className="app">
      <RoadMap roads={roads} cities={cities} basemap={basemap} />

      <aside className={`panel ${open ? '' : 'collapsed'}`}>
        <header>
          <h1>Road Alerts</h1>
          <button className="icon" onClick={() => setOpen(!open)} aria-label={open ? 'Collapse' : 'Expand'}>
            {open ? '−' : '+'}
          </button>
        </header>

        {open && (
          <>
            <section className="legend">
              {legend.length === 0 && <div className="muted">{error ? 'No data' : 'Loading…'}</div>}
              {legend.map(([status, { color, count }]) => (
                <div key={status} className="legend-row">
                  <span className="swatch" style={{ background: color }} />
                  <span className="status">{status}</span>
                  <span className="count">{count}</span>
                </div>
              ))}
            </section>

            <section className="times">
              <div>
                <span>Feed updated</span>
                <span title={roads?.source?.updatedAt}>{ago(roads?.source?.updatedAt, now)}</span>
              </div>
              <div>
                <span>Latest segment change</span>
                <span title={latestSegment?.toISOString()}>{ago(latestSegment, now)}</span>
              </div>
              <div>
                <span>Checked</span>
                <span>{ago(checkedAt, now)}</span>
              </div>
            </section>

            {error && <div className="error">Could not load data: {error}</div>}

            <section className="controls">
              <select value={basemap} onChange={(e) => chooseBasemap(e.target.value)} aria-label="Base map">
                {BASEMAPS.map((b) => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </select>
              <button onClick={refresh} disabled={loading}>{loading ? 'Checking…' : 'Refresh'}</button>
            </section>
            <div className="muted small">Auto-refresh every {POLL_MS / 1000} s · hover or click a road for details</div>
          </>
        )}
      </aside>
    </div>
  );
}
