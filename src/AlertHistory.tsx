import { useMemo, useState, type ReactNode } from 'react';
import type { AlertEvent, AlertsData, RoadsData } from './data';
import { STATUS_COLORS, statusColor } from './colors';
import HourChart from './HourChart';
import {
  PERIODS, TIME_MODES, byHour, fmtDay, fmtDuration, fmtTime, inPeriod, isThreat, outcomes, roadName, tzOf,
  type Outcome, type Period, type TimeMode,
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
};

const PAGE = 100;

function IntentPill({ intent }: { intent: string }) {
  const color = intent === 'threat' ? STATUS_COLORS.busy : intent === 'clear' ? STATUS_COLORS.neutral : '#8a8f98';
  const label = intent === 'threat' ? 'Threat' : intent === 'clear' ? 'All clear' : intent;
  return <span className="pill" style={{ ['--c' as string]: color }}>{label}</span>;
}

function outcomeText(o: Outcome | undefined, busyNow: boolean) {
  if (!o) return null;
  if (o.kind === 'cleared') return `cleared after ${fmtDuration(o.ms)}`;
  if (o.kind === 'superseded') return 'repeated before clear';
  return busyNow ? 'active now' : null;
}

export default function AlertHistory(p: Props) {
  const { alerts, roads, selectedId, onSelect, timeMode, period } = p;
  const [tab, setTab] = useState<'log' | 'hours'>('log');
  const [limit, setLimit] = useState(PAGE);
  const tz = tzOf(timeMode);
  const tzLabel = timeMode === 'road' ? 'MSK' : 'your time';

  const feature = (id: string) => roads?.features.find((f) => f.properties.id === id)?.properties;
  const busyNow = (id: string) => {
    const s = feature(id)?.status;
    return !!s && s !== 'neutral';
  };
  const name = (id: string) => roadName(alerts, id, feature(id));

  const results = useMemo(() => outcomes(alerts), [alerts]);
  const events = useMemo(() => inPeriod(alerts?.events ?? [], period), [alerts, period]);
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
    const own = events.filter((e) => e.roads.includes(selectedId));
    const threats = own.filter(isThreat);
    const cleared = threats
      .map((e) => results.get(`${e.id}|${selectedId}`))
      .flatMap((o) => (o?.kind === 'cleared' ? [o.ms] : []))
      .sort((a, b) => a - b);
    const median = cleared.length ? cleared[Math.floor(cleared.length / 2)] : null;
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
          <div><b>{threats.length}</b><span>alerts</span></div>
          <div><b>{median === null ? '—' : fmtDuration(median)}</b><span>median until clear</span></div>
          <div><b>{threats.length ? fmtTime(threats[threats.length - 1].at, tz) : '—'}</b><span>last alert</span></div>
        </div>
        <h3>Alerts by hour of day <span className="muted">({tzLabel})</span></h3>
        <HourChart counts={byHour(own, tz)} tzLabel={tzLabel} />
        <h3>History</h3>
        <EventList
          events={own} tz={tz} limit={limit} setLimit={setLimit}
          render={(e) => <span className="muted">{outcomeText(results.get(`${e.id}|${selectedId}`), busyNow(selectedId))}</span>}
        />
      </div>
    );
  }

  // ---- all roads
  return (
    <div className="history">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>Log</button>
        <button role="tab" aria-selected={tab === 'hours'} onClick={() => setTab('hours')}>By hour</button>
      </div>
      {controls}
      {since && <div className="muted small">Recorded since {fmtDay(since, tz)}</div>}
      {tab === 'log' ? (
        <EventList
          events={events} tz={tz} limit={limit} setLimit={setLimit}
          render={(e) => (
            <ul className="event-roads">
              {e.roads.map((r) => (
                <li key={r}>
                  <button className="link" onClick={() => onSelect(r)}>{name(r)}</button>
                  {isThreat(e) && <span className="muted"> {outcomeText(results.get(`${e.id}|${r}`), busyNow(r))}</span>}
                </li>
              ))}
            </ul>
          )}
        />
      ) : (
        <Overview events={events} tz={tz} tzLabel={tzLabel} name={name} onSelect={onSelect} />
      )}
    </div>
  );
}

function EventList({ events, tz, limit, setLimit, render }: {
  events: AlertEvent[];
  tz: string | undefined;
  limit: number;
  setLimit: (n: number) => void;
  render: (e: AlertEvent) => ReactNode;
}) {
  if (!events.length) return <div className="muted small">No alerts in this period.</div>;
  const shown = events.slice(-limit).reverse(); // newest first
  let day = '';
  return (
    <div className="events">
      {shown.map((e) => {
        const d = fmtDay(e.at, tz);
        const head = d !== day ? (day = d) : null;
        return (
          <div key={e.id}>
            {head && <div className="day">{head}</div>}
            <div className="event">
              <time dateTime={e.at} title={e.at}>{fmtTime(e.at, tz, false)}</time>
              <div>
                <IntentPill intent={e.intent} />
                {render(e)}
              </div>
            </div>
          </div>
        );
      })}
      {events.length > limit && (
        <button className="more" onClick={() => setLimit(limit + PAGE)}>
          Show older ({events.length - limit} more)
        </button>
      )}
    </div>
  );
}

function Overview({ events, tz, tzLabel, name, onSelect }: {
  events: AlertEvent[];
  tz: string | undefined;
  tzLabel: string;
  name: (id: string) => string;
  onSelect: (id: string) => void;
}) {
  const threats = events.filter(isThreat);
  const perRoad = new Map<string, number>();
  for (const e of threats) for (const r of e.roads) perRoad.set(r, (perRoad.get(r) ?? 0) + 1);
  const top = [...perRoad.entries()].sort((a, b) => b[1] - a[1]);
  const max = top[0]?.[1] ?? 1;
  return (
    <>
      <div className="stats">
        <div><b>{threats.length}</b><span>alerts</span></div>
        <div><b>{perRoad.size}</b><span>roads affected</span></div>
      </div>
      <h3>Alerts by hour of day <span className="muted">({tzLabel})</span></h3>
      <HourChart counts={byHour(events, tz)} tzLabel={tzLabel} />
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
