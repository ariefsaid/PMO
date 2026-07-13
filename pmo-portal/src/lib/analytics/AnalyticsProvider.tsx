import React, { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/src/auth/useAuth';
import { getAnalyticsConfig, persistDemoContext } from './config';
import { analyticsClient } from './client';
import { safeTrack } from './safeTrack';
import { routeAnalyticsForPath } from './route';
import { rejectionMessage } from './rejectionMessage';

const baseSuperProperties = (cfg: {
  appEnv: string;
  demoMode: boolean;
  demoAudience: string;
  demoAccount: string;
}) => ({
  environment: cfg.appEnv,
  demo_audience: cfg.demoMode ? cfg.demoAudience : undefined,
  demo_account: cfg.demoMode ? cfg.demoAccount : undefined,
});

export const AnalyticsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const { currentUser, role } = useAuth();
  const identifiedUserRef = useRef<string | null>(null);

  // Memoize config to provide stable reference for useEffect deps
  const config = useMemo(() => getAnalyticsConfig(), []);

  // Memoize base super properties to avoid recalculating on every render
  const superProperties = useMemo(() => baseSuperProperties(config), [config]);

  // Init + register environment context once (or when key config changes)
  useEffect(() => {
    analyticsClient.init(config);
    analyticsClient.register(superProperties);
    if (config.demoMode) {
      persistDemoContext(config, window.sessionStorage);
    }
  }, [config, superProperties]);

  // Identity sync: identify on login, reset on logout
  useEffect(() => {
    if (currentUser?.id && currentUser?.org_id && role) {
      identifiedUserRef.current = currentUser.id;
      analyticsClient.identify({
        userId: currentUser.id,
        role,
        orgId: currentUser.org_id,
      });
    } else if (identifiedUserRef.current) {
      identifiedUserRef.current = null;
      analyticsClient.reset();
      // Re-register base context so post-logout route/login events retain super properties
      analyticsClient.register(superProperties);
    }
  }, [currentUser?.id, currentUser?.org_id, role, superProperties]);

  // Global exception capture (FR-OF-013) — registered once, routed through safeTrack so a
  // PostHog fault can never propagate into the window's own event-dispatch machinery.
  useEffect(() => {
    if (!config.enabled) return;
    const onError = (event: ErrorEvent) => {
      safeTrack(() =>
        analyticsClient.captureException({
          name: event.error?.name ?? 'Error',
          message: event.message,
        }),
      );
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      safeTrack(() =>
        analyticsClient.captureException({
          name: reason instanceof Error ? reason.name : 'UnhandledRejection',
          // 2026-07-13 fix: `String(reason)` on a rejected plain-object reason (e.g. a
          // Supabase PostgrestError, never an Error instance) produced the literal
          // "[object Object]" with zero diagnostic content — rejectionMessage() pulls
          // the real .message/.error_description/.error a Postgrest/OAuth-shaped
          // reason actually carries.
          message: rejectionMessage(reason),
        }),
      );
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [config.enabled]);

  // Route tracking on every navigation — fire only when pathname+search actually
  // change, NOT when role hydrates on the same route.
  const trackedPathRef = useRef<string | null>(null);
  useEffect(() => {
    const pathKey = `${location.pathname}${location.search}`;
    if (pathKey === trackedPathRef.current) return;
    trackedPathRef.current = pathKey;
    const route = routeAnalyticsForPath(pathKey);
    analyticsClient.capture('app_route_viewed', {
      ...route,
      role: role ?? undefined,
    });
  }, [location.pathname, location.search, role]);

  return <>{children}</>;
};
