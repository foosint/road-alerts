/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL (with trailing slash) of the folder holding roads.geojson and cities.geojson. */
  readonly VITE_DATA_URL?: string;
}
