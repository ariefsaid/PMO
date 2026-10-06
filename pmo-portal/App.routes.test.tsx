import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router';
import React from 'react';
import { appRouteConfig } from './App';

describe('Application route table', () => {
  // Deliberate UX change (#765): /reports is no longer a placeholder — it is the management pack, behind
  // the revenue entitlement (FeatureRoute redirects to the dashboard when the module is off).
  it('AC-MMP-015: /reports resolves to the management pack behind the revenue entitlement', () => {
    const matches = matchRoutes(appRouteConfig, '/reports');
    const route = matches?.[matches.length - 1]?.route;

    expect(route?.path).toBe('/reports');
    expect(React.isValidElement(route?.element)).toBe(true);
    expect(route?.element).toMatchObject({ props: { feature: 'revenue' } });
  });

  // Profile language settings slice (supports AC-L10N-060): /settings/profile must resolve to a
  // real lazy page element, never the `*` catch-all.
  it('AC-L10N-060 support: /settings/profile resolves to the profile settings route', () => {
    const matches = matchRoutes(appRouteConfig, '/settings/profile');
    const route = matches?.[matches.length - 1]?.route;

    expect(route?.path).toBe('/settings/profile');
    expect(React.isValidElement(route?.element)).toBe(true);
  });

  it('AC-ADMIA-001/003: every Administration destination resolves to a real route element', () => {
    const paths = [
      '/administration',
      '/administration/users',
      '/administration/integrations',
      '/administration/accounting',
      '/administration/credits',
      '/administration/usage',
      '/administration/features',
    ];

    for (const path of paths) {
      const matches = matchRoutes(appRouteConfig, path);
      const route = matches?.[matches.length - 1]?.route;
      expect(route?.path, path).not.toBe('*');
      expect(React.isValidElement(route?.element), path).toBe(true);
    }
  });

  it('AC-ADMIA-003: an unknown Administration section resolves to its section fallback, not the global catch-all', () => {
    const matches = matchRoutes(appRouteConfig, '/administration/unknown');
    const route = matches?.[matches.length - 1]?.route;

    expect(route?.path).toBe('/administration/:section');
    expect(React.isValidElement(route?.element)).toBe(true);
  });
});
