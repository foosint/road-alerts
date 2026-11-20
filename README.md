# road-alerts

A map of road segments in Crimea, Kherson, Zaporizhzhia, Donetsk and Luhansk, coloured by their current alert status. It's a React, [Vite](https://vite.dev/) and [MapLibre GL JS](https://maplibre.org/) app hosted on GitHub Pages.

The data isn't stored in this repo. The page fetches it at runtime from the [road-alerts-data](../road-alerts-data) repo, which a Raspberry Pi updates whenever the alert feed changes. New data therefore needs no rebuild or redeploy of this site.

```
road-alerts-data (GitHub) ── data/roads.geojson, data/cities.geojson, data/alerts.json, data/fires.geojson,
                             data/bridges.geojson
            ▲                              │ raw.githubusercontent.com
   Pi pushes on change                     ▼
                                road-alerts page polls every 90 s
```

## Features

- **Road segments** in two states: **busy** (red, drawn thicker) or **neutral** (green). The page maps every status from the feed to one of these two: `busy` stays busy, and anything else (`neutral`, an all clear, an unknown status) counts as neutral. The colours are set in `STATUS_COLORS` in [src/colors.ts](src/colors.ts).
- **Segment details:** hover a road to see from → to, status, last update, length, groups and the active alert, if there is one.
- **Alert history** in a card below the status panel, built from `alerts.json`:
  - **Log:** one entry per alert per road, newest first and grouped by the day it began. An activation that covers three roads gives three entries. Each entry shows:
    - the start time and the road (click it to open that road);
    - how long the alert lasted, in green, e.g. `Threat (was active for 56 min)`. While the alert is still running, it shows `(active for 12 min)` in red and counts up.
    - when it ended (`until 18:57`) or `ongoing`.
  - **When an alert ends:** when the road is neutral again. An all clear counts the same as the road returning to neutral, whichever comes first. A new threat on a road that is still busy extends the running alert ("renewed 1×") instead of starting a new one.
  - **Older alerts:** the alert log records alert ends from `statusSince` on. Older alerts without an all clear show "end not recorded" and "(duration unknown)".
  - **By hour:** number of alerts, roads affected and alerts active now, a chart of when alerts began by hour of the day, and a ranking of roads by number of alerts.
  - **Trend:** number of alerts per day, week or month (weeks run Monday to Sunday).
    - Tiles show the current day, week or month so far, the previous one, the average, and the change between the last two (▲ more, ▼ fewer).
    - A per-road list shows each road's count in the previous and current day, week or month, with the change.
  - **Duration:** how long finished alerts lasted. Running alerts and those with an unknown end are left out.
    - Tiles show the median, average and longest duration.
    - Charts show the median duration per day, week or month (with the change against the previous one) and how many alerts fell into each duration class (<15 min … 8 h+).
    - A ranking lists the median duration per road.
  - **One road:** click a road on the map or in a list. It is highlighted on the map, and the card shows its number of alerts, median duration and last alert. The same four tabs (Log, By hour, Trend, Duration) then show only that road. **← All roads**, a click elsewhere on the map, or the Escape key goes back.
  - **Period:** today (since midnight in the selected time zone), last day (24 hours), last 3 days, last 7 days, last 30 days or all time (default). It applies to all of the above and selects alerts by the time they began. Running alerts are always included.
  - **Time zone:** *Kyiv time* (default) uses Ukraine's official time (UTC+2, UTC+3 in summer). *My time* uses the viewer's own zone. *Local Russian time (MSK)* shows the clock time in use where the road is: Moscow time, UTC+3 all year. In winter it is an hour ahead of Kyiv time; in summer they match. The labels name the offset, e.g. "Kyiv time, UTC+2" or "MSK, UTC+3". The setting also applies to the times in the hover popups. All roads in the feed currently keep UTC+3 all year. A road with a different zone can be added to `ROAD_TZ_BY_ROAD` in [src/history.ts](src/history.ts).
  - The counts and charts are per road: an activation that covers two roads counts as two alerts. Days, weeks and months are calendar days in the selected time zone.
  - Each chart shows its value above every bar (above only the highest bar when there are too many bars for the labels to fit, e.g. 30 days), and has a hover tooltip and a **Table** view.
- **Fire signals:** [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) satellite heat signals (hotspots) of the last 24 hours, only those within 3 km of a road segment (set by `FIRMS_MAX_KM` in the data repo).
  - Turn them on or off with **Fire signals near roads** in the status panel; the count shows how many there are. The setting is saved.
  - The colour shows the age: yellow when new, through orange to brown at 24 hours. Older signals are also smaller and fainter, and signals of the last 3 hours get a yellow glow.
  - Hover or tap a signal for the detection time, how long ago that was, the nearest road and the distance to it, the satellite, the confidence and the fire power.
  - The time is when a satellite passed over, a few times a day, not when the fire started. A hotspot can be a fire, a strike, a gas flare or a hot industrial site.
  - The data comes from `fires.geojson` in the data repo. If it is missing, the page works as before.
