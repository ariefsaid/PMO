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

  describe('route sanitization — PII / unknown route protection', () => {
    it('AC-PH-ROUTE-001: email-like tab_id under /projects/:id is replaced with "unknown_tab"', () => {
      expect(routeAnalyticsForPath('/projects/abc-123/alice@example.com')).toEqual({
        route: '/projects/:projectId/:tab',
        module: 'projects',
        tab_id: 'unknown_tab',
      });
    });

    it('AC-PH-ROUTE-002: tab_id with special characters is replaced with "unknown_tab"', () => {
      expect(routeAnalyticsForPath('/projects/abc-123/tab with spaces')).toEqual({
        route: '/projects/:projectId/:tab',
        module: 'projects',
        tab_id: 'unknown_tab',
      });
    });

    it('AC-PH-ROUTE-003: unknown top-level route like /client-name uses route:"/unknown" and module:"unknown"', () => {
      expect(routeAnalyticsForPath('/client-name')).toEqual({
        route: '/unknown',
        module: 'unknown',
      });
    });

    it('AC-PH-ROUTE-004: email as top-level route uses route:"/unknown" and module:"unknown"', () => {
      expect(routeAnalyticsForPath('/alice@example.com')).toEqual({
        route: '/unknown',
        module: 'unknown',
      });
    });
  });

  describe('App.tsx top-level routes', () => {
    it('AC-PH-ROUTE-005: maps /approvals to route:"/approvals" and module:"approvals"', () => {
      expect(routeAnalyticsForPath('/approvals')).toEqual({
        route: '/approvals',
        module: 'approvals',
      });
    });

    it('AC-PH-ROUTE-006: maps /timesheets to route:"/timesheets" and module:"timesheets"', () => {
      expect(routeAnalyticsForPath('/timesheets')).toEqual({
        route: '/timesheets',
        module: 'timesheets',
      });
    });

    it('AC-PH-ROUTE-007: maps /companies to route:"/companies" and module:"companies"', () => {
      expect(routeAnalyticsForPath('/companies')).toEqual({
        route: '/companies',
        module: 'companies',
      });
    });

    it('AC-PH-ROUTE-008: maps /incidents to route:"/incidents" and module:"incidents"', () => {
      expect(routeAnalyticsForPath('/incidents')).toEqual({
        route: '/incidents',
        module: 'incidents',
      });
    });

    it('AC-PH-ROUTE-009: maps /my-tasks to route:"/my-tasks" and module:"my-tasks"', () => {
      expect(routeAnalyticsForPath('/my-tasks')).toEqual({
        route: '/my-tasks',
        module: 'my-tasks',
      });
    });

    it('AC-PH-ROUTE-010: maps /reports to route:"/reports" and module:"reports"', () => {
      expect(routeAnalyticsForPath('/reports')).toEqual({
        route: '/reports',
        module: 'reports',
      });
    });

    it('AC-PH-ROUTE-011: maps /administration to route:"/administration" and module:"administration"', () => {
      expect(routeAnalyticsForPath('/administration')).toEqual({
        route: '/administration',
        module: 'administration',
      });
    });
  });
});
