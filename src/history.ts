import type { AlertEvent, AlertsData } from './data';

/**
 * Times are shown either as the local clock time where the road is, or in the viewer's own zone.
 *
 * ROAD_TZ is the clock time in use on all roads in the feed (Crimea, Kherson, Zaporizhzhia,
 * Donetsk and Luhansk regions): UTC+3 all year. A road that keeps a different time can be
 * listed in ROAD_TZ_BY_ROAD with its IANA zone.
 */
export const ROAD_TZ = 'Europe/Moscow';
const ROAD_TZ_BY_ROAD: Record<string, string> = {};

/** The time zone to show a road's times in; undefined = the viewer's own. */
export type TzFor = (roadId?: string) => string | undefined;
export const roadTz: TzFor = (roadId) => (roadId && ROAD_TZ_BY_ROAD[roadId]) || ROAD_TZ;

/** Kyiv time (UTC+2, UTC+3 in summer). Older browsers only know the old name Europe/Kiev. */
export const KYIV_TZ = (() => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: 'Europe/Kyiv' });
    return 'Europe/Kyiv';
  } catch {
    return 'Europe/Kiev';
  }
})();

export type TimeMode = 'road' | 'kyiv' | 'local';
export function tzFor(mode: TimeMode): TzFor {
  if (mode === 'road') return roadTz;
  if (mode === 'kyiv') return () => KYIV_TZ;
  return () => undefined;
}
/** The first entry is the default. */
export const TIME_MODES: { id: TimeMode; label: string }[] = [
  { id: 'kyiv', label: 'Kyiv time' },
  { id: 'road', label: 'Local time on the road' },
  { id: 'local', label: 'My time' },
];

/** "UTC+3" for a zone at the given moment (default now). */
export function utcOffset(tz: string | undefined, at = new Date()): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find((x) => x.type === 'timeZoneName')?.value ?? '';
  return name === 'GMT' ? 'UTC' : name.replace('GMT', 'UTC');
}

/** Label for times shown with tzFor(mode) for the given roads. */
export function tzLabel(mode: TimeMode, roadIds: string[]): string {
  if (mode === 'local') return `your time, ${utcOffset(undefined)}`;
  if (mode === 'kyiv') return `Kyiv time, ${utcOffset(KYIV_TZ)}`;
  const offsets = new Set(roadIds.map((r) => utcOffset(roadTz(r))));
  return offsets.size === 1 ? `local time, ${[...offsets][0]}` : 'local time of each road';
}

export type Period = '1' | '3' | '7' | '30' | 'all';
export const PERIODS: { id: Period; label: string }[] = [
  { id: '1', label: 'Last day' },
  { id: '3', label: 'Last 3 days' },
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

/**
 * Threat activations per hour of day (0-23), in the time zone of the event's road.
 * Each activation counts once, however many roads it covers.
 */
export function byHour(events: AlertEvent[], tz: TzFor): number[] {
  const counts = new Array<number>(24).fill(0);
  for (const e of events) if (isThreat(e)) counts[hourOf(e.at, tz(e.roads[0]))] += 1;
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
