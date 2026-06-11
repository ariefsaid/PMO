import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/src/auth/useAuth';
import { getAnalyticsConfig } from './config';
import { analyticsClient } from './client';
import { routeAnalyticsForPath } from './route';

export const AnalyticsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const { currentUser, role } = useAuth();
  const identifiedUserRef = useRef<string | null>(null);
  const config = getAnalyticsConfig();

  // Init + register environment context once (or when key config changes)
  useEffect(() => {
    analyticsClient.init(config);
    analyticsClient.register({
      environment: config.appEnv,
      demo_audience: config.demoMode ? config.demoAudience : undefined,
      demo_account: config.demoMode ? config.demoAccount : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- config is derived from env, stable
  }, [config.enabled, config.demoAudience, config.demoAccount, config.replayAndAutocapture]);

  // Identity sync: identify on login, reset on logout
  useEffect(() => {
    if (currentUser?.id && currentUser.org_id && role) {
      identifiedUserRef.current = currentUser.id;
      analyticsClient.identify({
        userId: currentUser.id,
        role,
        orgId: currentUser.org_id,
      });
    } else if (identifiedUserRef.current) {
      identifiedUserRef.current = null;
      analyticsClient.reset();
    }
  }, [currentUser?.id, currentUser?.org_id, role]);

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
