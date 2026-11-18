# road-alerts

A map of road segments in Crimea, Kherson, Zaporizhzhia, Donetsk and Luhansk, coloured by their current alert status. It's a React, [Vite](https://vite.dev/) and [MapLibre GL JS](https://maplibre.org/) app hosted on GitHub Pages.

The data isn't stored in this repo. The page fetches it at runtime from the [road-alerts-data](../road-alerts-data) repo, which a Raspberry Pi updates whenever the alert feed changes. New data therefore needs no rebuild or redeploy of this site.

```
road-alerts-data (GitHub) ── data/roads.geojson, data/cities.geojson, data/alerts.json
            ▲                              │ raw.githubusercontent.com
   Pi pushes on change                     ▼
                                road-alerts page polls every 60 s
```

## Features

- **Road segments** coloured by status. The colours are set in `STATUS_COLORS` in [src/colors.ts](src/colors.ts). Statuses not listed there use the `stroke` colour from the data. Segments with an alert status are drawn thicker than `neutral` ones.
- **Segment details:** hover a road to see from → to, status, last update, length, groups and the active alert, if there is one.
- **Alert history** in a card below the status panel, built from `alerts.json`:
  - **Log:** every activation, newest first and grouped by day. Each entry shows the time, the type (`Threat` or `All clear`) and the roads it covers. A threat shows how long it took until the road was cleared, "repeated before clear" if a new threat came first, or "active now". Click a road name to open that road.
  - **By hour:** alert count, number of roads affected, a chart of alerts per hour of the day, and a ranking of roads by alert count. A threat that covers several roads counts once in the chart.
  - **One road:** click a road on the map or in a list. It is highlighted on the map, and the card shows its alert count, median time until clear, last alert, its own hour chart and its full history. **← All roads**, a click elsewhere on the map, or the Escape key goes back.
  - **Period:** last day (24 hours), last 3 days, last 7 days, last 30 days or all time (default). It applies to all of the above.
  - **Time zone:** *Kyiv time* (default) uses Ukraine's official time (UTC+2, UTC+3 in summer). *Local time on the road* shows every time as the clock time where that road segment is, so the hour chart shows when alerts happen locally. In winter, Kyiv time is an hour behind local time on the road. *My time* uses the viewer's own zone. The labels name the offset, e.g. "local time, UTC+3". The setting also applies to the times in the hover popups. All roads in the feed currently keep UTC+3 all year. A road with a different zone can be added to `ROAD_TZ_BY_ROAD` in [src/history.ts](src/history.ts).
  - Only `threat` activations count as alerts in the counts and charts.
  - Each chart has a hover tooltip and a **Table** view.
- **Town markers:** black dots that show the town name on hover, or on tap on touch screens.
- **Status panel** with:
  - a legend with every status in `STATUS_COLORS`, even when no segment has it, and the number of segments per status;
  - when the feed was last updated (`source.updatedAt`);
  - the latest segment change (newest `updatedAt`);
  - when the page last checked for new data.
- **Base maps:** OpenStreetMap, Esri Streets and Esri Imagery. The page remembers the base map, period and time zone for each browser.
- **Auto-refresh.** The page fetches `roads.geojson`, `cities.geojson` and `alerts.json` every 60 seconds, when the tab becomes visible again, or when you press **Refresh**. Reloading the page also loads the latest data. The map only redraws when a file's content has changed.

## Where the data comes from

The data location is set at build time with `VITE_DATA_URL`, the folder URL with a trailing slash:

| Context | Data URL |
|---|---|
| GitHub Pages build | `https://raw.githubusercontent.com/<owner>/road-alerts-data/main/data/`. The deploy workflow builds this from the repo owner. To use another location, set a repository variable `DATA_URL` under **Settings → Secrets and variables → Actions → Variables**. |
| `npm run dev` / `npm run preview` | `/data/`. Vite serves the `.geojson` and `.json` files from the sibling folder `../road-alerts-data/data` (or `../road-alerts-backend/data`), so local changes show up immediately. |
| Anything else | Set `VITE_DATA_URL` in the environment or in a `.env.local` file. |

`raw.githubusercontent.com` allows cross-site requests and caches files for up to 5 minutes. Each request adds a unique query parameter to get past that cache, but in the worst case new data appears a few minutes late.

## Development

```sh
npm install
npm run dev        # http://localhost:5173, data from ../road-alerts-data/data
npm run build      # type-check and build to dist/
npm run preview    # serve dist/ locally
```

- The poll interval is `POLL_MS` in [src/data.ts](src/data.ts).
- Status colours are `STATUS_COLORS` in [src/colors.ts](src/colors.ts).
- The local time zone of the roads (`ROAD_TZ`, `ROAD_TZ_BY_ROAD`), periods and the history calculations are in [src/history.ts](src/history.ts). The history card is [src/AlertHistory.tsx](src/AlertHistory.tsx), and the chart is [src/HourChart.tsx](src/HourChart.tsx).
- If `alerts.json` is missing (404), the page still works and the card says there is no log yet.
- The base maps are `BASEMAPS` in [src/RoadMap.tsx](src/RoadMap.tsx).
- The local data folders are set in [vite.config.ts](vite.config.ts).

## Deployment (one-time setup)

1. Create the GitHub repo `road-alerts` and push this folder to `main`.
2. Open **Settings → Pages** and set **Source** to **GitHub Actions**.

Every push to `main` runs [.github/workflows/deploy.yml](.github/workflows/deploy.yml). The site is then served at `https://<you>.github.io/road-alerts/`. Data updates don't trigger a deploy.

GitHub Pages on a free account requires a **public** repository. The `road-alerts-data` repo must be public too, so the page can read it.

## Attribution

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Esri tiles © Esri.
- Routes are computed with [OSRM](https://project-osrm.org/) on OpenStreetMap data.
