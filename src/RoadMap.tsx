import { useEffect, useRef } from 'react';
import maplibregl, {
  type ExpressionSpecification,
  type GeoJSONSource,
  type Map as MlMap,
  type StyleSpecification,
} from 'maplibre-gl';
import type { CitiesData, RoadProps, RoadsData } from './data';
import { statusColor, statusColorExpr } from './colors';
import { fmtTime, type TzFor } from './history';

export type Basemap = {
  id: string;
  label: string;
  /** Light or dark map; the select groups them. */
  tone: 'light' | 'dark';
  tiles: string[];
  /** Optional label layer (town names) drawn on top of the tiles. */
  labels?: string[];
  maxzoom?: number;
  /** Raster paint settings, e.g. to darken a light map. */
  paint?: Record<string, number>;
  attribution: string;
};

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const esri = (service: string) => [`${ESRI}${service}/MapServer/tile/{z}/{y}/{x}`];
const OSM_TILES = ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'];
const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Base maps; all of them show town names. The first one is the default. */
export const BASEMAPS: Basemap[] = [
  { id: 'osm', label: 'OpenStreetMap', tone: 'light', tiles: OSM_TILES, attribution: OSM_ATTR },
  {
    id: 'esri-light',
    label: 'Esri Light Gray',
    tone: 'light',
    tiles: esri('Canvas/World_Light_Gray_Base'),
    labels: esri('Canvas/World_Light_Gray_Reference'),
    maxzoom: 16,
    attribution: 'Tiles © Esri',
  },
  { id: 'esri-streets', label: 'Esri Streets', tone: 'light', tiles: esri('World_Street_Map'), attribution: 'Tiles © Esri' },
  { id: 'esri-topo', label: 'Esri Topographic', tone: 'light', tiles: esri('World_Topo_Map'), attribution: 'Tiles © Esri' },
  {
    id: 'esri-imagery', // id kept so saved choices still work
    label: 'Esri Imagery with labels',
    tone: 'light',
    tiles: esri('World_Imagery'),
    labels: esri('Reference/World_Boundaries_and_Places'),
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
  },
  {
    id: 'osm-dark',
    label: 'OpenStreetMap dark',
    tone: 'dark',
    tiles: OSM_TILES,
    // Invert the brightness (white -> dark grey, dark text -> light), then turn the hues back.
    paint: { 'raster-brightness-min': 0.9, 'raster-brightness-max': 0.08, 'raster-hue-rotate': 180, 'raster-saturation': -0.4 },
    attribution: OSM_ATTR,
  },
  {
    id: 'esri-dark',
    label: 'Esri Dark Gray',
    tone: 'dark',
    tiles: esri('Canvas/World_Dark_Gray_Base'),
    labels: esri('Canvas/World_Dark_Gray_Reference'),
    maxzoom: 16,
    attribution: 'Tiles © Esri',
  },
];

/** Layer ids of a base map: its tiles and, if it has one, its label layer. */
const baseLayers = (b: Basemap) => (b.labels ? [`base-${b.id}`, `base-${b.id}-labels`] : [`base-${b.id}`]);

const EMPTY = { type: 'FeatureCollection' as const, features: [] };
/** Keep fitted roads clear of the left sidebar on wide screens. */
const fitPadding = (p: number) =>
  window.innerWidth > 700 ? { top: p, bottom: p, right: p, left: 384 + p } : p;

/** A road's status: the playback status (feature-state "pb") while playing back, else the live one. */
const STATUS: ExpressionSpecification = ['coalesce', ['feature-state', 'pb'], ['get', 'status']];
const IS_NEUTRAL: ExpressionSpecification = ['==', STATUS, 'neutral'];

