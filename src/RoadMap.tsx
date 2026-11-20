import { useEffect, useRef } from 'react';
import maplibregl, {
  type ExpressionSpecification,
  type FilterSpecification,
  type GeoJSONSource,
  type Map as MlMap,
  type StyleSpecification,
} from 'maplibre-gl';
import type { BridgeProps, BridgesData, CitiesData, FireProps, FiresData, RoadProps, RoadsData } from './data';
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

/**
 * Fire signals, coloured by age in hours: bright yellow when new, through orange to a
 * faded brown at 24 h. The age is computed against `now`, which the page updates every minute.
 */
export const FIRE_AGE_STOPS: [number, string][] = [
  [0, '#ffe066'],
  [3, '#ffa94d'],
  [8, '#f76707'],
  [16, '#a8461b'],
  [24, '#6b4f3a'],
];
const fireAge = (now: number): ExpressionSpecification => ['/', ['-', now, ['get', 'ms']], 3_600_000];
const firePaint = (now: number) => {
  const age = fireAge(now);
  return {
    'circle-color': ['interpolate', ['linear'], age, ...FIRE_AGE_STOPS.flat()] as ExpressionSpecification,
    'circle-opacity': ['interpolate', ['linear'], age, 0, 1, 24, 0.5] as ExpressionSpecification,
    'circle-stroke-opacity': ['interpolate', ['linear'], age, 0, 1, 24, 0.4] as ExpressionSpecification,
    'circle-radius': ['interpolate', ['linear'], ['zoom'],
      5, ['interpolate', ['linear'], age, 0, 5.5, 24, 3],
      12, ['interpolate', ['linear'], age, 0, 10, 24, 6]] as ExpressionSpecification,
  };
};
/** A soft glow behind signals of the last 3 hours. */
const freshFilter = (now: number): ExpressionSpecification => ['<', fireAge(now), 3];

/** Bridge symbols: ring colour per kind; a destroyed bridge gets a dark red ring. */
export const BRIDGE_STYLE = {
  river: { fill: '#ffffff', ring: '#1c7ed6', label: 'Bridge over a river or canal' },
  other: { fill: '#ffffff', ring: '#868e96', label: 'Other bridge (overpass, viaduct)' },
  crossing: { fill: '#1c7ed6', ring: '#ffffff', label: 'River crossing, no bridge in OSM' },
} as const;
const BRIDGE_DESTROYED = '#a61e4d';
const bridgeFilter = (showOther: boolean): FilterSpecification =>
  showOther
    ? ['any', ['!=', ['get', 'kind'], 'other'], ['>=', ['zoom'], 8]] // other bridges only from zoom 8 on
    : ['!=', ['get', 'kind'], 'other'];

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

const CONF: Record<string, string> = { low: 'low', nominal: 'nominal', high: 'high' };

function firePopupHtml(p: FireProps, roadName: string, tz: string | undefined, now: number) {
  const h = (now - p.ms) / 3_600_000;
  const ago = h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : `${h < 10 ? h.toFixed(1) : Math.round(h)} h ago`;
  return `
    <div class="popup">
      <div class="popup-title">Fire signal (NASA FIRMS)</div>
      <table>
        <tr><th>Detected</th><td>${esc(fmtTime(p.t, tz))} · ${esc(ago)}</td></tr>
        <tr><th>Road</th><td>${esc(roadName)}, ${esc(p.km.toFixed(1))} km away</td></tr>
        <tr><th>Satellite</th><td>${esc(p.sat)}, ${p.day ? 'day' : 'night'} pass</td></tr>
        <tr><th>Confidence</th><td>${esc(p.conf ? CONF[p.conf] ?? p.conf : '—')}</td></tr>
        <tr><th>Fire power</th><td>${p.frp === null ? '—' : `${esc(p.frp)} MW`}</td></tr>
      </table>
      <div class="popup-hint">A heat signal seen from space: a fire, a strike or a flare. The time is when the satellite passed.</div>
    </div>`;
}

const asList = <T,>(v: T[] | string | undefined): T[] => {
  if (Array.isArray(v)) return v;
  try { return v ? JSON.parse(v) : []; } catch { return []; }
};
const STRUCTURE: Record<string, string> = { viaduct: 'viaduct', trestle: 'trestle', covered: 'covered bridge', movable: 'movable bridge', aqueduct: 'aqueduct', low_water_crossing: 'low-water crossing' };

