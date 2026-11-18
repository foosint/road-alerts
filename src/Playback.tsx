import { useEffect, useMemo, useRef, useState } from 'react';
import { busyAt, fmtTime, startOfDay, type Episode } from './history';

export const PLAYBACK_RANGES = [
  { id: 'today', label: 'Today' },
  { id: '1', label: 'Last day' },
  { id: '3', label: 'Last 3 days' },
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' },
] as const;
type Range = (typeof PLAYBACK_RANGES)[number]['id'];

/** Playback speed: simulated minutes per real second. */
const SPEEDS = [
  { min: 5, label: '5 min/s' },
  { min: 15, label: '15 min/s' },
  { min: 60, label: '1 h/s' },
  { min: 180, label: '3 h/s' },
  { min: 720, label: '12 h/s' },
];

const FRAME_MS = 100; // map/UI updates per real second: 10

type Props = {
  episodes: Episode[];
  /** Time zone for the clock and for "Today" (undefined = the viewer's own). */
  tz: string | undefined;
  tzName: string;
  now: number;
  /** Status per road at the playback time. */
  onStatus: (status: Record<string, string>) => void;
  onClose: () => void;
};

/** A bar over the map that replays the alerts of a time range. */
export default function Playback({ episodes, tz, tzName, now, onStatus, onClose }: Props) {
  const [range, setRange] = useState<Range>('today');
  const [speed, setSpeed] = useState(60);
  const [playing, setPlaying] = useState(false);
  const from = range === 'today' ? startOfDay(now, tz) : now - Number(range) * 86_400_000;
  const [t, setT] = useState(from);
  const tRef = useRef(t);
  tRef.current = t;

  // New range: rewind to its start.
  useEffect(() => {
    setT(from);
    setPlaying(false);
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const next = tRef.current + (FRAME_MS / 1000) * speed * 60_000;
      if (next >= now) {
        setT(now);
        setPlaying(false);
      } else setT(next);
    }, FRAME_MS);
    return () => window.clearInterval(timer);
  }, [playing, speed, now]);

  // Road statuses at t, for the map and legend.
  const busy = useMemo(() => busyAt(episodes, t), [episodes, t]);
  useEffect(() => {
    const roads = new Set(episodes.map((e) => e.road));
    const status: Record<string, string> = {};
    for (const r of roads) status[r] = busy.has(r) ? 'busy' : 'neutral';
    onStatus(status);
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  // Alert starts in range, as ticks above the slider.
  const ticks = useMemo(
    () => episodes
      .map((e) => Date.parse(e.start))
      .filter((s) => s >= from && s <= now)
      .map((s) => ((s - from) / (now - from)) * 100),
    [episodes, from, now],
  );

  const togglePlay = () => {
    if (!playing && t >= now) setT(from); // at the end: start over
    setPlaying(!playing);
  };

  return (
    <div className="playback" role="region" aria-label="Playback">
      <div className="pb-row">
        <button className="pb-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="pb-clock">
          <b>{fmtTime(new Date(t).toISOString(), tz)}</b>
          <span className="muted small">{tzName}</span>
        </div>
        <span className={`pb-count ${busy.size ? 'busy' : ''}`}>{busy.size} active</span>
        <span className="pb-spacer" />
        <select value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label="Playback range">
          {PLAYBACK_RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
          {SPEEDS.map((s) => <option key={s.min} value={s.min}>{s.label}</option>)}
        </select>
        <button className="icon" onClick={onClose} aria-label="Close playback" title="Back to live">✕</button>
      </div>
      <div className="pb-track">
        <div className="pb-ticks" aria-hidden="true">
          {ticks.map((x, i) => <span key={i} style={{ left: `${x}%` }} />)}
        </div>
        <input
          type="range"
          min={from}
          max={now}
          step={60_000}
          value={Math.min(Math.max(t, from), now)}
          onChange={(e) => {
            setPlaying(false);
            setT(Number(e.target.value));
          }}
          aria-label="Playback time"
        />
        <div className="pb-ends muted small">
          <span>{fmtTime(new Date(from).toISOString(), tz)}</span>
          <span>now</span>
        </div>
      </div>
    </div>
  );
}
