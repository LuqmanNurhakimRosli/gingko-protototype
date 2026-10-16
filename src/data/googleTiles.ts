// Optional Google basemap through the official Google Maps Platform Map Tiles API
// (2D tiles). Enabled only when VITE_GOOGLE_MAPS_API_KEY is set at build time.
// A browser key is visible to users by design: restrict it to your site's
// HTTP referrers and to the Map Tiles API in Google Cloud Console.

export type GoogleMapType = 'roadmap' | 'satellite';

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const API = 'https://tile.googleapis.com';

export const googleAvailable = Boolean(KEY);

const sessions = new Map<GoogleMapType, Promise<string>>();

/** One session per map type; Google sessions last about two weeks. */
export function googleSession(mapType: GoogleMapType): Promise<string> {
  if (!KEY) return Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY is not set'));
  let s = sessions.get(mapType);
  if (!s) {
    s = fetch(`${API}/v1/createSession?key=${encodeURIComponent(KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapType, language: 'en-GB', region: 'MY' }),
    }).then(async r => {
      if (!r.ok) throw new Error(`Google createSession: HTTP ${r.status}`);
      const j = await r.json() as { session: string };
      return j.session;
    });
    s.catch(() => sessions.delete(mapType));
    sessions.set(mapType, s);
  }
  return s;
}

export function googleTileUrl(session: string): string {
  return `${API}/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(KEY ?? '')}`;
}

/** Copyright text Google asks you to show for the current view; null if unavailable. */
export async function googleCopyright(session: string, b: { north: number; south: number; east: number; west: number }, zoom: number): Promise<string | null> {
  try {
    const q = new URLSearchParams({
      session, key: KEY ?? '', zoom: String(Math.round(zoom)),
      north: String(b.north), south: String(b.south), east: String(b.east), west: String(b.west),
    });
    const r = await fetch(`${API}/tile/v1/viewport?${q}`);
    if (!r.ok) return null;
    const j = await r.json() as { copyright?: string };
    return j.copyright ?? null;
  } catch {
    return null;
  }
}
