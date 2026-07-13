/**
 * chunkReload — a ONE-TIME guarded auto-reload for a stale lazy-route chunk.
 *
 * Root cause (live PostHog, 2026-07-13): `TypeError: Failed to fetch dynamically
 * imported module: .../SalesPipeline-*.js` — a browser tab left open across a
 * redeploy still holds the OLD `index.html`'s asset manifest, so a route-level
 * `React.lazy()` import 404s against the NEW build's hashed filenames. The fix
 * everyone else's app does: reload once to pick up the fresh manifest.
 */
import { safeTrack } from './analytics/safeTrack';

/** The known cross-browser phrasings of a stale dynamic-import failure. */
const CHUNK_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

/**
 * Pure predicate: true when `message` looks like a stale-chunk dynamic-import
 * failure AND this session hasn't already reloaded for one (the guard that
 * prevents a reload loop if the SAME stale chunk somehow keeps failing).
 */
export function shouldReloadForChunkError(message: string, alreadyReloaded: boolean): boolean {
  if (alreadyReloaded) return false;
  if (!message) return false;
  return CHUNK_ERROR_PATTERN.test(message);
}

/** sessionStorage key marking "already reloaded once for a stale chunk this tab session". */
export const CHUNK_RELOAD_SESSION_KEY = 'pmo_chunk_reloaded';

/**
 * Installs the `window` `error`/`unhandledrejection` listeners that reload the tab
 * ONCE when a lazy-route chunk import fails (stale post-deploy manifest). Routed
 * through `safeTrack` (NFR-APH-REL-001 pattern) so a fault in the guard itself
 * (e.g. `sessionStorage` disabled in a locked-down browser) can never throw into
 * the window's own event-dispatch machinery. Call once from the app entry.
 */
export function installChunkReloadGuard(): void {
  const handle = (message: string): void => {
    // NFR-APH-REL-001 pattern (safeTrack): a broken guard (e.g. sessionStorage
    // disabled) must never crash error handling itself.
    safeTrack(() => {
      const alreadyReloaded = window.sessionStorage.getItem(CHUNK_RELOAD_SESSION_KEY) === '1';
      if (!shouldReloadForChunkError(message, alreadyReloaded)) return;
      window.sessionStorage.setItem(CHUNK_RELOAD_SESSION_KEY, '1');
      window.location.reload();
    });
  };

  window.addEventListener('error', (event: ErrorEvent) => handle(event.message ?? ''));
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason as unknown;
    const message =
      reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
    handle(message);
  });
}
