import { useSyncExternalStore } from 'react';

/** Re-renders when the media query starts or stops matching. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    cb => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
