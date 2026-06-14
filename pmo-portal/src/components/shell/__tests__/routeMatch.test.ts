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

// CW-4b: /companies/:id and /contacts/:id are now routable detail pages (retiring the
// drawer-as-record) — the breadcrumb drills [Module (link) > <record>] and the record name
// resolves from the cached list.
describe('breadcrumbForPath / recordLabelForPath — company + contact detail (CW-4b)', () => {
  it('CW-4b: /companies/:id breadcrumb reads [Companies > <record>]', () => {
    const crumbs = breadcrumbForPath('/companies/co1', 'Cascade Port Authority');
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0].label).toBe('Companies');
    expect(crumbs[0].onClick).toBeTypeOf('function');
    expect(crumbs[1].label).toBe('Cascade Port Authority');
    expect(crumbs[1].onClick).toBeUndefined();
  });

  it('CW-4b: /contacts/:id breadcrumb reads [Contacts > <record>]', () => {
    const crumbs = breadcrumbForPath('/contacts/ct1', 'Jane Doe');
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0].label).toBe('Contacts');
    expect(crumbs[1].label).toBe('Jane Doe');
  });

  it('CW-4b: an unresolved company crumb reads "Loading…" then "Not found" once settled', () => {
    expect(breadcrumbForPath('/companies/co1')[1].label).toBe('Loading…');
    expect(breadcrumbForPath('/companies/co1', undefined, undefined, true)[1].label).toBe('Not found');
  });

  it('CW-4b: companies + contacts MODULES carry a detail pattern so the drill resolves', () => {
    expect(MODULES.find((m) => m.path === '/companies')?.detail).toEqual({
      pattern: '/companies/:companyId',
      param: 'companyId',
    });
    expect(MODULES.find((m) => m.path === '/contacts')?.detail).toEqual({
      pattern: '/contacts/:contactId',
      param: 'contactId',
    });
  });

  it('CW-4b: recordLabelForPath resolves a company name + a contact full_name from the cached lists', () => {
    expect(
      recordLabelForPath('/companies/co1', { companies: [{ id: 'co1', name: 'Cascade Port Authority' }] }),
    ).toBe('Cascade Port Authority');
    expect(
      recordLabelForPath('/contacts/ct1', { contacts: [{ id: 'ct1', full_name: 'Jane Doe' }] }),
    ).toBe('Jane Doe');
  });

  it('CW-4b: recordLabelForPath returns undefined for an uncached company/contact id', () => {
    expect(
      recordLabelForPath('/companies/zzz', { companies: [{ id: 'co1', name: 'Cascade Port Authority' }] }),
    ).toBeUndefined();
    expect(
      recordLabelForPath('/contacts/zzz', { contacts: [{ id: 'ct1', full_name: 'Jane Doe' }] }),
    ).toBeUndefined();
  });
});
