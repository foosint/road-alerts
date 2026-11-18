import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeatureCollection, LineString, Point } from 'geojson';

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

/** How often the GeoJSON in this repo is re-checked. */
export const POLL_MS = 60_000;

/**
 * Where roads.geojson / cities.geojson live. Production builds get VITE_DATA_URL
 * (the road-alerts-data repo, see the deploy workflow); dev uses the local
 * sibling checkout served by vite.config.ts.
 */
export const DATA_URL: string = import.meta.env.VITE_DATA_URL || `${import.meta.env.BASE_URL}data/`;

async function fetchText(name: string): Promise<string> {
  // Unique query + no-store bypasses the browser cache.
  const res = await fetch(`${DATA_URL}${name}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.text();
}

export function useRoadData() {
  const [roads, setRoads] = useState<RoadsData | null>(null);
  const [cities, setCities] = useState<CitiesData | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [changedAt, setChangedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const last = useRef({ roads: '', cities: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([fetchText('roads.geojson'), fetchText('cities.geojson')]);
      // Only hand new objects to the map when the file content actually changed.
      if (r !== last.current.roads) {
        last.current.roads = r;
        setRoads(JSON.parse(r));
        setChangedAt(new Date());
      }
      if (c !== last.current.cities) {
        last.current.cities = c;
        setCities(JSON.parse(c));
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

  return { roads, cities, checkedAt, changedAt, error, loading, refresh };
}
