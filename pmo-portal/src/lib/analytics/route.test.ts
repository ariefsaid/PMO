import { describe, expect, it } from 'vitest';
import { routeAnalyticsForPath } from './route';

describe('routeAnalyticsForPath', () => {
  it('AC-PH-011: strips UUIDs and query strings from project detail routes', () => {
    expect(routeAnalyticsForPath('/projects/d0000000-0000-0000-0000-000000000001?x=y')).toEqual({
      route: '/projects/:projectId',
      module: 'projects',
    });
  });

  it('tracks project tabs as safe patterns', () => {
    expect(routeAnalyticsForPath('/projects/d0000000-0000-0000-0000-000000000001/budget')).toEqual({
      route: '/projects/:projectId/:tab',
      module: 'projects',
      tab_id: 'budget',
    });
  });

  it('tracks procurement detail as a safe pattern', () => {
    expect(routeAnalyticsForPath('/procurement/60000000-0000-0000-0000-000000000001')).toEqual({
      route: '/procurement/:procurementId',
      module: 'procurement',
    });
  });

  it('maps root path to dashboard', () => {
    expect(routeAnalyticsForPath('/')).toEqual({ route: '/', module: 'dashboard' });
  });

  it('maps login path to auth module', () => {
    expect(routeAnalyticsForPath('/login')).toEqual({ route: '/login', module: 'auth' });
  });

  it('strips query strings from all paths', () => {
    expect(routeAnalyticsForPath('/projects?tab=all')).toEqual({
      route: '/projects',
      module: 'projects',
    });
  });

  it('maps /projects to projects module', () => {
    expect(routeAnalyticsForPath('/projects')).toEqual({
      route: '/projects',
      module: 'projects',
    });
  });

  it('maps /procurement to procurement module', () => {
    expect(routeAnalyticsForPath('/procurement')).toEqual({
      route: '/procurement',
      module: 'procurement',
    });
  });

  it('maps sales detail to sales module', () => {
    expect(routeAnalyticsForPath('/sales/abc123')).toEqual({
      route: '/sales/:opportunityId',
      module: 'sales',
    });
  });

  it('falls back unknown segments to their module name', () => {
    expect(routeAnalyticsForPath('/settings')).toEqual({
      route: '/settings',
      module: 'settings',
    });
  });
});
