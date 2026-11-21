/**
 * Reading the phone's position, ONCE (#2705). The only caller of the browser geolocation API is the clock-in section: it reads on a
 * tap, never watches, never stores the permission state. Position is used by the database to decide inside / outside the work-order area.
 */
export interface Fix { lat: number; lng: number; accuracy: number }
export type PositionFailure = 'denied' | 'unavailable' | 'timeout';
export class PositionError extends Error {
  constructor(readonly reason: PositionFailure) { super(`position ${reason}`); this.name = 'PositionError'; }
}

/** One `getCurrentPosition` call. Rejects with a PositionError. */
export function readPositionOnce(timeoutMs = 15000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { reject(new PositionError('unavailable')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new PositionError(e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable')),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

interface PolicyLike { allowsFeature?: (feature: string) => boolean }
/**
 * Does THIS document's permissions policy allow geolocation? The policy is per response: a client-side navigation into `/my` keeps
 * the policy of the page that was loaded first. Where the browser cannot say, assume yes (the call itself will then fail visibly).
 */
export function documentAllowsGeolocation(doc: Document = document): boolean {
  const d = doc as Document & { permissionsPolicy?: PolicyLike; featurePolicy?: PolicyLike };
  const policy = d.permissionsPolicy ?? d.featurePolicy;
  if (policy && typeof policy.allowsFeature === 'function') return policy.allowsFeature('geolocation');
  return true;
}

const RESUME_KEY = 'pmo.clockin.resumed';
/** Where to go to get a document that allows geolocation, at most once per work order per tab (no loop). */
export function hardNavigateForGeolocation(workOrderId: string, nav: { assign: (url: string) => void } = window.location): boolean {
  try {
    if (window.sessionStorage.getItem(RESUME_KEY) === workOrderId) return false;
    window.sessionStorage.setItem(RESUME_KEY, workOrderId);
  } catch { return false; }
  nav.assign(`/my?clockin=${encodeURIComponent(workOrderId)}`);
  return true;
}
export function clearResumeGuard(): void { try { window.sessionStorage.removeItem(RESUME_KEY); } catch { /* storage unavailable */ } }
