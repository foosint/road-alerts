import { useEffect, useMemo, useState } from 'react';
import RoadMap, { BASEMAPS } from './RoadMap';
import { POLL_MS, useRoadData } from './data';
import { STATUS_COLORS, statusColor } from './colors';
import AlertHistory from './AlertHistory';
import { PERIODS, TIME_MODES, tzFor, type Period, type TimeMode } from './history';

// Per-browser preferences.
function readPref<T extends string>(key: string, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    if (v && allowed.includes(v)) return v;
  } catch { /* storage unavailable */ }
  return allowed[0];
}
function writePref(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* ignore */ }
}
function usePref<T extends string>(key: string, allowed: readonly T[]) {
  const [v, setV] = useState<T>(() => readPref(key, allowed));
  return [v, (x: T) => { setV(x); writePref(key, x); }] as const;
}
const BASEMAP_IDS = BASEMAPS.map((b) => b.id);
const TIME_IDS = TIME_MODES.map((m) => m.id);
const PERIOD_IDS: Period[] = ['all', ...PERIODS.map((x) => x.id).filter((x) => x !== 'all')];

function ago(date: Date | string | null | undefined, now: number) {
  if (!date) return '—';
  const s = Math.max(0, Math.round((now - new Date(date).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export default function App() {
  const { roads, cities, alerts, checkedAt, error, loading, refresh } = useRoadData();
  const [basemap, chooseBasemap] = usePref('road-alerts.basemap', BASEMAP_IDS);
  const [timeMode, setTimeMode] = usePref<TimeMode>('road-alerts.time', TIME_IDS);
  const [period, setPeriod] = usePref<Period>('road-alerts.period', PERIOD_IDS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [open, setOpen] = useState(true);

  // Escape clears the selected road.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelectedId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, []);

  // Legend: every known status in a fixed order (even with 0 roads), then any unknown status in the data.
  const legend = useMemo(() => {
    const m = new Map<string, { color: string; count: number }>(
      Object.entries(STATUS_COLORS).map(([status, color]) => [status, { color, count: 0 }]),
    );
    for (const f of roads?.features ?? []) {
      const { status, stroke } = f.properties;
      const e = m.get(status) ?? { color: statusColor(status, stroke), count: 0 };
      e.count += 1;
      m.set(status, e);
    }
    return [...m.entries()]; // insertion order: STATUS_COLORS first
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
      <RoadMap
        roads={roads}
        cities={cities}
        basemap={basemap}
        selectedId={selectedId}
        onSelect={(id) => {
          setSelectedId(id);
          if (id) setOpen(true);
        }}
        timeZoneFor={tzFor(timeMode)}
      />

      <div className="sidebar">
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
              {!roads && <div className="muted">{error ? 'No data' : 'Loading…'}</div>}
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
            <div className="muted small">Auto-refresh every {POLL_MS / 1000} s · hover a road for details, click it for its alert history</div>
          </>
        )}
      </aside>

      {open && (
        <aside className="panel history-panel">
          <AlertHistory
            alerts={alerts}
            roads={roads}
            selectedId={selectedId}
            onSelect={setSelectedId}
            timeMode={timeMode}
            setTimeMode={setTimeMode}
            period={period}
            setPeriod={setPeriod}
          />
        </aside>
      )}
      </div>
    </div>
  );
}
