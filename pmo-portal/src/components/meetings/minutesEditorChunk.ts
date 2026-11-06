import { lazyWithPreload } from '@/src/lib/lazyWithPreload';

/**
 * The ONE lazy MinutesEditor (#1834). Both consumers (MeetingMinutes on the
 * detail route, MeetingCreate on the create form) used to declare their own
 * `React.lazy(() => import('./MinutesEditor'))`, so the editor chunk only
 * started downloading when each component rendered — after the meeting data
 * had arrived on detail. Sharing this module gives both render sites a single
 * memoized import and a `preload()` the route entry fires, so the editor
 * chunk downloads in parallel with the meeting read instead of after it.
 * (The editor module family still reaches the app only via import() — the
 * FR-MTG-026 bundle guard stays intact.)
 */
export const MinutesEditor = lazyWithPreload(() => import('./MinutesEditor'));

/** Fire-and-forget handle the route-entry preloader uses. */
export const preloadMinutesEditor = MinutesEditor.preload;
