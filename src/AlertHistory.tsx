import { useMemo, useState } from 'react';
import type { AlertsData, RoadsData } from './data';
import { STATUS_COLORS, statusColor } from './colors';
import HourChart from './HourChart';
import {
  PERIODS, TIME_MODES, byHour, episodeMs, episodes, fmtDay, fmtDuration, fmtTime, inPeriod, roadName, tzFor,
  tzLabel as zoneLabel, type Episode, type Period, type TimeMode, type TzFor,
} from './history';

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

const PAGE = 100;

export default function AlertHistory(p: Props) {
  const { alerts, roads, selectedId, onSelect, timeMode, period, now } = p;
  const [tab, setTab] = useState<'log' | 'hours'>('log');
  const [limit, setLimit] = useState(PAGE);
  const tz = tzFor(timeMode);

  const feature = (id: string) => roads?.features.find((f) => f.properties.id === id)?.properties;
  const name = (id: string) => roadName(alerts, id, feature(id));

  const all = useMemo(
    () => episodes(alerts, (id) => roads?.features.find((f) => f.properties.id === id)?.properties.status),
    [alerts, roads],
  );
  const list = useMemo(() => inPeriod(all, period, now), [all, period, now]);
  const since = alerts?.events[0]?.at;

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

  if (!alerts) {
    return <div className="muted small">No alert log yet. It appears after the data repo's next update.</div>;
  }

  // ---- one road
  if (selectedId) {
    const props = feature(selectedId);
    const own = list.filter((e) => e.road === selectedId);
    const known = own.map((e) => episodeMs(e, now)).filter((ms): ms is number => ms !== null).sort((a, b) => a - b);
    const median = known.length ? known[Math.floor(known.length / 2)] : null;
    const label = zoneLabel(timeMode, [selectedId]);
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
          <div><b>{median === null ? '—' : fmtDuration(median)}</b><span>median duration</span></div>
          <div><b>{own.length ? fmtTime(own[own.length - 1].start, tz(selectedId)) : '—'}</b><span>last alert</span></div>
        </div>
        <h3>Alerts by hour of day <span className="muted">({label})</span></h3>
        <HourChart counts={byHour(own, tz)} tzLabel={label} />
        <h3>History <span className="muted">({label})</span></h3>
        <AlertList list={own} tz={tz} now={now} limit={limit} setLimit={setLimit} statusSince={alerts.statusSince} />
      </div>
    );
  }

  // ---- all roads
  const label = zoneLabel(timeMode, Object.keys(alerts.roads));
  return (
    <div className="history">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>Log</button>
        <button role="tab" aria-selected={tab === 'hours'} onClick={() => setTab('hours')}>By hour</button>
      </div>
      {controls}
      {since && (
        <div className="muted small">
          Recorded since {fmtDay(since, tz(alerts.events[0].roads[0]))} · times in {label}
        </div>
      )}
      {tab === 'log' ? (
        <AlertList
          list={list} tz={tz} now={now} limit={limit} setLimit={setLimit}
          statusSince={alerts.statusSince} name={name} onSelect={onSelect}
        />
      ) : (
        <Overview list={list} tz={tz} tzLabel={label} name={name} onSelect={onSelect} />
      )}
    </div>
  );
}

/** "until 14:59 · all clear", "ongoing", … */
function endText(e: Episode, tz: string | undefined, statusSince?: string) {
  if (e.how === 'ongoing') return 'ongoing';
  if (e.how === 'unknown') {
    return statusSince && e.start < statusSince ? 'end not recorded' : 'end unknown';
  }
  const sameDay = fmtDay(e.start, tz) === fmtDay(e.end!, tz);
  return `until ${fmtTime(e.end, tz, !sameDay)}${e.how === 'clear' ? ' · all clear' : ''}`;
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

function Overview({ list, tz, tzLabel, name, onSelect }: {
  list: Episode[];
  tz: TzFor;
  tzLabel: string;
  name: (id: string) => string;
  onSelect: (id: string) => void;
}) {
  const perRoad = new Map<string, number>();
  for (const e of list) perRoad.set(e.road, (perRoad.get(e.road) ?? 0) + 1);
  const top = [...perRoad.entries()].sort((a, b) => b[1] - a[1]);
  const max = top[0]?.[1] ?? 1;
  const active = list.filter((e) => e.how === 'ongoing').length;
  return (
    <>
      <div className="stats">
        <div><b>{list.length}</b><span>alerts</span></div>
        <div><b>{perRoad.size}</b><span>roads affected</span></div>
        <div><b>{active}</b><span>active now</span></div>
      </div>
      <h3>Alerts by hour of day <span className="muted">({tzLabel})</span></h3>
      <HourChart counts={byHour(list, tz)} tzLabel={tzLabel} />
      <h3>Alerts per road</h3>
      <div className="ranking">
        {top.map(([r, n]) => (
          <button key={r} className="rank-row" onClick={() => onSelect(r)}>
            <span className="rank-name">{name(r)}</span>
            <span className="rank-bar"><span style={{ width: `${(n / max) * 100}%` }} /></span>
            <span className="rank-n">{n}</span>
          </button>
        ))}
      </div>
    </>
  );
}
