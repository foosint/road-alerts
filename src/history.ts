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
  { id: 'local', label: 'My time' },
  { id: 'road', label: 'Local Russian time (MSK)' },
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
  return offsets.size === 1 ? `MSK, ${[...offsets][0]}` : 'local time of each road';
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

/**
 * One alert on one road: from its first threat until it ended.
 *
 * - clear:   ended by an "all clear" activation
 * - ended:   the road went back to neutral without an all clear (the usual case)
 * - ongoing: the road is still busy
 * - unknown: no end was recorded (only possible before `statusSince`, when status
 *            changes were not logged yet, or if the road left the feed)
 *
 * A new threat while the alert is still running (no clear and no neutral status in
 * between) renews it instead of starting a new one.
 */
export type Episode = {
  key: string;
  road: string;
  start: string;
  end: string | null;
  how: 'clear' | 'ended' | 'ongoing' | 'unknown';
  renewals: number;
};

export function episodes(alerts: AlertsData | null, statusNow: (road: string) => string | undefined): Episode[] {
  if (!alerts) return [];
  const since = alerts.statusSince ? Date.parse(alerts.statusSince) : Infinity;
  type Item = { at: string; kind: 'threat' | 'clear' | 'neutral'; id: string };
  const perRoad = new Map<string, Item[]>();
  const add = (road: string, item: Item) => {
    const list = perRoad.get(road);
    if (list) list.push(item);
    else perRoad.set(road, [item]);
  };
  for (const e of alerts.events) {
    if (e.intent !== 'threat' && e.intent !== 'clear') continue;
    for (const road of e.roads) add(road, { at: e.at, kind: e.intent, id: e.id });
  }
  for (const c of alerts.changes ?? []) {
    if (c.status === 'neutral') add(c.road, { at: c.at, kind: 'neutral', id: `s${c.at}` });
  }

  const out: Episode[] = [];
  for (const [road, items] of perRoad) {
    items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    let open: Episode | null = null;
    for (const it of items) {
      if (it.kind === 'threat') {
        if (open && Date.parse(open.start) >= since) {
          open.renewals += 1; // status was logged and the road never went neutral: same alert
          continue;
        }
        if (open) out.push(open); // before status logging: end unknown
        open = { key: `${it.id}|${road}`, road, start: it.at, end: null, how: 'unknown', renewals: 0 };
      } else if (open) {
        open.end = it.at;
        open.how = it.kind === 'clear' ? 'clear' : 'ended';
        out.push(open);
        open = null;
      }
    }
    if (open) {
      const s = statusNow(road);
      if (s && s !== 'neutral') open.how = 'ongoing';
      out.push(open);
    }
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** How long an alert lasted (or has lasted so far); null if its end is unknown. */
export function episodeMs(e: Episode, now = Date.now()): number | null {
  if (e.how === 'unknown') return null;
  return (e.end ? Date.parse(e.end) : now) - Date.parse(e.start);
}

export function inPeriod(list: Episode[], period: Period, now = Date.now()): Episode[] {
  if (period === 'all') return list;
  const from = now - Number(period) * 86_400_000;
  return list.filter((e) => Date.parse(e.start) >= from || e.how === 'ongoing'); // began in the period, or still running
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

/** Alerts per hour of day (0-23) in which they began, in the time zone of their road. */
export function byHour(list: Episode[], tz: TzFor): number[] {
  const counts = new Array<number>(24).fill(0);
  for (const e of list) counts[hourOf(e.start, tz(e.road))] += 1;
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
