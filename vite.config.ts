import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));

// For `npm run dev` / `npm run preview`: serve /data/*.geojson from the sibling
// road-alerts-data checkout, so local changes show up without pushing.
const LOCAL_DATA_DIRS = ['../road-alerts-data/data', '../road-alerts-backend/data'].map((d) => path.resolve(root, d));

function localData(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const name = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\/+/, '');
    if (!/^[\w.-]+\.geojson$/.test(name)) return next();
    const dir = LOCAL_DATA_DIRS.find((d) => fs.existsSync(path.join(d, name)));
    if (!dir) return next();
    res.setHeader('Content-Type', 'application/geo+json');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(path.join(dir, name)).pipe(res);
  };
  return {
    name: 'local-data',
    configureServer: (server) => void server.middlewares.use('/data', handler),
    configurePreviewServer: (server) => void server.middlewares.use('/data', handler),
  };
}

// Relative base so the build works under https://<user>.github.io/road-alerts/
export default defineConfig({
  base: './',
  plugins: [react(), localData()],
  build: { chunkSizeWarningLimit: 1500 }, // maplibre-gl alone is ~1 MB
});
