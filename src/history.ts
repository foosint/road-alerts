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

export type Period = 'today' | '1' | '3' | '7' | '30' | 'all';
export const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
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
 * - ended:   the road went back to neutral (by an "all clear" activation or a status change,
 *            whichever came first)
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
  how: 'ended' | 'ongoing' | 'unknown';
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
    if (c.status !== 'busy') add(c.road, { at: c.at, kind: 'neutral', id: `s${c.at}` });
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
        open.how = 'ended';
        out.push(open);
        open = null;
      }
    }
    if (open) {
      const s = statusNow(road);
      if (s === 'busy') open.how = 'ongoing';
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

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
/** Calendar day (YYYY-MM-DD) of a moment in a time zone. */
function dayKey(t: string | number, tz: string | undefined): string {
  const key = tz ?? 'local';
  let f = dayFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(key, f);
  }
  return f.format(new Date(t));
}

/**
 * Alerts that began in the period, plus any still running. "today" means since midnight
 * in the selected time zone (for each alert, the zone of its road).
 */
/**
 * Alerts that began in the period, plus every running alert. Periods are whole calendar days in
 * the road's time zone: "Last day" is yesterday and today so far, "Last 3 days" the 3 days before
 * today and today, so a day is never cut in half and every view counts the same alerts.
 */
export function inPeriod(list: Episode[], period: Period, now: number, tz: TzFor): Episode[] {
  if (period === 'all') return list;
  const starts = new Map<string, number>(); // period start per time zone
  const from = (zone: string | undefined) => {
    const key = zone ?? '';
    if (!starts.has(key)) starts.set(key, periodStart(period, now, zone, list));
    return starts.get(key)!;
  };
  return list.filter((e) => e.how === 'ongoing' || Date.parse(e.start) >= from(tz(e.road)));
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

// ---------------------------------------------------------------- playback

/** Midnight at the start of the day containing `t`, in the given time zone (epoch ms). */
export function startOfDay(t: number, tz: string | undefined): number {
  const [y, m, d] = dayKey(t, tz).split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d); // midnight UTC of that calendar day
  // Shift by the zone's offset at that moment: wall-clock time in tz minus UTC.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(guess));
  const n = (type: string) => Number(parts.find((x) => x.type === type)?.value);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return guess - (wall - guess);
}

/** Roads with a running alert at moment `t`. Alerts with an unknown end are left out. */
export function busyAt(list: Episode[], t: number): Set<string> {
  const busy = new Set<string>();
  for (const e of list) {
    if (e.how === 'unknown' || Date.parse(e.start) > t) continue;
    if (e.end === null || Date.parse(e.end) > t) busy.add(e.road);
  }
  return busy;
}

// ---------------------------------------------------------------- trends

export type Grain = 'day' | 'week' | 'month';
export const GRAINS: { id: Grain; label: string; current: string; previous: string }[] = [
  { id: 'day', label: 'Daily', current: 'Today', previous: 'Yesterday' },
  { id: 'week', label: 'Weekly', current: 'This week', previous: 'Last week' },
  { id: 'month', label: 'Monthly', current: 'This month', previous: 'Last month' },
];

/** A day, week (Monday to Sunday) or month, with the alerts that began in it. */
export type Bucket = { key: string; label: string; short: string; items: Episode[] };

const ymd = (key: string) => key.split('-').map(Number);
const utcDay = (key: string) => {
  const [y, m, d] = ymd(key);
  return Date.UTC(y, m - 1, d);
};
const keyOfUtc = (t: number) => new Date(t).toISOString().slice(0, 10);
const fmtUtc = (t: number, o: Intl.DateTimeFormatOptions) => new Date(t).toLocaleDateString(undefined, { timeZone: 'UTC', ...o });