function baseStyle(active: string): StyleSpecification {
  const raster = (tiles: string[], b: Basemap, attribution?: string) => ({
    type: 'raster', tiles, tileSize: 256, maxzoom: b.maxzoom ?? 19, ...(attribution ? { attribution } : {}),
  });
  return {
    version: 8,
    sources: Object.fromEntries(BASEMAPS.flatMap((b) => [
      [b.id, raster(b.tiles, b, b.attribution)],
      ...(b.labels ? [[`${b.id}-labels`, raster(b.labels, b)]] : []),
    ])),
    // Base maps sit below everything else; the road and town layers are added on top.
    layers: BASEMAPS.flatMap((b) => baseLayers(b).map((id, i) => ({
      id,
      type: 'raster',
      source: i ? `${b.id}-labels` : b.id,
      layout: { visibility: b.id === active ? 'visible' : 'none' },
      ...(b.paint && !i ? { paint: b.paint } : {}),
    }))),
  } as StyleSpecification;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function popupHtml(p: RoadProps, tz: string | undefined, hint = false) {
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
      <div class="popup-status" style="--c:${esc(statusColor(p.status, p.stroke))}">${esc(p.status)}</div>
      <table>
        <tr><th>Updated</th><td>${esc(fmtTime(p.updatedAt, tz))}</td></tr>
        <tr><th>Length</th><td>${esc(p.distance_km)} km</td></tr>
        <tr><th>Groups</th><td>${esc(Array.isArray(groups) ? groups.join(', ') : groups)}</td></tr>
        <tr><th>ID</th><td>${esc(p.id)}</td></tr>
      </table>
      ${alert ? `<pre>${esc(JSON.stringify(alert, null, 2))}</pre>` : ''}
      ${hint ? '<div class="popup-hint">Click for alert history</div>' : ''}
    </div>`;
}

type Props = {
  roads: RoadsData | null;
  cities: CitiesData | null;
  basemap: string;
  /** Road highlighted on the map and shown in the history panel. */
  selectedId: string | null;
  /** Called with a road id on a road click, and with null on a click elsewhere on the map. */
  onSelect: (id: string | null) => void;
  /** Status per road id during playback; null = live. */
  playbackStatus: Record<string, string> | null;
  /** Time zone for a road's times in popups (undefined = the viewer's own). */
  timeZoneFor: TzFor;
};

export default function RoadMap({ roads, cities, basemap, selectedId, onSelect, timeZoneFor, playbackStatus }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loaded = useRef(false);
  const fitted = useRef(false);
  const pending = useRef<Props>({ roads, cities, basemap, selectedId, onSelect, timeZoneFor, playbackStatus });
  pending.current = { roads, cities, basemap, selectedId, onSelect, timeZoneFor, playbackStatus };

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
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right'); // the sidebar covers the left edge

    map.on('load', () => {
      map.addSource('roads', { type: 'geojson', data: EMPTY, promoteId: 'id' }); // ids for feature-state
      map.addSource('cities', { type: 'geojson', data: EMPTY });
      // Dark halo under the selected road.
      map.addLayer({
        id: 'roads-selected',
        type: 'line',
        source: 'roads',
        filter: ['==', ['get', 'id'], ''],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#111827',
          'line-opacity': 0.85,
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 11, 12, 18],
        },
      });
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
          'line-color': statusColorExpr(STATUS),
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, ['case', IS_NEUTRAL, 2, 4], 12, ['case', IS_NEUTRAL, 5, 8]],
        },
      });
      map.addLayer({
        id: 'cities',
        type: 'circle',
        source: 'cities',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 12, 6],
          'circle-color': '#000000',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
        },
      });
      // Invisible, larger circles so the small dots are easy to hover/tap.
      map.addLayer({
        id: 'cities-hit',
        type: 'circle',
        source: 'cities',
        paint: { 'circle-radius': 10, 'circle-opacity': 0 },
      });

      // Town name tag on hover (tap on touch screens).
      const tag = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'city-tag',
        offset: 10,
      });
      const showTag = (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== 'Point') return;
        map.getCanvas().style.cursor = 'default';
        tag.setLngLat(f.geometry.coordinates as [number, number]).setText(String(f.properties.name)).addTo(map);
      };
      map.on('mousemove', 'cities-hit', showTag);
      map.on('click', 'cities-hit', showTag);
      map.on('mouseleave', 'cities-hit', () => {
        map.getCanvas().style.cursor = '';
        tag.remove();
      });

      // Invisible, wider lines so roads are easy to hover/click (kept below the town layers).
      map.addLayer(
        { id: 'roads-hit', type: 'line', source: 'roads', paint: { 'line-width': 12, 'line-opacity': 0 } },
        'cities',
      );

      // Road details in a hover popup that follows the cursor; a click selects the road
      // (highlight + alert history in the side panel).
      const hoverPopup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        className: 'road-hover',
        maxWidth: '320px',
        offset: 14,
      });

      const overTown = (e: maplibregl.MapLayerMouseEvent) =>
        map.queryRenderedFeatures(e.point, { layers: ['cities-hit'] }).length > 0;

      map.on('mousemove', 'roads-hit', (e) => {
        const f = e.features?.[0];
        const p = f?.properties as RoadProps | undefined;
        if (!p || overTown(e)) {
          hoverPopup.remove();
          return;
        }
        map.getCanvas().style.cursor = 'pointer';
        hoverPopup
          .setLngLat(e.lngLat)
          .setHTML(popupHtml(p, pending.current.timeZoneFor(p.id), p.id !== pending.current.selectedId))
          .addTo(map);
      });
      map.on('mouseleave', 'roads-hit', () => {
        map.getCanvas().style.cursor = '';
        hoverPopup.remove();
      });
      map.on('click', 'roads-hit', (e) => {
        const p = e.features?.[0]?.properties as RoadProps | undefined;
        if (!p || overTown(e)) return;
        hoverPopup.remove();
        pending.current.onSelect(p.id);
      });
      // A click anywhere else on the map clears the selection (dragging doesn't fire click).
      map.on('click', (e) => {
        if (!map.queryRenderedFeatures(e.point, { layers: ['roads-hit'] }).length) pending.current.onSelect(null);
      });

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

  function apply(map: MlMap) {
    if (!loaded.current) return;
    const { roads: r, cities: c, basemap: b, selectedId: sel, playbackStatus: pb } = pending.current;
    map.setFilter('roads-selected', ['==', ['get', 'id'], sel ?? '']);
    for (const bm of BASEMAPS) {
      for (const id of baseLayers(bm)) map.setLayoutProperty(id, 'visibility', bm.id === b ? 'visible' : 'none');
    }
    if (r) (map.getSource('roads') as GeoJSONSource).setData(r);
    if (pb) for (const [id, status] of Object.entries(pb)) map.setFeatureState({ source: 'roads', id }, { pb: status });
    else map.removeFeatureState({ source: 'roads' });
    if (c) (map.getSource('cities') as GeoJSONSource).setData(c);
    if (r && !fitted.current && r.features.length) {
      const bounds = new maplibregl.LngLatBounds();
      r.features.forEach((f) => f.geometry.coordinates.forEach((pt) => bounds.extend(pt as [number, number])));
      map.fitBounds(bounds, { padding: fitPadding(40), duration: 0 });
      fitted.current = true;
    }
  }

  useEffect(() => {
    if (mapRef.current) apply(mapRef.current);
  }, [roads, cities, basemap, selectedId, playbackStatus]);

  // Bring a road selected from the list into view (no move if it is already visible).
  useEffect(() => {
    const map = mapRef.current;
    const f = roads?.features.find((x) => x.properties.id === selectedId);
    if (!map || !f) return;
    const bounds = new maplibregl.LngLatBounds();
    f.geometry.coordinates.forEach((pt) => bounds.extend(pt as [number, number]));
    const view = map.getBounds();
    if (view.contains(bounds.getSouthWest()) && view.contains(bounds.getNorthEast())) return;
    map.fitBounds(bounds, { padding: fitPadding(60), maxZoom: 10, duration: 600 });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={container} className="map" />;
}
