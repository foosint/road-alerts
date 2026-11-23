import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));

// For `npm run dev` / `npm run preview`: serve /data/*.geojson and *.json from the sibling
// road-alerts-data checkout, so local changes show up without pushing.
const LOCAL_DATA_DIRS = ['../road-alerts-data/data', '../road-alerts-backend/data'].map((d) => path.resolve(root, d));
// Telegram events: the preview folder filled by `uv run monitor publish --no-push` in telegram-monitor,
// served under /telegram-data/. Override with TELEGRAM_DATA_DIR.
const TELEGRAM_DATA_DIRS = [
  path.resolve(root, process.env.TELEGRAM_DATA_DIR ?? '../../telegram-monitor/data/publish-preview/road-events'),
];

/** Serves *.json / *.geojson from the first folder that has the file. */
function serveFrom(dirs: string[]): Connect.NextHandleFunction {
  return (req, res, next) => {
    const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
    if (!/^[\w.-]+\.(geo)?json$/.test(name)) return next();
    const dir = dirs.find((d) => fs.existsSync(path.join(d, name)));
    if (!dir) return next();
    res.setHeader('Content-Type', name.endsWith('.geojson') ? 'application/geo+json' : 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(path.join(dir, name)).pipe(res);
  };
}

function localData(): Plugin {
  const data = serveFrom(LOCAL_DATA_DIRS);
  const telegram = serveFrom(TELEGRAM_DATA_DIRS);
  return {
    name: 'local-data',
    configureServer: (server) => {
      server.middlewares.use('/data', data);
      server.middlewares.use('/telegram-data', telegram);
    },
    configurePreviewServer: (server) => {
      server.middlewares.use('/data', data);
      server.middlewares.use('/telegram-data', telegram);
    },
  };
}

// Relative base so the build works under https://<user>.github.io/road-alerts/
export default defineConfig({
  base: './',
  plugins: [react(), localData()],
  build: { chunkSizeWarningLimit: 1500 }, // maplibre-gl alone is ~1 MB
});
