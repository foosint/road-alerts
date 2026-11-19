import { useMemo, useState, type ReactNode } from 'react';
import type { AlertsData, RoadsData } from './data';
import { STATUS_COLORS, statusColor } from './colors';
import BarChart from './BarChart';
import HourChart from './HourChart';
import {
  DURATION_BINS, GRAINS, PERIODS, TIME_MODES, average, buckets, byHour, durationBins, durationMin, episodeMs, episodes,
  fmtDay, fmtDuration, fmtMin, fmtTime, inPeriod, median, periodStart, roadName, spreadTicks, tzFor,
  tzLabel as zoneLabel, type Bucket, type Episode, type Grain, type Period, type TimeMode, type TzFor,
} from './history';

/** Compact duration for bar labels: "45m", "1h11". */
const shortMin = (m: number) => {
  const r = Math.round(m);
  return r < 60 ? `${r}m` : `${Math.floor(r / 60)}h${String(r % 60).padStart(2, '0')}`;
};

type Props = {
  alerts: AlertsData | null;
  roads: RoadsData | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  timeMode: TimeMode;
  setTimeMode: (m: TimeMode) => void;
  period: Period;
  setPeriod: (p: Period) => void;
  /** Ticks regularly, so running alerts show an up-to-date duration. */
  now: number;
};

type Tab = 'log' | 'hours' | 'trend' | 'duration';
const TABS: { id: Tab; label: string }[] = [
  { id: 'log', label: 'Log' },
  { id: 'hours', label: 'By hour' },
  { id: 'trend', label: 'Trend' },
  { id: 'duration', label: 'Duration' },
];

