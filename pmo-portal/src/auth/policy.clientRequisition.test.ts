import { describe, it, expect } from 'vitest';
import { can } from './policy';

/**
 * #2585 client material requisitions - the UX gates (ADR-0016, FR-CSR-021). They mirror the csr_* RPCs in 1087;
 * the database is the authority (csr_requisition.test.sql / csr_pickup.test.sql prove the refusals). View-as is view-only.
 */
const roles = ['Admin', 'Executive', 'Finance', 'Project Manager', 'Engineer'] as const;
const open = { status: 'open' };

describe('clientRequisition policy', () => {
  it.each(roles)('FR-CSR-021 %s: every member views and raises a requisition; view-as cannot', (role) => {
    expect(can('view', 'clientRequisition', { realRole: role })).toBe(true);
    expect(can('create', 'clientRequisition', { realRole: role })).toBe(true);
    expect(can('create', 'clientRequisition', { realRole: role, record: { viewOnly: true } })).toBe(false);
  });

  it('FR-CSR-021 deny by default', () => {
    for (const a of ['view', 'create', 'edit', 'send', 'cancel', 'recordReservation', 'recordRelease', 'recordPickup'] as const) {
      expect(can(a, 'clientRequisition', { realRole: null })).toBe(false);
    }
  });

  it('FR-CSR-004 the author (or an Admin) edits and sends a draft only', () => {
    const ctx = (role: (typeof roles)[number], status: string, created_by: string) => ({ realRole: role, currentUserId: 'u1', record: { status, created_by } });
    expect(can('edit', 'clientRequisition', ctx('Engineer', 'draft', 'u1'))).toBe(true);
    expect(can('send', 'clientRequisition', ctx('Engineer', 'draft', 'u1'))).toBe(true);
    expect(can('edit', 'clientRequisition', ctx('Engineer', 'open', 'u1'))).toBe(false);
    expect(can('send', 'clientRequisition', ctx('Engineer', 'draft', 'u2'))).toBe(false);
    expect(can('send', 'clientRequisition', ctx('Admin', 'draft', 'u2'))).toBe(true);
    expect(can('send', 'clientRequisition', { ...ctx('Engineer', 'draft', 'u1'), record: { status: 'draft', created_by: 'u1', viewOnly: true } })).toBe(false);
  });

  it('FR-CSR-004 cancel: author or Admin, draft or open, never once a pickup is posted', () => {
    const ctx = (record: Record<string, unknown>, role: (typeof roles)[number] = 'Engineer') => ({ realRole: role, currentUserId: 'u1', record });
    expect(can('cancel', 'clientRequisition', ctx({ status: 'open', created_by: 'u1' }))).toBe(true);
    expect(can('cancel', 'clientRequisition', ctx({ status: 'open', created_by: 'u1', hasPickup: true }))).toBe(false);
    expect(can('cancel', 'clientRequisition', ctx({ status: 'cancelled', created_by: 'u1' }))).toBe(false);
    expect(can('cancel', 'clientRequisition', ctx({ status: 'open', created_by: 'u2' }))).toBe(false);
    expect(can('cancel', 'clientRequisition', ctx({ status: 'open', created_by: 'u2' }, 'Admin'))).toBe(true);
  });

  it.each(roles)('FR-CSR-006/008 %s: a reservation or release needs Project Manager or above, on an open requisition', (role) => {
    const allowed = role !== 'Engineer';
    expect(can('recordReservation', 'clientRequisition', { realRole: role, record: open })).toBe(allowed);
    expect(can('recordRelease', 'clientRequisition', { realRole: role, record: open })).toBe(allowed);
    expect(can('recordReservation', 'clientRequisition', { realRole: role, record: { status: 'cancelled' } })).toBe(false);
    expect(can('recordRelease', 'clientRequisition', { realRole: role, record: { ...open, viewOnly: true } })).toBe(false);
  });

  it('FR-CSR-010/021 a pickup is for the keeper of the receiving location or an Admin, on an open requisition', () => {
    expect(can('recordPickup', 'clientRequisition', { realRole: 'Engineer', record: { ...open, isKeeper: true } })).toBe(true);
    expect(can('recordPickup', 'clientRequisition', { realRole: 'Engineer', record: open })).toBe(false);
    expect(can('recordPickup', 'clientRequisition', { realRole: 'Project Manager', record: open })).toBe(false);
    expect(can('recordPickup', 'clientRequisition', { realRole: 'Admin', record: open })).toBe(true);
    expect(can('recordPickup', 'clientRequisition', { realRole: 'Admin', record: { status: 'draft' } })).toBe(false);
    expect(can('recordPickup', 'clientRequisition', { realRole: 'Admin', record: { ...open, viewOnly: true } })).toBe(false);
  });
});
