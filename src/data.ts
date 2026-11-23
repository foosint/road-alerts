import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeatureCollection, LineString, Point } from 'geojson';
import { twoState } from './colors';

export type RoadProps = {
  id: string;
  from: string;
  to: string;
  fromCityId: string;
  toCityId: string;
  status: string;
  updatedAt: string | null;
  activeAlert: unknown;
  roadGroupIds: string[];
  distance_km: number;
  stroke: string;
};

export type RoadsData = FeatureCollection<LineString, RoadProps> & {
  source?: { updatedAt?: string; freshness?: string; kind?: string };
  generatedAt?: string;
};

export type CityProps = { id: string; name: string };
export type CitiesData = FeatureCollection<Point, CityProps>;

/** One alert activation from data/alerts.json; it can cover several roads. */
export type AlertEvent = { id: string; intent: string; at: string; roads: string[] };
/** A road's status changed (e.g. busy -> neutral) at `at`. */
export type StatusChange = { road: string; status: string; from: string; at: string };
export type AlertsData = {
  /** Names of every road ever seen, including roads no longer in the feed. */
  roads: Record<string, { from: string; to: string }>;
  /** Activations, oldest first. */
  events: AlertEvent[];
  /** Status changes, oldest first; recorded from `statusSince` on (older logs have neither). */
  changes?: StatusChange[];
  statusSince?: string;
};

/** A NASA FIRMS hotspot near a road, from data/fires.geojson. */
export type FireProps = {
  id: string;
  /** Satellite overpass time (UTC). */
  t: string;
  /** t in ms, added on load. */
  ms: number;
  sat: string;
  conf: 'low' | 'nominal' | 'high' | null;
  /** Fire radiative power in MW. */
  frp: number | null;
  day: boolean;
  /** Nearest road and the distance to it. */
  road: string;
  km: number;
};
export type FiresData = FeatureCollection<Point, FireProps> & { maxKm?: number; hours?: number; updatedAt?: string };

/** A bridge or river crossing on a road segment, from data/bridges.geojson (OpenStreetMap). */
export type BridgeKind = 'river' | 'other' | 'crossing';
export type BridgeProps = {
  id: string;
  /** river: bridge over a river or canal; other: overpass, viaduct, ...; crossing: river with no bridge in OSM. */
  kind: BridgeKind;
  /** Road ids (MapLibre may hand this over as a JSON string). */
  roads: string[] | string;
  name?: string;
  /** Name of the street or road the bridge carries. */
  street?: string;
  ref?: string;
  river?: string;
  waterway?: string;
  /** OSM bridge type when not a plain bridge, e.g. viaduct. */
  structure?: string;
  length_m?: number;
  destroyed?: boolean;
  /** OSM way ids of the bridge (MapLibre may hand this over as a JSON string). */
  osm?: number[] | string;
  osm_river?: number;
};
export type BridgesData = FeatureCollection<Point, BridgeProps> & { generatedAt?: string; source?: string };

/**
 * How often the data is re-checked. Each check costs one GitHub API request, and GitHub
 * allows 60 an hour per IP without login, so this stays above 60 s (leaves room for Refresh).
 */
export const POLL_MS = 90_000;

/**
 * Where roads.geojson / cities.geojson live. Production builds get VITE_DATA_URL
 * (the road-alerts-data repo, see the deploy workflow); dev uses the local
 * sibling checkout served by vite.config.ts.
 */
export const DATA_URL: string = import.meta.env.VITE_DATA_URL || `${import.meta.env.BASE_URL}data/`;

/**
 * raw.githubusercontent.com caches a branch URL (…/main/data/…) for up to 5 minutes and
 * ignores query strings, so it can serve stale data. A URL with a commit hash instead of
 * the branch name always serves exactly that commit. So when DATA_URL points at
 * raw.githubusercontent.com, each check first asks the GitHub API for the branch's latest
 * commit and then loads the files of that commit.
 */
const RAW = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/.exec(DATA_URL);

async function latestDataUrl(): Promise<string> {
  if (!RAW) return DATA_URL;
  const [, owner, repo, branch, path] = RAW;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${branch}`, {
      headers: { Accept: 'application/vnd.github.sha' }, // reply is just the hash
      cache: 'no-cache', // revalidate with GitHub every time
    });
    const sha = (await res.text()).trim();
    if (res.ok && /^[0-9a-f]{40}$/.test(sha)) {
      return `https://raw.githubusercontent.com/${owner}/${repo}/${sha}/${path}`;
    }
  } catch { /* offline or blocked */ }
  return DATA_URL; // e.g. rate limit reached: fall back to the branch URL (up to 5 min old)
}

async function fetchText(base: string, name: string, optional = false): Promise<string> {
  // A commit URL never changes, so the browser may cache it; otherwise bypass the browser cache.
  const pinned = base !== DATA_URL;
  const res = await fetch(pinned ? `${base}${name}` : `${base}${name}?t=${Date.now()}`, {
    cache: pinned ? 'default' : 'no-store',
  });
  if (optional && res.status === 404) return '';
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.text();
}

