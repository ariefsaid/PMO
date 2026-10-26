import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router';
import React from 'react';
import { appRouteConfig } from './App';

describe('Application route table', () => {
  // The legacy URL remains a deep-link and lands on its consolidated Earned report view.
  it('routes /reports through the legacy redirect into the consolidated report experience', () => {
    const matches = matchRoutes(appRouteConfig, '/reports');
    const route = matches?.[matches.length - 1]?.route;

    expect(route?.path).toBe('/reports');
    expect(React.isValidElement(route?.element)).toBe(true);
    expect(route?.element).toMatchObject({ props: { view: 'earned' } });
  });

  it('routes the legacy Billing URL through its redirect into consolidated project revenue', () => {
    const matches = matchRoutes(appRouteConfig, '/revenue-by-project');
    const route = matches?.[matches.length - 1]?.route;

    expect(route?.path).toBe('/revenue-by-project');
    expect(route?.element).toMatchObject({ props: { view: 'billing' } });
  });

  // Profile language settings slice (supports AC-L10N-060): /settings/profile must resolve to a
  // real lazy page element, never the `*` catch-all.
  it('AC-007 support: /financial-statements is a direct page route, not a revenue FeatureRoute', () => {
    const matches = matchRoutes(appRouteConfig, '/financial-statements');
    const route = matches?.[matches.length - 1]?.route;

    expect(route?.path).toBe('/financial-statements');
    expect(React.isValidElement(route?.element)).toBe(true);
    expect(route?.element).not.toMatchObject({ props: { feature: 'revenue' } });
  });

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
      '/administration/exchange-rates',
      '/administration/cost-attribution',
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
