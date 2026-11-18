# road-alerts

A map of road segments in Crimea, Kherson, Zaporizhzhia, Donetsk and Luhansk, coloured by their current alert status. It's a React, [Vite](https://vite.dev/) and [MapLibre GL JS](https://maplibre.org/) app hosted on GitHub Pages.

The data isn't stored in this repo. The page fetches it at runtime from the [road-alerts-data](../road-alerts-data) repo, which a Raspberry Pi updates whenever the alert feed changes. New data therefore needs no rebuild or redeploy of this site.

```
road-alerts-data (GitHub) ── data/roads.geojson, data/cities.geojson
            ▲                              │ raw.githubusercontent.com
   Pi pushes on change                     ▼
                                road-alerts page polls every 60 s
```

## Features

- **Road segments** in the data's colour for each status: the `stroke` property. Segments with an alert status are drawn thicker than `neutral` ones.
- **Segment details:** click a road to see from → to, status, last update, length, groups and the active alert, if there is one.
- **Town markers and labels.** Labels are hidden when zoomed far out.
- **Status panel** with:
  - a legend that counts segments per status;
  - when the feed was last updated (`source.updatedAt`);
  - the latest segment change (newest `updatedAt`);
  - when the page last checked for new data.
- **Base maps:** OpenStreetMap, Esri Streets and Esri Imagery. The page remembers your choice for each browser.
- **Auto-refresh.** The page fetches `roads.geojson` and `cities.geojson` every 60 seconds, when the tab becomes visible again, or when you press **Refresh**. Reloading the page also loads the latest data. The map only redraws when a file's content has changed.

## Where the data comes from

The data location is set at build time with `VITE_DATA_URL`, the folder URL with a trailing slash:

| Context | Data URL |
|---|---|
| GitHub Pages build | `https://raw.githubusercontent.com/<owner>/road-alerts-data/main/data/`. The deploy workflow builds this from the repo owner. To use another location, set a repository variable `DATA_URL` under **Settings → Secrets and variables → Actions → Variables**. |
| `npm run dev` / `npm run preview` | `/data/`. Vite serves this from the sibling folder `../road-alerts-data/data` (or `../road-alerts-backend/data`), so local changes show up immediately. |
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