function bridgePopupHtml(p: BridgeProps, roadName: (id: string) => string) {
  const kind = p.structure ? STRUCTURE[p.structure] ?? p.structure : 'bridge';
  const title = p.kind === 'crossing'
    ? `${esc(p.waterway === 'canal' ? 'Canal' : 'River')} crossing: ${esc(p.river)}`
    : p.kind === 'river'
      ? `${esc(kind[0].toUpperCase() + kind.slice(1))} over ${esc(p.river)}`
      : esc(kind === 'bridge' ? 'Bridge (overpass)' : kind[0].toUpperCase() + kind.slice(1));
  const osm = asList<number>(p.osm);
  const rows = [
    p.name && ['Name', esc(p.name)],
    p.street && ['Street', esc(p.street)],
    p.ref && ['Road no.', esc(p.ref)],
    p.length_m ? ['Length', `about ${esc(p.length_m)} m`] : null,
    ['On', asList<string>(p.roads).map((r) => esc(roadName(r))).join('<br>')],
    p.destroyed && ['State', '<b class="destroyed">destroyed / ruins (OSM)</b>'],
    osm.length
      ? ['OSM', osm.map((id) => `<a href="https://www.openstreetmap.org/way/${id}" target="_blank" rel="noopener">way ${id}</a>`).join(', ')]
      : p.osm_river ? ['OSM', `<a href="https://www.openstreetmap.org/way/${p.osm_river}" target="_blank" rel="noopener">river</a>`] : null,
  ].filter(Boolean) as [string, string][];
  return `
    <div class="popup">
      <div class="popup-title">${title}</div>
      <table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
      ${p.kind === 'crossing' ? '<div class="popup-hint">The route crosses the water here, but OSM has no bridge: a culvert, a dam, a ford or an unmapped bridge.</div>' : ''}
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
  fires: FiresData | null;
  showFires: boolean;
  bridges: BridgesData | null;
  showBridges: boolean;
  /** Also show bridges that cross no river (overpasses, viaducts). */
  showOtherBridges: boolean;
  /** Current time, rounded to the minute: fire signals are coloured by their age. */
  now: number;
};

export default function RoadMap(props: Props) {
  const { roads, cities, basemap, selectedId, fires, showFires, now, playbackStatus } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loaded = useRef(false);
  const fitted = useRef(false);
  const pending = useRef<Props>(props);
  pending.current = props;

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
    // The map's box changes when the sidebar opens or closes, or the window is resized.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container.current!);
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    map.on('load', () => {
      map.addSource('roads', { type: 'geojson', data: EMPTY, promoteId: 'id' }); // ids for feature-state
      map.addSource('cities', { type: 'geojson', data: EMPTY });
      map.addSource('fires', { type: 'geojson', data: EMPTY });
      map.addSource('bridges', { type: 'geojson', data: EMPTY });
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
      // Bridges and river crossings: on the roads, below the fire signals.
      map.addLayer({
        id: 'bridges',
        type: 'circle',
        source: 'bridges',
        layout: { visibility: 'none', 'circle-sort-key': ['match', ['get', 'kind'], 'other', 0, 1] },
        filter: bridgeFilter(true),
        paint: {
          'circle-color': ['match', ['get', 'kind'], 'crossing', BRIDGE_STYLE.crossing.fill, '#ffffff'],
          'circle-stroke-color': ['case', ['==', ['get', 'destroyed'], true], BRIDGE_DESTROYED,
            ['match', ['get', 'kind'], 'river', BRIDGE_STYLE.river.ring, 'other', BRIDGE_STYLE.other.ring, BRIDGE_STYLE.crossing.ring]],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 12, 3],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, ['match', ['get', 'kind'], 'other', 2.5, 3.5], 12, ['match', ['get', 'kind'], 'other', 6, 7]],
        },
      });

      // Fire signals: above the roads, below the towns. Oldest drawn first, newest on top.
      const now0 = pending.current.now;
      map.addLayer({
        id: 'fires-glow',
        type: 'circle',
        source: 'fires',
        filter: freshFilter(now0),
        paint: {
          'circle-color': '#ffd43b',
          'circle-opacity': 0.45,
          'circle-blur': 0.9,
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 13, 12, 22],
        },
      });
      map.addLayer({
        id: 'fires',
        type: 'circle',
        source: 'fires',
        layout: { 'circle-sort-key': ['get', 'ms'] },
        paint: { ...firePaint(now0), 'circle-stroke-color': '#2b1a0e', 'circle-stroke-width': 1 },
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
      const overFire = (e: maplibregl.MapLayerMouseEvent) =>
        !!map.getLayer('fires') && map.getLayoutProperty('fires', 'visibility') !== 'none' &&
        map.queryRenderedFeatures(e.point, { layers: ['fires'] }).length > 0;

      const overBridge = (e: maplibregl.MapLayerMouseEvent) =>
        !!map.getLayer('bridges') && map.getLayoutProperty('bridges', 'visibility') !== 'none' &&
        map.queryRenderedFeatures(e.point, { layers: ['bridges'] }).length > 0;
      const roadName = (id: string) => {
        const r = pending.current.roads?.features.find((x) => x.properties.id === id)?.properties;
        return r ? `${r.from} → ${r.to}` : id;
      };

      // Bridge details on hover (tap on touch screens); a fire signal on top wins.
      const showBridge = (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== 'Point' || overTown(e) || overFire(e)) return;
        map.getCanvas().style.cursor = 'default';
        hoverPopup
          .setLngLat(f.geometry.coordinates as [number, number])
          .setHTML(bridgePopupHtml(f.properties as BridgeProps, roadName))
          .addTo(map);
      };
      map.on('mousemove', 'bridges', showBridge);
      map.on('click', 'bridges', showBridge);
      map.on('mouseleave', 'bridges', () => {
        map.getCanvas().style.cursor = '';
        hoverPopup.remove();
      });

      // Fire signal details on hover (tap on touch screens).
      const showFire = (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== 'Point' || overTown(e)) return;
        const p = f.properties as FireProps;
        const road = pending.current.roads?.features.find((x) => x.properties.id === p.road)?.properties;
        map.getCanvas().style.cursor = 'default';
        hoverPopup
          .setLngLat(f.geometry.coordinates as [number, number])
          .setHTML(firePopupHtml(p, road ? `${road.from} → ${road.to}` : p.road, pending.current.timeZoneFor(p.road), Date.now()))
          .addTo(map);
      };
      map.on('mousemove', 'fires', showFire);
      map.on('click', 'fires', showFire);
      map.on('mouseleave', 'fires', () => {
        map.getCanvas().style.cursor = '';
        hoverPopup.remove();
      });

      map.on('mousemove', 'roads-hit', (e) => {
        const f = e.features?.[0];
        const p = f?.properties as RoadProps | undefined;
        if (overFire(e) || overBridge(e)) return; // fire and bridge popups have priority
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
        if (!p || overTown(e) || overFire(e) || overBridge(e)) return;
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
      ro.disconnect();
      loaded.current = false;
      fitted.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  function apply(map: MlMap) {
    if (!loaded.current) return;
    const { roads: r, cities: c, basemap: b, selectedId: sel, playbackStatus: pb, fires: fi, showFires: sf, now: t } = pending.current;
    const { bridges: br, showBridges: sb, showOtherBridges: so } = pending.current;
    map.setFilter('roads-selected', ['==', ['get', 'id'], sel ?? '']);
    for (const bm of BASEMAPS) {
      for (const id of baseLayers(bm)) map.setLayoutProperty(id, 'visibility', bm.id === b ? 'visible' : 'none');
    }
    if (r) (map.getSource('roads') as GeoJSONSource).setData(r);
    if (pb) for (const [id, status] of Object.entries(pb)) map.setFeatureState({ source: 'roads', id }, { pb: status });
    else map.removeFeatureState({ source: 'roads' });
    if (c) (map.getSource('cities') as GeoJSONSource).setData(c);
    (map.getSource('fires') as GeoJSONSource).setData(fi ?? EMPTY);
    for (const id of ['fires-glow', 'fires']) map.setLayoutProperty(id, 'visibility', sf ? 'visible' : 'none');
    for (const [k, v] of Object.entries(firePaint(t))) map.setPaintProperty('fires', k, v);
    map.setFilter('fires-glow', freshFilter(t));
    (map.getSource('bridges') as GeoJSONSource).setData(br ?? EMPTY);
    map.setLayoutProperty('bridges', 'visibility', sb ? 'visible' : 'none');
    map.setFilter('bridges', bridgeFilter(so));
    if (r && !fitted.current && r.features.length) {
      const bounds = new maplibregl.LngLatBounds();
      r.features.forEach((f) => f.geometry.coordinates.forEach((pt) => bounds.extend(pt as [number, number])));
      map.fitBounds(bounds, { padding: 40, duration: 0 });
      fitted.current = true;
    }
  }

  useEffect(() => {
    if (mapRef.current) apply(mapRef.current);
  }, [roads, cities, basemap, selectedId, playbackStatus, fires, showFires, now, props.bridges, props.showBridges, props.showOtherBridges]);

  // Bring a road selected from the list into view (no move if it is already visible).
  useEffect(() => {
    const map = mapRef.current;
    const f = roads?.features.find((x) => x.properties.id === selectedId);
    if (!map || !f) return;
    const bounds = new maplibregl.LngLatBounds();
    f.geometry.coordinates.forEach((pt) => bounds.extend(pt as [number, number]));
    const view = map.getBounds();
    if (view.contains(bounds.getSouthWest()) && view.contains(bounds.getNorthEast())) return;
    map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 600 });
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={container} className="map" />;
}
