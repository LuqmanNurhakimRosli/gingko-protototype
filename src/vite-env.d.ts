/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional: enables the Google Map / Satellite basemaps (Map Tiles API). */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
