import { describe, it, expect } from 'vitest';
import { breadcrumbForPath, MODULES } from '../routeMatch';

/**
 * B-6 (AC-W2-IA-001): /approvals breadcrumb must resolve to "Approvals" not "Dashboard".
 * B-7 (AC-W2-IA-002): /companies and /incidents are first-class MODULES (promoted from
 *   PLACEHOLDER_TITLES) so the breadcrumb resolves through the module path and ⌘K Navigate
 *   includes them.
 */

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
