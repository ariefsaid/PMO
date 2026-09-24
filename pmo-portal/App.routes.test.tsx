import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router';
import React from 'react';
import { appRouteConfig } from './App';

describe('Application route table', () => {
  it('AC-W2-IA-005: /reports resolves to the Reports placeholder route', () => {
    const matches = matchRoutes(appRouteConfig, '/reports');
    const route = matches?.[matches.length - 1]?.route;

    expect(route?.path).toBe('/reports');
    expect(React.isValidElement(route?.element)).toBe(true);
    expect(route?.element).toMatchObject({ props: { title: 'Reports' } });
  });

  // Profile language settings slice (supports AC-L10N-060): /settings/profile must resolve to a
  // real lazy page element, never the `*` catch-all.
  it('AC-L10N-060 support: /settings/profile resolves to the profile settings route', () => {
    const matches = matchRoutes(appRouteConfig, '/settings/profile');
    const route = matches?.[matches.length - 1]?.route;

    expect(route?.path).toBe('/settings/profile');
    expect(React.isValidElement(route?.element)).toBe(true);
  });
});
