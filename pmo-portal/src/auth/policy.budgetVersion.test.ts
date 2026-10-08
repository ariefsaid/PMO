import { describe, it, expect } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const ROLES: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];

const draft = (created_by: string | null) => ({ status: 'Draft', created_by });

describe('OD-BUDGET-6/DD-BUDGET-7 budget version activation policy (mirrors migration 0279)', () => {
  it('OD-BUDGET-6: a second person with a budget write role may activate another person\'s Draft', () => {
    const ctx = { currentUserId: 'u-me', record: draft('u-drafter') };
    expect(ROLES.filter((r) => can('transition', 'budgetVersion', { realRole: r, ...ctx })))
      .toEqual(['Admin', 'Executive', 'Project Manager', 'Finance']);
  });

  it('OD-BUDGET-6: the drafter may not activate their own version, whatever their role (Admin included)', () => {
    const ctx = { currentUserId: 'u-me', record: draft('u-me') };
    expect(ROLES.filter((r) => can('transition', 'budgetVersion', { realRole: r, ...ctx }))).toEqual([]);
  });

  it('DD-BUDGET-7: a line editor cannot activate even when they are not the drafter', () => {
    expect(can('transition', 'budgetVersion', {
      realRole: 'Project Manager', currentUserId: 'u-me',
      record: { ...draft('u-drafter'), editor_ids: ['u-drafter', 'u-me'] },
    })).toBe(false);
  });

  it('OD-BUDGET-6: a version with no recorded drafter may be activated by Admin or Finance only', () => {
    const ctx = { currentUserId: 'u-me', record: draft(null) };
    expect(ROLES.filter((r) => can('transition', 'budgetVersion', { realRole: r, ...ctx })))
      .toEqual(['Admin', 'Finance']);
  });

  it('OD-BUDGET-6: only a Draft is activatable, and an unknown caller is denied', () => {
    expect(can('transition', 'budgetVersion', {
      realRole: 'Admin', currentUserId: 'u-me', record: { status: 'Active', created_by: 'u-drafter' },
    })).toBe(false);
    expect(can('transition', 'budgetVersion', {
      realRole: 'Project Manager', currentUserId: null, record: draft('u-drafter'),
    })).toBe(false);
  });
});
