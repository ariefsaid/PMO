import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { analyticsClient } from './client';
import { routeAnalyticsForPath } from './route';
import { safeTrack } from './safeTrack';

/**
 * One `route_first_data` per navigation: ms from the pathname change until no query is in flight
 * (the route's first data has rendered). Router-level, so no page wires it. Sends the route PATTERN
 * only (never the URL/query); consent is enforced inside `analyticsClient.capture`.
 * `temperature` is `cold` for the first navigation of a page load, `warm` afterwards.
 * ponytail: "no fetch in flight" is a proxy for first data; a page that fetches in a waterfall
 * reports the first quiet moment. Per-route marks only if the aggregate proves too coarse.
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
    const settle = () => {
      if (done || queryClient.isFetching() > 0) return;
      done = true;
      unsubscribe();
      safeTrack(() => analyticsClient.capture('route_first_data', {
        route,
        duration_ms: Math.round(performance.now() - start),
        temperature,
      }));
    };
    const unsubscribe = queryClient.getQueryCache().subscribe(settle);
    // Children start their fetches in their own effects, after this one: check on the next tick.
    const tick = setTimeout(settle, 0);
    return () => {
      done = true;
      clearTimeout(tick);
      unsubscribe();
    };
  }, [pathname, queryClient]);
}
