import { describe, expect, it } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const ROLES: Role[] = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];
const as = (realRole: Role, record: Record<string, unknown> = {}, currentUserId = 'u-1') => ({ realRole, currentUserId, record });

describe('contract quantities policy (ADR-0091)', () => {
  it.each([['Admin', true], ['Executive', true], ['Project Manager', true], ['Finance', true], ['Engineer', false]] as const)(
    'AC-CQ-015 %s allocates contract lines to a Draft or Issued work order: %s', (role, allowed) => {
      for (const status of ['Draft', 'Issued']) {
        expect(can('create', 'workOrderLine', as(role, { status }))).toBe(allowed);
        expect(can('edit', 'workOrderLine', as(role, { status }))).toBe(allowed);
        expect(can('delete', 'workOrderLine', as(role, { status }))).toBe(allowed);
      }
    });

  it('AC-CQ-015 allocations are frozen on Closed and Cancelled work orders, and unknown state is denied', () => {
    for (const status of ['Closed', 'Cancelled', undefined]) {
      expect(can('create', 'workOrderLine', as('Admin', { status }))).toBe(false);
      expect(can('edit', 'workOrderLine', as('Admin', { status }))).toBe(false);
      expect(can('delete', 'workOrderLine', as('Admin', { status }))).toBe(false);
    }
  });

  it('AC-CQ-015 allocations are visible to the BoQ roles even when frozen', () => {
    expect(can('view', 'workOrderLine', as('Finance', { status: 'Closed' }))).toBe(true);
    expect(can('view', 'workOrderLine', as('Engineer'))).toBe(false);
  });

  it("AC-CQ-015 preparing a BAST is the project's own PM or Finance rank and above, on an Issued work order only", () => {
    const issued = { status: 'Issued', project_manager_id: 'pm-1' };
    expect(can('create', 'workOrderAcceptance', as('Project Manager', issued, 'pm-1'))).toBe(true);
    expect(can('create', 'workOrderAcceptance', as('Project Manager', issued, 'pm-2'))).toBe(false);
    for (const role of ['Admin', 'Executive', 'Finance'] as const) {
      expect(can('create', 'workOrderAcceptance', as(role, issued))).toBe(true);
    }
    expect(can('create', 'workOrderAcceptance', as('Engineer', issued, 'pm-1'))).toBe(false);
    for (const status of ['Draft', 'Closed', 'Cancelled', undefined]) {
      expect(can('create', 'workOrderAcceptance', as('Finance', { ...issued, status }))).toBe(false);
    }
  });

  it('AC-CQ-015 only Admin or Finance confirms a Draft BAST, and the preparer is offered it too (the server decides the sole-operator exception)', () => {
    const draft = { status: 'Draft', prepared_by: 'prep-1' };
    expect(can('confirm', 'workOrderAcceptance', as('Finance', draft, 'fin-1'))).toBe(true);
    expect(can('confirm', 'workOrderAcceptance', as('Admin', draft, 'adm-1'))).toBe(true);
    for (const role of ['Executive', 'Project Manager', 'Engineer'] as const) {
      expect(can('confirm', 'workOrderAcceptance', as(role, draft, 'x'))).toBe(false);
    }
    expect(can('confirm', 'workOrderAcceptance', as('Finance', draft, 'prep-1'))).toBe(true);
    for (const status of ['Confirmed', 'Withdrawn', undefined]) {
      expect(can('confirm', 'workOrderAcceptance', as('Finance', { ...draft, status }, 'fin-1'))).toBe(false);
    }
  });

  it('AC-CQ-015 the preparer, Admin or Finance withdraws a Draft BAST — nobody else, and nothing already decided', () => {
    const draft = { status: 'Draft', prepared_by: 'prep-1' };
    expect(can('withdraw', 'workOrderAcceptance', as('Project Manager', draft, 'prep-1'))).toBe(true);
    expect(can('withdraw', 'workOrderAcceptance', as('Admin', draft, 'adm-1'))).toBe(true);
    expect(can('withdraw', 'workOrderAcceptance', as('Finance', draft, 'fin-1'))).toBe(true);
    expect(can('withdraw', 'workOrderAcceptance', as('Project Manager', draft, 'pm-2'))).toBe(false);
    expect(can('withdraw', 'workOrderAcceptance', as('Executive', draft, 'ex-1'))).toBe(false);
    expect(can('withdraw', 'workOrderAcceptance', as('Finance', { ...draft, status: 'Confirmed' }, 'fin-1'))).toBe(false);
  });

  it('AC-CQ-015 every role may view acceptances it can read the work order for, Engineer excluded like billing', () => {
    expect(can('view', 'workOrderAcceptance', as('Finance'))).toBe(true);
    expect(can('view', 'workOrderAcceptance', as('Engineer'))).toBe(false);
  });

  it('AC-CQ-015 impersonation is view-only: no write affordance survives a view-as session', () => {
    const viewOnly = { viewOnly: true };
    expect(can('create', 'workOrderLine', as('Admin', { status: 'Issued', ...viewOnly }))).toBe(false);
    expect(can('delete', 'workOrderLine', as('Admin', { status: 'Issued', ...viewOnly }))).toBe(false);
    expect(can('create', 'workOrderAcceptance', as('Admin', { status: 'Issued', ...viewOnly }))).toBe(false);
    expect(can('confirm', 'workOrderAcceptance', as('Admin', { status: 'Draft', prepared_by: 'x', ...viewOnly }, 'adm-1'))).toBe(false);
    expect(can('withdraw', 'workOrderAcceptance', as('Admin', { status: 'Draft', prepared_by: 'x', ...viewOnly }, 'adm-1'))).toBe(false);
  });

  it('AC-CQ-015 deny-by-default: a null role or missing context grants nothing', () => {
    expect(can('create', 'workOrderLine')).toBe(false);
    expect(can('confirm', 'workOrderAcceptance', { realRole: null })).toBe(false);
    for (const role of ROLES) expect(can('edit', 'workOrderAcceptance', as(role, { status: 'Draft' }))).toBe(false);
  });
});
