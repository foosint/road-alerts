import { useEffect, useRef } from 'react';
import maplibregl, {
  type ExpressionSpecification,
  type GeoJSONSource,
  type Map as MlMap,
  type StyleSpecification,
} from 'maplibre-gl';
import type { CitiesData, RoadProps, RoadsData } from './data';

export type Basemap = { id: string; label: string; tiles: string[]; attribution: string };

export const BASEMAPS: Basemap[] = [
  {
    id: 'osm',
    label: 'OSM',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    id: 'esri-streets',
    label: 'Esri Streets',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Tiles © Esri',
  },
  {
    id: 'esri-imagery',
    label: 'Esri Imagery',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
  },
];

const EMPTY = { type: 'FeatureCollection' as const, features: [] };
const IS_NEUTRAL: ExpressionSpecification = ['==', ['get', 'status'], 'neutral'];

function baseStyle(active: string): StyleSpecification {
  return {
    version: 8,
    sources: Object.fromEntries(
      BASEMAPS.map((b) => [b.id, { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: 19, attribution: b.attribution }]),
    ),
    layers: BASEMAPS.map((b) => ({
      id: `base-${b.id}`,
      type: 'raster',
      source: b.id,
      layout: { visibility: b.id === active ? 'visible' : 'none' },
    })),
  } as StyleSpecification;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

function popupHtml(p: RoadProps) {
  // MapLibre serialises nested properties to JSON strings.
  let alert = p.activeAlert;
  if (typeof alert === 'string') {
    try { alert = JSON.parse(alert); } catch { /* keep string */ }
  }
  let groups: unknown = p.roadGroupIds;
  if (typeof groups === 'string') {
    try { groups = JSON.parse(groups); } catch { /* keep string */ }
  }
  return `
    <div class="popup">
      <div class="popup-title">${esc(p.from)} → ${esc(p.to)}</div>
      <div class="popup-status" style="--c:${esc(p.stroke)}">${esc(p.status)}</div>
      <table>
        <tr><th>Updated</th><td>${esc(fmtTime(p.updatedAt))}</td></tr>
        <tr><th>Length</th><td>${esc(p.distance_km)} km</td></tr>
        <tr><th>Groups</th><td>${esc(Array.isArray(groups) ? groups.join(', ') : groups)}</td></tr>
        <tr><th>ID</th><td>${esc(p.id)}</td></tr>
      </table>
      ${alert ? `<pre>${esc(JSON.stringify(alert, null, 2))}</pre>` : ''}
    </div>`;
}

type Props = { roads: RoadsData | null; cities: CitiesData | null; basemap: string };

export default function RoadMap({ roads, cities, basemap }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loaded = useRef(false);
  const fitted = useRef(false);
  const pending = useRef<Props>({ roads, cities, basemap });
  pending.current = { roads, cities, basemap };

  // Create the map once.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: baseStyle(pending.current.basemap),
      center: [36.5, 47.0],
      zoom: 6,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('load', () => {
      map.addSource('roads', { type: 'geojson', data: EMPTY });
      map.addSource('cities', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'roads-casing',
        type: 'line',
        source: 'roads',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-opacity': 0.85,
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, ['case', IS_NEUTRAL, 4, 6], 12, ['case', IS_NEUTRAL, 8, 12]],
        },
      });
      map.addLayer({
        id: 'roads-line',
        type: 'line',
        source: 'roads',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['coalesce', ['get', 'stroke'], '#8a8f98'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, ['case', IS_NEUTRAL, 2, 4], 12, ['case', IS_NEUTRAL, 5, 8]],
        },
      });
      map.addLayer({
        id: 'cities',
        type: 'circle',
        source: 'cities',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 12, 6],
          'circle-color': '#1f2933',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      });

      const popup = new maplibregl.Popup({ maxWidth: '320px' });
      map.on('click', 'roads-line', (e) => {
        const f = e.features?.[0];
        if (f) popup.setLngLat(e.lngLat).setHTML(popupHtml(f.properties as RoadProps)).addTo(map);
      });
      map.on('mouseenter', 'roads-line', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'roads-line', () => (map.getCanvas().style.cursor = ''));

      loaded.current = true;
      apply(map);
    });

    return () => {
      loaded.current = false;
      fitted.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // City labels as DOM markers (no glyph server needed); hidden when zoomed far out.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !cities) return;
    const markers = cities.features.map((f) => {
      const el = document.createElement('div');
      el.className = 'city-label';
      el.textContent = f.properties.name;
      return new maplibregl.Marker({ element: el, anchor: 'left', offset: [6, 0] })
        .setLngLat(f.geometry.coordinates as [number, number])
        .addTo(map);
    });
    const toggle = () => map.getContainer().classList.toggle('labels-hidden', map.getZoom() < 6.5);
    toggle();
    map.on('zoom', toggle);
    return () => {
      map.off('zoom', toggle);
      markers.forEach((m) => m.remove());
    };
  }, [cities]);

  function apply(map: MlMap) {
    if (!loaded.current) return;
    const { roads: r, cities: c, basemap: b } = pending.current;
    for (const bm of BASEMAPS) map.setLayoutProperty(`base-${bm.id}`, 'visibility', bm.id === b ? 'visible' : 'none');
    if (r) (map.getSource('roads') as GeoJSONSource).setData(r);
    if (c) (map.getSource('cities') as GeoJSONSource).setData(c);
    if (r && !fitted.current && r.features.length) {
      const bounds = new maplibregl.LngLatBounds();
      r.features.forEach((f) => f.geometry.coordinates.forEach((pt) => bounds.extend(pt as [number, number])));
      map.fitBounds(bounds, { padding: 40, duration: 0 });
      fitted.current = true;
    }
  }

  useEffect(() => {
    if (mapRef.current) apply(mapRef.current);
  }, [roads, cities, basemap]);

  return <div ref={container} className="map" />;
}
