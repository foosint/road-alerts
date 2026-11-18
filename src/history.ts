import type { AlertEvent, AlertsData } from './data';

/** Times on the map are shown either in the time zone of the roads or in the viewer's own. */
export const ROAD_TZ = 'Europe/Moscow';
export type TimeMode = 'road' | 'local';
export const tzOf = (mode: TimeMode) => (mode === 'road' ? ROAD_TZ : undefined);
export const TIME_MODES: { id: TimeMode; label: string }[] = [
  { id: 'road', label: 'Road time (MSK)' },
  { id: 'local', label: 'My time' },
];

export type Period = '7' | '30' | 'all';
export const PERIODS: { id: Period; label: string }[] = [
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' },
  { id: 'all', label: 'All time' },
];

export const isThreat = (e: AlertEvent) => e.intent === 'threat';

export function inPeriod(events: AlertEvent[], period: Period, now = Date.now()): AlertEvent[] {
  if (period === 'all') return events;
  const from = now - Number(period) * 86_400_000;
  return events.filter((e) => Date.parse(e.at) >= from);
}

/**
 * What happened after each threat on each road: cleared (with duration), replaced by a
 * newer threat, or still open. Key: `${eventId}|${roadId}`.
 */
export type Outcome = { kind: 'cleared'; ms: number } | { kind: 'superseded' } | { kind: 'open' };

export function outcomes(alerts: AlertsData | null): Map<string, Outcome> {
  const res = new Map<string, Outcome>();
  const open = new Map<string, AlertEvent>(); // road -> last threat without an answer yet
  for (const e of alerts?.events ?? []) {
    for (const road of e.roads) {
      const prev = open.get(road);
      if (prev) {
        res.set(`${prev.id}|${road}`, e.intent === 'clear'
          ? { kind: 'cleared', ms: Date.parse(e.at) - Date.parse(prev.at) }
          : { kind: 'superseded' });
        open.delete(road);
      }
      if (isThreat(e)) {
        open.set(road, e);
        res.set(`${e.id}|${road}`, { kind: 'open' });
      }
    }
  }
  return res;
}

const hourFormatters = new Map<string, Intl.DateTimeFormat>();
function hourOf(iso: string, tz: string | undefined): number {
  const key = tz ?? 'local';
  let f = hourFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz });
    hourFormatters.set(key, f);
  }
  return Number(f.format(new Date(iso))) % 24;
}

/** Threat activations per hour of day (0-23). Each activation counts once, however many roads it covers. */
export function byHour(events: AlertEvent[], tz: string | undefined): number[] {
  const counts = new Array<number>(24).fill(0);
  for (const e of events) if (isThreat(e)) counts[hourOf(e.at, tz)] += 1;
  return counts;
}

export function fmtTime(iso: string | null | undefined, tz: string | undefined, withDate = true): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    timeZone: tz,
    ...(withDate ? { day: '2-digit', month: 'short' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

export function fmtDay(iso: string, tz: string | undefined): string {
  return new Date(iso).toLocaleDateString(undefined, {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return '<1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export const roadName = (alerts: AlertsData | null, id: string, fallback?: { from: string; to: string }) => {
  const r = fallback ?? alerts?.roads[id];
  return r ? `${r.from} → ${r.to}` : id;
};
