import { describe, it, expect } from 'vitest';
import { breadcrumbForPath, MODULES } from '../routeMatch';

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
