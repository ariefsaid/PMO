import { describe, it, expect } from 'vitest';
import { can } from '../policy';
import type { Role } from '../AuthContext';

/**
 * can(*, 'meeting') — #526 (OD-MTG-1/OD-MTG-2, migrations 0205/0206).
 *
 * The FE mirror of the 0205 policies: create = every role (Engineer included — the one widening
 * OD-MTG-1 grants); edit = the AUTHOR (created_by_id, trigger-stamped) or Admin; archive/delete
 * affordances = Admin (FE deliberately stricter than RLS). can() is UX only — RLS is the
 * authority (ADR-0016) — so these tests pin the FE is never LOOSER than the policy.
 */

const ALL_ROLES: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];

describe("can(create, 'meeting') — OD-MTG-1: every role minutes", () => {
  it.each(ALL_ROLES)('%s may create a meeting', (role) => {
    expect(can('create', 'meeting', { realRole: role })).toBe(true);
  });
  it('no role → denied (deny-by-default)', () => {
    expect(can('create', 'meeting', { realRole: null })).toBe(false);
  });
});

describe("can(view, 'meeting') — the page exists for every role (rows are RLS-scoped)", () => {
  it.each(ALL_ROLES)('%s may view the meetings surface', (role) => {
    expect(can('view', 'meeting', { realRole: role })).toBe(true);
  });
});

describe("can(edit, 'meeting') — record-scoped author-or-Admin, mirroring meetings_update (0205)", () => {
  it('the AUTHOR (any role, e.g. Engineer) may edit their own meeting', () => {
    expect(
      can('edit', 'meeting', {
        realRole: 'Engineer',
        currentUserId: 'u1',
        record: { created_by_id: 'u1' },
      }),
    ).toBe(true);
  });

  it('a NON-author may NOT edit — grants are view-only (OD-MTG-2), even for a PM', () => {
    expect(
      can('edit', 'meeting', {
        realRole: 'Project Manager',
        currentUserId: 'u2',
        record: { created_by_id: 'u1' },
      }),
    ).toBe(false);
  });

  it('Admin may edit a meeting they did not author', () => {
    expect(
      can('edit', 'meeting', {
        realRole: 'Admin',
        currentUserId: 'u2',
        record: { created_by_id: 'u1' },
      }),
    ).toBe(true);
  });

  it('deny-by-default authorship: no record context → only Admin passes', () => {
    expect(can('edit', 'meeting', { realRole: 'Executive', currentUserId: 'u1' })).toBe(false);
    expect(can('edit', 'meeting', { realRole: 'Admin', currentUserId: 'u1' })).toBe(true);
  });

  it('no currentUserId → a non-Admin cannot prove authorship → denied', () => {
    expect(
      can('edit', 'meeting', { realRole: 'Engineer', record: { created_by_id: 'u1' } }),
    ).toBe(false);
  });
});

describe("can(archive/delete, 'meeting') — Admin-only affordances (FE stricter than RLS)", () => {
  it.each(ALL_ROLES.filter((r) => r !== 'Admin'))('%s may not archive or delete', (role) => {
    expect(can('archive', 'meeting', { realRole: role })).toBe(false);
    expect(can('delete', 'meeting', { realRole: role })).toBe(false);
  });
  it('Admin may archive and delete', () => {
    expect(can('archive', 'meeting', { realRole: 'Admin' })).toBe(true);
    expect(can('delete', 'meeting', { realRole: 'Admin' })).toBe(true);
  });
});
