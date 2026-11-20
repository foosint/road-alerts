import { useEffect, useMemo, useState } from 'react';
import RoadMap, { BASEMAPS, FIRE_AGE_STOPS } from './RoadMap';
import { POLL_MS, useRoadData } from './data';
import { STATUS_COLORS, statusColor } from './colors';
import AlertHistory from './AlertHistory';
import Playback from './Playback';
import { PERIODS, TIME_MODES, episodes, tzFor, tzLabel, type Period, type TimeMode } from './history';

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

// Theme switch: auto follows the system setting.
type Theme = 'auto' | 'light' | 'dark';
const THEMES: Theme[] = ['auto', 'light', 'dark'];
const THEME_ICON: Record<Theme, string> = { auto: '◐', light: '☀', dark: '☾' };
const THEME_LABEL: Record<Theme, string> = { auto: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };
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
  const { roads, cities, alerts, fires, checkedAt, error, loading, refresh } = useRoadData();
  const [firesPref, setFiresPref] = usePref('road-alerts.fires', ['on', 'off'] as const);
  const showFires = firesPref === 'on';
  const [basemap, chooseBasemap] = usePref('road-alerts.basemap', BASEMAP_IDS);
  const [timeMode, setTimeMode] = usePref<TimeMode>('road-alerts.time', TIME_IDS);
  const [period, setPeriod] = usePref<Period>('road-alerts.period', PERIOD_IDS);
  const [theme, setTheme] = usePref<Theme>('road-alerts.theme', THEMES);

  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);
  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playbackOn, setPlaybackOn] = useState(false);
  const [pbStatus, setPbStatus] = useState<Record<string, string> | null>(null);
  const allEpisodes = useMemo(
    () => episodes(alerts, (id) => roads?.features.find((f) => f.properties.id === id)?.properties.status),
    [alerts, roads],
  );
  const closePlayback = () => {
    setPlaybackOn(false);
    setPbStatus(null);
  };
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
      const { stroke } = f.properties;
      const status = pbStatus?.[f.properties.id] ?? f.properties.status; // playback: status at that time
      const e = m.get(status) ?? { color: statusColor(status, stroke), count: 0 };
      e.count += 1;
      m.set(status, e);
    }
    return [...m.entries()]; // insertion order: STATUS_COLORS first
  }, [roads, pbStatus]);

  const latestSegment = useMemo(() => {
    let max = 0;
    for (const f of roads?.features ?? []) {
      const t = f.properties.updatedAt ? Date.parse(f.properties.updatedAt) : 0;
      if (t > max) max = t;
    }
    return max ? new Date(max) : null;
  }, [roads]);

  return (
    <div className={`app${playbackOn ? ' pb-on' : ''}`}>
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
        playbackStatus={pbStatus}
        fires={fires}
        showFires={showFires}
        now={Math.floor(now / 60_000) * 60_000}
      />

      {playbackOn && (
        <Playback
          episodes={allEpisodes}
          tz={tzFor(timeMode)()}
          tzName={tzLabel(timeMode, [])}
          now={now}
          onStatus={setPbStatus}
          onClose={closePlayback}
        />
      )}

      <div className="sidebar">
      <aside className={`panel ${open ? '' : 'collapsed'}`}>
        <header>
          <h1>Road Alerts</h1>
          <div className="header-buttons">
            <button
              className="icon"
              onClick={() => setTheme(nextTheme)}
              title={`${THEME_LABEL[theme]} (click for ${nextTheme})`}
              aria-label={`${THEME_LABEL[theme]}. Switch to ${nextTheme}`}
            >
              {THEME_ICON[theme]}
            </button>
            <button className="icon" onClick={() => setOpen(!open)} aria-label={open ? 'Collapse' : 'Expand'}>
              {open ? '−' : '+'}
            </button>
          </div>
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

            <section className="fires-toggle">
              <label title="NASA FIRMS heat signals from satellites, near a road, in the last 24 hours">
                <input type="checkbox" checked={showFires} onChange={(e) => setFiresPref(e.target.checked ? 'on' : 'off')} />
                <span className="fire-dot" />
                <span className="status">Fire signals near roads</span>
                <span className="count">{fires ? fires.features.length : '—'}</span>
              </label>
              {showFires && (
                <div className="fire-scale" aria-label="Colour by age: yellow is new, brown is 24 hours old">
                  <span>now</span>
                  <i style={{ background: `linear-gradient(to right, ${FIRE_AGE_STOPS.map(([h, c]) => `${c} ${(h / 24) * 100}%`).join(', ')})` }} />
                  <span>{fires?.hours ?? 24} h ago</span>
                </div>
              )}
              {showFires && fires && (
                <div className="muted small">
                  Within {fires.maxKm ?? 3} km of a road · NASA FIRMS (VIIRS, MODIS)
                  {fires.updatedAt ? ` · updated ${ago(fires.updatedAt, now)}` : ''}
                </div>
              )}
              {showFires && !fires && <div className="muted small">No fire data yet.</div>}
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
                {(['light', 'dark'] as const).map((tone) => (
                  <optgroup key={tone} label={tone === 'light' ? 'Light maps' : 'Dark maps'}>
                    {BASEMAPS.filter((b) => b.tone === tone).map((b) => (
                      <option key={b.id} value={b.id}>{b.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button onClick={refresh} disabled={loading}>{loading ? 'Checking…' : 'Refresh'}</button>
              <button
                onClick={() => (playbackOn ? closePlayback() : setPlaybackOn(true))}
                aria-pressed={playbackOn}
                title="Replay the alerts of today or the past days"
              >
                {playbackOn ? 'Live' : 'Playback'}
              </button>
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
            now={now}
          />
        </aside>
      )}
      </div>
    </div>
  );
}
