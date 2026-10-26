import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router';
import React from 'react';
import { appRouteConfig, contentPageFrameReturnKey, usesContentPageFramePath } from './App';

describe('Application route table', () => {
  it('opts all money-out routes into the shared frame and supplies parent labels for phone returns', () => {
    const routes = [
      '/procurement', '/procurement/new', '/procurement/proc-1', '/procurement/proc-1/items',
      '/procurement/proc-1/activity', '/erp-purchases', '/expenses', '/expenses/new', '/expenses/claim-1',
    ];
    for (const path of routes) expect(usesContentPageFramePath(path), path).toBe(true);
    expect(contentPageFrameReturnKey('/procurement')).toBeUndefined();
    expect(contentPageFrameReturnKey('/procurement/new')).toBe('procurement');
    expect(contentPageFrameReturnKey('/procurement/proc-1/activity')).toBe('procurement');
    expect(contentPageFrameReturnKey('/erp-purchases')).toBe('procurement');
    expect(contentPageFrameReturnKey('/expenses')).toBeUndefined();
    expect(contentPageFrameReturnKey('/expenses/new')).toBe('expenses');
    expect(contentPageFrameReturnKey('/expenses/claim-1')).toBe('expenses');
  });

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