- **Bridges & river crossings:** every bridge and river crossing on the road segments, from OpenStreetMap (`bridges.geojson` in the data repo).
  - Turn them on with **Bridges & river crossings** in the status panel (off by default). The legend under it shows the three symbols and their counts.
  - **Blue ring:** a bridge over a river or canal.
  - **Solid blue dot:** the route crosses a river or canal, but OSM has no bridge there (a culvert, a dam, a ford or an unmapped bridge).
  - **Grey ring:** any other bridge, such as an overpass or a viaduct. These appear from zoom level 8 on, and the **Other bridge** checkbox hides them completely.
  - **Dark red ring:** a bridge tagged as destroyed in OSM.
  - Hover or tap one for the river, the bridge's name, the street it carries, the road number, its length, the roads it is on and links to OSM. A fire signal on top takes precedence, and a bridge takes precedence over the road under it.
- **Town markers:** black dots that show the town name on hover, or on tap on touch screens.
- **Status panel** with:
  - a legend with every status in `STATUS_COLORS`, even when no segment has it, and the number of segments per status;
  - when the feed was last updated (`source.updatedAt`);
  - the latest segment change (newest `updatedAt`);
  - when the page last checked for new data.
- **Base maps:** all of them show town names.
  - Light: OpenStreetMap (default), Esri Light Gray, Esri Streets, Esri Topographic, and Esri Imagery with a label layer on top.
  - Dark, for use with the dark theme: Esri Dark Gray, and "OpenStreetMap dark", the normal OSM tiles with their brightness inverted by MapLibre.
  - Esri Light Gray and Dark Gray only go to zoom level 16.
  - All of these work without an API key. CARTO base maps were left out because they now require one.
- **Playback:** press **Playback** in the panel to replay the alerts of today or of the last 1, 3, 7 or 30 days.
  - A bar over the map has play/pause, a time slider, the range and the speed (5 min to 12 h of alert time per second).
  - The map colours each road by its status at the shown time, and the legend counts those statuses. The bar also shows how many alerts were active.
  - Red ticks above the slider mark when alerts began.
  - The clock and "Today" follow the selected time zone.
  - **Live** or ✕ returns to the current state.
  - Playback uses the per-road alerts from the log, so alerts with an unknown end (from before `statusSince`) are not shown.
- **Theme switch:** the button next to the title cycles through system (◐, follows the device setting), light (☀) and dark (☾). This sets the colours of the panels; the base map stays the same.
- **Saved settings:** the page remembers the base map, period, time zone, theme and which of fire signals, bridges and other bridges are shown, for each browser.
- **Auto-refresh.** The page fetches `roads.geojson`, `cities.geojson`, `alerts.json`, `fires.geojson` and `bridges.geojson` every 90 seconds, when the tab becomes visible again, or when you press **Refresh**. Reloading the page also loads the latest data. The map only redraws when a file's content has changed.

## Where the data comes from

The data location is set at build time with `VITE_DATA_URL`, the folder URL with a trailing slash:

| Context | Data URL |
|---|---|
| GitHub Pages build | `https://raw.githubusercontent.com/<owner>/road-alerts-data/main/data/`. The deploy workflow builds this from the repo owner. To use another location, set a repository variable `DATA_URL` under **Settings → Secrets and variables → Actions → Variables**. |
| `npm run dev` / `npm run preview` | `/data/`. Vite serves the `.geojson` and `.json` files from the sibling folder `../road-alerts-data/data` (or `../road-alerts-backend/data`), so local changes show up immediately. |
| Anything else | Set `VITE_DATA_URL` in the environment or in a `.env.local` file. |

`raw.githubusercontent.com` allows cross-site requests, but it caches a branch URL (`…/main/data/…`) for up to 5 minutes and ignores query strings, so it can serve old data. To avoid that, each check works like this:

1. It asks the GitHub API for the latest commit on the branch: `api.github.com/repos/<owner>/road-alerts-data/commits/main`, a tiny reply with just the commit hash.
2. If the commit hasn't changed, nothing more is loaded.
3. Otherwise it loads the files from the commit URL `raw.githubusercontent.com/<owner>/road-alerts-data/<hash>/data/…`. That URL always serves exactly that commit, so new data shows up as soon as the Pi has pushed it.

Without a login, the GitHub API allows 60 requests an hour per IP address. Every check counts, including "not modified" replies. That's why the page checks every 90 seconds. If the limit is reached, for example with many open tabs or many visitors behind one shared IP, the page falls back to the branch URL until the limit resets. Data can then be up to 5 minutes old again.

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
- Bridges and rivers: © OpenStreetMap contributors.
- Fire data: NASA FIRMS (VIIRS and MODIS active fire products), LANCE / NASA EOSDIS.
- Routes are computed with [OSRM](https://project-osrm.org/) on OpenStreetMap data.
