import React, { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/src/auth/useAuth';
import { getAnalyticsConfig, persistDemoContext } from './config';
import { analyticsClient } from './client';
import { routeAnalyticsForPath } from './route';

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

  // Route tracking on every navigation
  useEffect(() => {
    const route = routeAnalyticsForPath(`${location.pathname}${location.search}`);
    analyticsClient.capture('app_route_viewed', {
      ...route,
      role: role ?? undefined,
    });
  }, [location.pathname, location.search, role]);

  return <>{children}</>;
};