/** The bucket a calendar day (YYYY-MM-DD) belongs to. */
function bucketKey(day: string, grain: Grain): string {
  if (grain === 'day') return day;
  if (grain === 'month') return day.slice(0, 7);
  const t = utcDay(day);
  const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * 86_400_000;
  return keyOfUtc(monday);
}

function bucketLabels(key: string, grain: Grain): { label: string; short: string } {
  if (grain === 'month') {
    const [y, m] = ymd(key);
    const t = Date.UTC(y, m - 1, 1);
    return { label: fmtUtc(t, { month: 'long', year: 'numeric' }), short: fmtUtc(t, { month: 'short' }) };
  }
  const t = utcDay(key);
  const short = fmtUtc(t, { day: 'numeric', month: 'numeric' });
  if (grain === 'day') return { label: fmtUtc(t, { weekday: 'short', day: 'numeric', month: 'short' }), short };
  return { label: `Week of ${fmtUtc(t, { day: 'numeric', month: 'short' })}`, short };
}

/** Start of the selected period (epoch ms); "all" starts at the oldest alert. */
/** Start of the period: midnight of its first calendar day in `tz` (see inPeriod). */
export function periodStart(period: Period, now: number, tz: string | undefined, list: Episode[]): number {
  if (period === 'all') return list.length ? Math.min(now, Date.parse(list[0].start)) : now;
  const days = period === 'today' ? 0 : Number(period);
  // Noon today minus N days lands on the right calendar day even across a DST change.
  return startOfDay(startOfDay(now, tz) + 12 * 3_600_000 - days * 86_400_000, tz);
}

/**
 * Every day/week/month from `from` to `now` (also empty ones), with the alerts that began in it.
 * Calendar days are taken in time zone `tz`.
 */
export function buckets(list: Episode[], grain: Grain, from: number, now: number, tz: string | undefined): Bucket[] {
  const out: Bucket[] = [];
  const index = new Map<string, Bucket>();
  const last = dayKey(now, tz);
  for (let t = utcDay(dayKey(from, tz)); ; t += 86_400_000) {
    const day = keyOfUtc(t);
    const key = bucketKey(day, grain);
    if (!index.has(key)) {
      const b = { key, ...bucketLabels(key, grain), items: [] };
      index.set(key, b);
      out.push(b);
    }
    if (day >= last) break;
  }
  for (const e of list) index.get(bucketKey(dayKey(e.start, tz), grain))?.items.push(e);
  return out;
}

/** Axis labels: about five, evenly spread, always including the last bar. */
export function spreadTicks(labels: string[], count = 5): { i: number; text: string }[] {
  if (labels.length <= count) return labels.map((text, i) => ({ i, text }));
  const step = Math.ceil(labels.length / count);
  const ticks: { i: number; text: string }[] = [];
  for (let i = labels.length - 1; i >= 0; i -= step) ticks.unshift({ i, text: labels[i] });
  return ticks;
}

// ---------------------------------------------------------------- durations

/** Duration in minutes of a finished alert; null while running or if its end is unknown. */
export const durationMin = (e: Episode): number | null =>
  e.how === 'ended' && e.end ? (Date.parse(e.end) - Date.parse(e.start)) / 60_000 : null;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export const average = (values: number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

/** Duration classes for the distribution chart, in minutes. */
export const DURATION_BINS: { label: string; max: number }[] = [
  { label: '<15 min', max: 15 },
  { label: '15–30 min', max: 30 },
  { label: '30–60 min', max: 60 },
  { label: '1–2 h', max: 120 },
  { label: '2–4 h', max: 240 },
  { label: '4–8 h', max: 480 },
  { label: '8 h+', max: Infinity },
];

export function durationBins(minutes: number[]): number[] {
  const counts = DURATION_BINS.map(() => 0);
  for (const m of minutes) counts[DURATION_BINS.findIndex((b) => m < b.max)] += 1;
  return counts;
}

/** Minutes as "45 min", "1 h 30 min", … */
export const fmtMin = (m: number) => fmtDuration(m * 60_000);
