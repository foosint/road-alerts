/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL (with trailing slash) of the folder holding roads.geojson and cities.geojson. */
  readonly VITE_DATA_URL?: string;
  /** "true" shows the TG Reports tab and loads the Telegram events; anything else turns it off. */
  readonly VITE_TELEGRAM_ENABLED?: string;
  /** Base URL (with trailing slash) of the folder holding the Telegram events.json. */
  readonly VITE_TELEGRAM_DATA_URL?: string;
}
