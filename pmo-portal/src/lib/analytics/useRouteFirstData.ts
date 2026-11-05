import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { analyticsClient } from './client';
import { routeAnalyticsForPath } from './route';
import { safeTrack } from './safeTrack';

const IDLE_MS = 300; // a route that fetches nothing (or whose chunk is still loading) settles after this
const CAP_MS = 15_000; // slow pages are counted, never dropped

/**
 * One `route_first_data` per navigation, router-level (no page wires it). Sends the route PATTERN
 * only (never the URL/query); consent is enforced inside `analyticsClient.capture`.
 * Rule: settle when no query is in flight AND (a fetch has been seen since the navigation, or
 * IDLE_MS passed with nothing fetching). So a lazy chunk / auth gate that has not started its
 * queries yet is not reported as ~0 ms. Still unsettled after CAP_MS: sent with `timed_out: true`
 * (duration = cap). Navigating away unsettled: sent with `abandoned: true` and the elapsed ms.
 * `temperature` is `cold` for the first navigation of a page load, `warm` afterwards.
 * ponytail: global isFetching also counts carried-over/polling queries (the cap bounds that) and a
 * waterfall reports its first quiet moment. Per-route marks only if the aggregate proves too coarse.
 */
export function useRouteFirstData(): void {
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const navigations = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const temperature = navigations.current++ === 0 ? 'cold' : 'warm';
    const { route } = routeAnalyticsForPath(pathname);
    let done = false;
    let sawFetch = false;
    const send = (extra: { timed_out?: true; abandoned?: true } = {}) => {
      done = true;
      unsubscribe();
      clearTimeout(idle);
      clearTimeout(cap);
      safeTrack(() => analyticsClient.capture('route_first_data', {
        route,
        duration_ms: Math.round(performance.now() - start),
        temperature,
        ...extra,
      }));
    };
    const settle = (idleElapsed = false) => {
      if (done) return;
      if (queryClient.isFetching() > 0) { sawFetch = true; return; }
      if (sawFetch || idleElapsed) send();
    };
    const unsubscribe = queryClient.getQueryCache().subscribe(() => settle());
    const idle = setTimeout(() => settle(true), IDLE_MS);
    const cap = setTimeout(() => { if (!done) send({ timed_out: true }); }, CAP_MS);
    return () => {
      if (!done) send({ abandoned: true });
    };
  }, [pathname, queryClient]);
}
