import { describe, it, expect } from 'vitest';
import { breadcrumbForPath, recordLabelForPath, MODULES } from '../routeMatch';

/**
 * B-6 (AC-W2-IA-001): /approvals breadcrumb must resolve to "Approvals" not "Dashboard".
 * B-7 (AC-W2-IA-002): /companies and /incidents are first-class MODULES (promoted from
 *   PLACEHOLDER_TITLES) so the breadcrumb resolves through the module path and ⌘K Navigate
 *   includes them.
 */

// C-MIN-4: unknown route breadcrumb must read "Not found", not "Dashboard".
describe('breadcrumbForPath — unknown route (C-MIN-4)', () => {
  it('C-MIN-4: an unknown path resolves breadcrumb label to "Not found"', () => {
    const crumbs = breadcrumbForPath('/no-such-route');
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].label).toBe('Not found');
    expect(crumbs[0].label).not.toBe('Dashboard');
  });

  it('C-MIN-4: another unknown path also resolves to "Not found"', () => {
    const crumbs = breadcrumbForPath('/some/deeply/nested/unknown');
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].label).toBe('Not found');
  });

  it('C-MIN-4: real module paths are NOT affected', () => {
    // Dashboard still resolves correctly
    const crumbs = breadcrumbForPath('/');
    expect(crumbs[0].label).toBe('Dashboard');
  });
});

describe('breadcrumbForPath — IA cleanup (B-6/B-7)', () => {
  it('AC-W2-IA-001: /approvals resolves to "Approvals", not "Dashboard"', () => {
    const crumbs = breadcrumbForPath('/approvals');
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].label).toBe('Approvals');
    expect(crumbs[0].label).not.toBe('Dashboard');
  });

  it('AC-W2-IA-002: /companies resolves to "Companies" via MODULES (not placeholder fallback)', () => {
    const crumbs = breadcrumbForPath('/companies');
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].label).toBe('Companies');
    // Must be in MODULES so ⌘K Navigate includes it.
    expect(MODULES.some((m) => m.path === '/companies')).toBe(true);
  });

  it('AC-W2-IA-002: /incidents resolves to "Incidents" via MODULES', () => {
    const crumbs = breadcrumbForPath('/incidents');
    expect(crumbs).toHaveLength(1);
    expect(crumbs[0].label).toBe('Incidents');
    expect(MODULES.some((m) => m.path === '/incidents')).toBe(true);
  });
});

// CW-4a: /incidents/:id is now a routable detail page — the breadcrumb drills
// [Incidents (link) > <record>] and the record name resolves from the cached list.
describe('breadcrumbForPath / recordLabelForPath — incident detail (CW-4a)', () => {
  it('CW-4a: /incidents/:id breadcrumb reads [Incidents > <record>]', () => {
    const crumbs = breadcrumbForPath('/incidents/i1', 'Near Miss');
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0].label).toBe('Incidents');
    expect(crumbs[0].onClick).toBeTypeOf('function');
    expect(crumbs[1].label).toBe('Near Miss');
    expect(crumbs[1].onClick).toBeUndefined();
  });

  it('CW-4a: an unresolved incident crumb reads "Loading…" then "Not found" once settled', () => {
    expect(breadcrumbForPath('/incidents/i1')[1].label).toBe('Loading…');
    expect(breadcrumbForPath('/incidents/i1', undefined, undefined, true)[1].label).toBe('Not found');
  });

  it('CW-4a: incidents MODULE carries a detail pattern so the drill resolves', () => {
    const incidents = MODULES.find((m) => m.path === '/incidents');
    expect(incidents?.detail).toEqual({ pattern: '/incidents/:incidentId', param: 'incidentId' });
  });

  it('CW-4a: recordLabelForPath resolves an incident title from the cached list', () => {
    const label = recordLabelForPath('/incidents/i1', {
      incidents: [{ id: 'i1', type: 'Near Miss' }],
    });
    expect(label).toBe('Near Miss');
  });

  it('CW-4a: recordLabelForPath returns undefined for an uncached incident id', () => {
    expect(recordLabelForPath('/incidents/zzz', { incidents: [{ id: 'i1', type: 'Near Miss' }] })).toBeUndefined();
  });
});