const PAGE = 100;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function AlertHistory(p: Props) {
  const { alerts, roads, selectedId, onSelect, timeMode, period, now } = p;
  const [tab, setTab] = useState<Tab>('log');
  const [grain, setGrain] = useState<Grain>('day');
  const [limit, setLimit] = useState(PAGE);
  const tz = tzFor(timeMode);

  const feature = (id: string) => roads?.features.find((f) => f.properties.id === id)?.properties;
  const name = (id: string) => roadName(alerts, id, feature(id));

  const all = useMemo(
    () => episodes(alerts, (id) => roads?.features.find((f) => f.properties.id === id)?.properties.status),
    [alerts, roads],
  );
  const list = useMemo(() => inPeriod(all, period, now, tz), [all, period, now, timeMode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!alerts) {
    return <div className="muted small">No alert log yet. It appears after the data repo's next update.</div>;
  }

  const own = selectedId ? list.filter((e) => e.road === selectedId) : list;
  const label = zoneLabel(timeMode, selectedId ? [selectedId] : Object.keys(alerts.roads));
  // Calendar days for the trend charts are taken in the selected zone (of the road, if one is selected).
  const zone = tz(selectedId ?? undefined);
  const from = periodStart(period, now, zone, own);

  const controls = (
    <div className="history-controls">
      <select value={period} onChange={(e) => p.setPeriod(e.target.value as Period)} aria-label="Period">
        {PERIODS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
      <select value={timeMode} onChange={(e) => p.setTimeMode(e.target.value as TimeMode)} aria-label="Time zone">
        {TIME_MODES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
    </div>
  );
  const tabs = (
    <div className="tabs" role="tablist">
      {TABS.map((t) => (
        <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
      ))}
    </div>
  );
  const grainSelect = (
    <div className="segmented" role="group" aria-label="Group by">
      {GRAINS.map((g) => (
        <button key={g.id} aria-pressed={grain === g.id} onClick={() => setGrain(g.id)}>{g.label}</button>
      ))}
    </div>
  );

  let content;
  if (tab === 'log') {
    content = (
      <AlertList
        list={own} tz={tz} now={now} limit={limit} setLimit={setLimit} statusSince={alerts.statusSince}
        name={selectedId ? undefined : name} onSelect={selectedId ? undefined : onSelect}
      />
    );
  } else if (tab === 'hours') {
    content = <HoursTab list={own} tz={tz} tzLabel={label} name={name} onSelect={selectedId ? undefined : onSelect} />;
  } else {
    const bs = buckets(own, grain, from, now, zone);
    content = tab === 'trend'
      ? <TrendTab bs={bs} grain={grain} control={grainSelect} name={name} onSelect={selectedId ? undefined : onSelect} />
      : <DurationTab list={own} bs={bs} grain={grain} control={grainSelect} name={name} onSelect={selectedId ? undefined : onSelect} />;
  }

  // ---- one road
  if (selectedId) {
    const props = feature(selectedId);
    const known = own.map((e) => episodeMs(e, now)).filter((ms): ms is number => ms !== null);
    const med = median(known);
    return (
      <div className="history">
        <button className="link back" onClick={() => onSelect(null)}>← All roads</button>
        <div className="road-head">
          <h2>{name(selectedId)}</h2>
          {props && (
            <span className="pill" style={{ ['--c' as string]: statusColor(props.status, props.stroke) }}>{props.status}</span>
          )}
        </div>
        {controls}
        <div className="stats">
          <div><b>{own.length}</b><span>alerts</span></div>
          <div><b>{med === null ? '—' : fmtDuration(med)}</b><span>median duration</span></div>
          <div><b>{own.length ? fmtTime(own[own.length - 1].start, tz(selectedId)) : '—'}</b><span>last alert</span></div>
        </div>
        {tabs}
        <div className="muted small">Times in {label}</div>
        {content}
      </div>
    );
  }

  // ---- all roads
  const since = alerts.events[0]?.at;
  return (
    <div className="history">
      {tabs}
      {controls}
      {since && (
        <div className="muted small">
          Recorded since {fmtDay(since, tz(alerts.events[0].roads[0]))} · times in {label}
        </div>
      )}
      {content}
    </div>
  );
}

/** "until 14:59", "ongoing", … */
function endText(e: Episode, tz: string | undefined, statusSince?: string) {
  if (e.how === 'ongoing') return 'ongoing';
  if (e.how === 'unknown') {
    return statusSince && e.start < statusSince ? 'end not recorded' : 'end unknown';
  }
  const sameDay = fmtDay(e.start, tz) === fmtDay(e.end!, tz);
  return `until ${fmtTime(e.end, tz, !sameDay)}`;
}

/** One entry per alert per road, newest first, grouped by the day it began. */
function AlertList({ list, tz, now, limit, setLimit, statusSince, name, onSelect }: {
  list: Episode[];
  tz: TzFor;
  now: number;
  limit: number;
  setLimit: (n: number) => void;
  statusSince?: string;
  /** Given for the all-roads log: show and link the road of each entry. */
  name?: (id: string) => string;
  onSelect?: (id: string) => void;
}) {
  if (!list.length) return <div className="muted small">No alerts in this period.</div>;
  const shown = list.slice(-limit).reverse();
  let day = '';
  return (
    <div className="events">
      {shown.map((e) => {
        const zone = tz(e.road);
        const d = fmtDay(e.start, zone);
        const head = d !== day ? (day = d) : null;
        const ms = episodeMs(e, now);
        return (
          <div key={e.key}>
            {head && <div className="day">{head}</div>}
            <div className={`event ${e.how === 'ongoing' ? 'ongoing' : e.end ? 'ended' : ''}`}>
              <time dateTime={e.start} title={e.start}>{fmtTime(e.start, zone, false)}</time>
              <div>
                <span className="pill" style={{ ['--c' as string]: STATUS_COLORS.busy }}>Threat</span>
                <span className="duration">
                  {ms === null
                    ? '(duration unknown)'
                    : e.how === 'ongoing'
                      ? `(active for ${fmtDuration(ms)})`
                      : `(was active for ${fmtDuration(ms)})`}
                </span>
                {name && onSelect && (
                  <button className="link road" onClick={() => onSelect(e.road)}>{name(e.road)}</button>
                )}
                <span
                  className="muted end"
                  title={e.how === 'unknown' && statusSince ? `Alert ends are recorded since ${statusSince}` : undefined}
                >
                  {endText(e, zone, statusSince)}
                  {e.renewals > 0 && ` · renewed ${e.renewals}×`}
                </span>
              </div>
            </div>
          </div>
        );
      })}
      {list.length > limit && (
        <button className="more" onClick={() => setLimit(limit + PAGE)}>
          Show older ({list.length - limit} more)
        </button>
      )}
    </div>
  );
}

type TabProps = {
  name: (id: string) => string;
  /** Given in the all-roads view: per-road lists link to the road. */
  onSelect?: (id: string) => void;
};

function HoursTab({ list, tz, tzLabel, name, onSelect }: TabProps & { list: Episode[]; tz: TzFor; tzLabel: string }) {
  const perRoad = new Map<string, number>();
  for (const e of list) perRoad.set(e.road, (perRoad.get(e.road) ?? 0) + 1);
  const active = list.filter((e) => e.how === 'ongoing').length;
  return (
    <>
      {onSelect && (
        <div className="stats">
          <div><b>{list.length}</b><span>alerts</span></div>
          <div><b>{perRoad.size}</b><span>roads affected</span></div>
          <div><b>{active}</b><span>active now</span></div>
        </div>
      )}
      <h3>Alerts by hour of day <span className="muted">({tzLabel})</span></h3>
      <HourChart counts={byHour(list, tz)} tzLabel={tzLabel} />
      {onSelect && (
        <>
          <h3>Alerts per road</h3>
          <Ranking rows={[...perRoad.entries()].map(([r, n]) => ({ road: r, value: n, text: String(n) }))} name={name} onSelect={onSelect} />
        </>
      )}
    </>
  );
}

/** "▲ +3" (more alerts or longer), "▼ −2", "= 0"; colour plus arrow, never colour alone. */
function Delta({ cur, prev, fmt = String }: { cur: number | null; prev: number | null; fmt?: (v: number) => string }) {
  if (cur === null || prev === null) return <span className="delta">—</span>;
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return <span className="delta">= 0</span>;
  const pct = prev ? ` (${d > 0 ? '+' : '−'}${Math.round((Math.abs(d) / prev) * 100)}%)` : '';
  return (
    <span className={`delta ${d > 0 ? 'up' : 'down'}`}>
      {d > 0 ? '▲ +' : '▼ −'}{fmt(Math.abs(d))}{pct}
    </span>
  );
}

function TrendTab({ bs, grain, control, name, onSelect }: TabProps & { bs: Bucket[]; grain: Grain; control: ReactNode }) {
  const g = GRAINS.find((x) => x.id === grain)!;
  const counts = bs.map((b) => b.items.length);
  const cur = bs.at(-1);
  const prev = bs.at(-2);
  const avg = average(counts);
  const unit = grain === 'day' ? 'day' : grain;

  // Per road: alerts in the current and the previous day/week/month.
  const rows = new Map<string, { cur: number; prev: number }>();
  for (const [b, k] of [[cur, 'cur'], [prev, 'prev']] as const) {
    for (const e of b?.items ?? []) {
      const r = rows.get(e.road) ?? { cur: 0, prev: 0 };
      r[k] += 1;
      rows.set(e.road, r);
    }
  }
  const sorted = [...rows.entries()].sort((a, b) => b[1].cur - a[1].cur || b[1].prev - a[1].prev);

  return (
    <>
      {control}
      <div className="stats">
        <div><b>{cur?.items.length ?? 0}</b><span>{g.current.toLowerCase()} so far</span></div>
        <div><b>{prev ? prev.items.length : '—'}</b><span>{g.previous.toLowerCase()}</span></div>
        <div><b>{avg === null ? '—' : avg.toFixed(1)}</b><span>average per {unit}</span></div>
      </div>
      <div className="small">
        Change: <Delta cur={cur?.items.length ?? null} prev={prev?.items.length ?? null} />
        {!prev && <span className="muted"> · choose a longer period to compare</span>}
      </div>
      <h3>Alerts per {unit}</h3>
      <BarChart
        values={counts}
        labels={bs.map((b) => b.label)}
        ticks={spreadTicks(bs.map((b) => b.short))}
        tipValue={(v) => plural(v, 'alert')}
        ariaLabel={`Alerts per ${unit}: ${bs.map((b) => `${b.label} ${b.items.length}`).join(', ')}`}
        tableHead={[unit[0].toUpperCase() + unit.slice(1), 'Alerts']}
      />
      {onSelect && sorted.length > 0 && (
        <>
          <h3>Per road: {g.previous.toLowerCase()} → {g.current.toLowerCase()}</h3>
          <div className="ranking">
            {sorted.map(([r, v]) => (
              <button key={r} className="rank-row change-row" onClick={() => onSelect(r)}>
                <span className="rank-name">{name(r)}</span>
                <span className="rank-n">{prev ? v.prev : '—'} → {v.cur}</span>
                <Delta cur={v.cur} prev={prev ? v.prev : null} />
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function DurationTab({ list, bs, grain, control, name, onSelect }: TabProps & {
  list: Episode[]; bs: Bucket[]; grain: Grain; control: ReactNode;
}) {
  const g = GRAINS.find((x) => x.id === grain)!;
  const unit = grain === 'day' ? 'day' : grain;
  const mins = (items: Episode[]) => items.map(durationMin).filter((m): m is number => m !== null);
  const all = mins(list);
  const perBucket = bs.map((b) => median(mins(b.items)));
  const cur = perBucket.at(-1) ?? null;
  const prev = bs.length > 1 ? perBucket.at(-2) ?? null : null;
  const bins = durationBins(all);

  const perRoad = new Map<string, number[]>();
  for (const e of list) {
    const m = durationMin(e);
    if (m !== null) perRoad.set(e.road, [...(perRoad.get(e.road) ?? []), m]);
  }
  const roadRows = [...perRoad.entries()]
    .map(([r, ms]) => ({ road: r, value: median(ms)!, text: `${fmtMin(median(ms)!)} · ${ms.length}×` }))
    .sort((a, b) => b.value - a.value);

  return (
    <>
      <div className="stats">
        <div><b>{median(all) === null ? '—' : fmtMin(median(all)!)}</b><span>median</span></div>
        <div><b>{average(all) === null ? '—' : fmtMin(average(all)!)}</b><span>average</span></div>
        <div><b>{all.length ? fmtMin(Math.max(...all)) : '—'}</b><span>longest</span></div>
      </div>
      <div className="muted small">Finished alerts only ({all.length} of {list.length}).</div>
      {control}
      <div className="small">
        Median {g.current.toLowerCase()}: <b>{cur === null ? '—' : fmtMin(cur)}</b>
        {' · '}{g.previous.toLowerCase()}: <b>{prev === null ? '—' : fmtMin(prev)}</b>
        {' '}<Delta cur={cur} prev={prev} fmt={fmtMin} />
      </div>
      <h3>Median duration per {unit}</h3>
      <BarChart
        values={perBucket}
        labels={bs.map((b) => b.label)}
        ticks={spreadTicks(bs.map((b) => b.short))}
        fmt={fmtMin}
        barFmt={shortMin}
        tipExtra={(i) => plural(mins(bs[i].items).length, 'alert')}
        ariaLabel={`Median alert duration per ${unit}`}
        tableHead={[unit[0].toUpperCase() + unit.slice(1), 'Median duration']}
        emptyText="No finished alerts in this period."
      />
      <h3>How long alerts last</h3>
      <BarChart
        values={bins}
        labels={DURATION_BINS.map((b) => b.label)}
        ticks={DURATION_BINS.map((b, i) => ({ i, text: b.label.replace(' min', 'm').replace(' h', 'h') }))}
        tipValue={(v) => plural(v, 'alert')}
        tipExtra={(i) => `${all.length ? Math.round((bins[i] / all.length) * 100) : 0}%`}
        ariaLabel={`Alert durations: ${DURATION_BINS.map((b, i) => `${b.label} ${bins[i]}`).join(', ')}`}
        tableHead={['Duration', 'Alerts']}
        emptyText="No finished alerts in this period."
      />
      {onSelect && roadRows.length > 0 && (
        <>
          <h3>Median duration per road</h3>
          <Ranking rows={roadRows} name={name} onSelect={onSelect} />
        </>
      )}
    </>
  );
}

function Ranking({ rows, name, onSelect }: {
  rows: { road: string; value: number; text: string }[];
  name: (id: string) => string;
  onSelect: (id: string) => void;
}) {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const max = sorted[0]?.value || 1;
  return (
    <div className="ranking">
      {sorted.map((r) => (
        <button key={r.road} className="rank-row" onClick={() => onSelect(r.road)}>
          <span className="rank-name">{name(r.road)}</span>
          <span className="rank-bar"><span style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="rank-n">{r.text}</span>
        </button>
      ))}
    </div>
  );
}