export function useRoadData() {
  const [roads, setRoads] = useState<RoadsData | null>(null);
  const [cities, setCities] = useState<CitiesData | null>(null);
  const [alerts, setAlerts] = useState<AlertsData | null>(null);
  const [fires, setFires] = useState<FiresData | null>(null);
  const [bridges, setBridges] = useState<BridgesData | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [changedAt, setChangedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const last = useRef({ roads: '', cities: '', alerts: '', fires: '', bridges: '' });
  const lastBase = useRef('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const base = await latestDataUrl();
      if (base !== DATA_URL && base === lastBase.current) {
        setError(null);
        return; // same commit as last time: nothing new to load
      }
      const [r, c, a, fi, br] = await Promise.all([
        fetchText(base, 'roads.geojson'),
        fetchText(base, 'cities.geojson'),
        fetchText(base, 'alerts.json', true), // missing until the data repo has its first alert log
        fetchText(base, 'fires.geojson', true).catch(() => last.current.fires), // extra: never fail the update
        fetchText(base, 'bridges.geojson', true).catch(() => last.current.bridges),
      ]);
      lastBase.current = base;
      // Only hand new objects to the map when the file content actually changed.
      if (r !== last.current.roads) {
        last.current.roads = r;
        const parsed: RoadsData = JSON.parse(r);
        for (const f of parsed.features) f.properties.status = twoState(f.properties.status);
        setRoads(parsed);
        setChangedAt(new Date());
      }
      if (c !== last.current.cities) {
        last.current.cities = c;
        setCities(JSON.parse(c));
      }
      if (a !== last.current.alerts) {
        last.current.alerts = a;
        setAlerts(a ? JSON.parse(a) : null);
      }
      if (fi !== last.current.fires) {
        last.current.fires = fi;
        const parsed: FiresData | null = fi ? JSON.parse(fi) : null;
        for (const f of parsed?.features ?? []) f.properties.ms = Date.parse(f.properties.t);
        setFires(parsed);
      }
      if (br !== last.current.bridges) {
        last.current.bridges = br;
        setBridges(br ? JSON.parse(br) : null);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckedAt(new Date());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    // Check immediately when the tab becomes visible again.
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return { roads, cities, alerts, fires, bridges, checkedAt, changedAt, error, loading, refresh };
}

// ---------------------------------------------------------------- Telegram reports

/** One road event from the telegram-monitor project (events.json, schema 1). */
export type TelegramEvent = {
  /** `<chatId>:<messageId>`, stable and unique. */
  id: string;
  /** When the message was posted (UTC). */
  at: string;
  source: string;
  url: string | null;
  /** English, written by a local LLM. */
  title: string;
  description: string;
  kind: 'report' | 'update' | 'warning' | string;
  reported: string | null;
  text: string | null;
  replyTo: string | null;
  copies: { source: string; url: string }[];
  edited: boolean;
};
export type TelegramData = {
  schema: number;
  generatedAt: string;
  windowDays: number;
  model?: string;
  sources: { key: string; name: string; url: string }[];
  /** Oldest first. */
  events: TelegramEvent[];
};

/** Off unless the build sets VITE_TELEGRAM_ENABLED=true: no tab and no requests. */
export const TELEGRAM_ENABLED = import.meta.env.VITE_TELEGRAM_ENABLED === 'true';
/**
 * Where events.json lives. Production: the raw branch URL of telegram-monitor-data. Dev: the local
 * preview folder served by vite.config.ts under /telegram-data/.
 */
export const TELEGRAM_DATA_URL: string =
  import.meta.env.VITE_TELEGRAM_DATA_URL ||
  (import.meta.env.DEV
    ? `${import.meta.env.BASE_URL}telegram-data/`
    : 'https://raw.githubusercontent.com/foosint/telegram-monitor-data/main/road-events/');
/**
 * The file is pushed at most every 5 minutes. It is loaded from the raw branch URL directly, without
 * a GitHub API check, so it costs nothing from the visitor's 60 API calls an hour.
 */
export const TELEGRAM_POLL_MS = 180_000;
const TELEGRAM_SCHEMA = 1;

/** The Telegram events; does nothing when the feature is off. `refresh` checks now. */
export function useTelegramData() {
  const [data, setData] = useState<TelegramData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef('');

  const refresh = useCallback(async () => {
    if (!TELEGRAM_ENABLED) return;
    try {
      // raw.githubusercontent.com ignores the query string and may serve a copy up to 5 min old: fine here.
      const res = await fetch(`${TELEGRAM_DATA_URL}events.json?t=${Date.now()}`, { cache: 'no-store' });
      if (res.status === 404) {
        setError(null);
        return; // no data yet; keep whatever we had
      }
      if (!res.ok) throw new Error(`events.json: HTTP ${res.status}`);
      const text = await res.text();
      if (text !== last.current) {
        const parsed: TelegramData = JSON.parse(text);
        if (Math.floor(parsed.schema) > TELEGRAM_SCHEMA) throw new Error(`events.json: unsupported schema ${parsed.schema}`);
        last.current = text;
        setData(parsed);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); // keep the last good copy
    }
  }, []);

  useEffect(() => {
    if (!TELEGRAM_ENABLED) return;
    refresh();
    const timer = window.setInterval(refresh, TELEGRAM_POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  return { data, error, refresh };
}
