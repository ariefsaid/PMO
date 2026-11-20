import { describe, it, expect } from 'vitest';
import { can } from './policy';

/**
 * #2524 material requests — the UX gates (ADR-0016). They mirror mrq_* RPCs in 1001; the database is the authority
 * (mrq_approval.test.sql proves the refusals). View-as sessions are view-only.
 */
const roles = ['Admin', 'Executive', 'Finance', 'Project Manager', 'Engineer'] as const;

describe('materialRequest policy', () => {
  it.each(roles)('FR-MRQ-016 %s: every member views and raises a request; nobody without a role does', (role) => {
    expect(can('view', 'materialRequest', { realRole: role })).toBe(true);
    expect(can('create', 'materialRequest', { realRole: role })).toBe(true);
    expect(can('create', 'materialRequest', { realRole: role, record: { viewOnly: true } })).toBe(false);
  });

  it('FR-MRQ-016 deny by default', () => {
    expect(can('view', 'materialRequest', { realRole: null })).toBe(false);
    expect(can('create', 'materialRequest', { realRole: null })).toBe(false);
  });

  it('FR-MRQ-003 only the author edits and submits, and only a draft', () => {
    const ctx = (status: string, created_by: string) => ({ realRole: 'Engineer' as const, currentUserId: 'u1', record: { status, created_by } });
    expect(can('edit', 'materialRequest', ctx('draft', 'u1'))).toBe(true);
    expect(can('edit', 'materialRequest', ctx('pending', 'u1'))).toBe(false);
    expect(can('edit', 'materialRequest', ctx('draft', 'u2'))).toBe(false);
    expect(can('withdraw', 'materialRequest', ctx('pending', 'u1'))).toBe(true);
    expect(can('withdraw', 'materialRequest', ctx('approved', 'u1'))).toBe(false);
  });

  it('AC-MRQ-003/005 decide: the open step is offered to its queue entry, never to the author or a view-as session', () => {
    const base = { realRole: 'Project Manager' as const, currentUserId: 'u1' };
    expect(can('decide', 'materialRequest', { ...base, record: { created_by: 'u2', inMyQueue: true } })).toBe(true);
    expect(can('decide', 'materialRequest', { ...base, record: { created_by: 'u2', inMyQueue: false } })).toBe(false);
    expect(can('decide', 'materialRequest', { ...base, record: { created_by: 'u1', inMyQueue: true } })).toBe(false);
    expect(can('decide', 'materialRequest', { ...base, record: { created_by: 'u2', inMyQueue: true, viewOnly: true } })).toBe(false);
  });
});

describe('approval chain and stand-in policy', () => {
  it.each(roles)('FR-MRQ-005 %s: everyone reads the chain, only an Admin changes it or the cut-off', (role) => {
    expect(can('view', 'approvalChain', { realRole: role })).toBe(true);
    expect(can('manage', 'approvalChain', { realRole: role })).toBe(role === 'Admin');
  });

  it.each(roles)('FR-MRQ-009 %s: names their own stand-in; only an Admin names one for someone else', (role) => {
    expect(can('manage', 'standIn', { realRole: role, currentUserId: 'u1', record: { delegator_id: 'u1' } })).toBe(true);
    expect(can('manage', 'standIn', { realRole: role, currentUserId: 'u1', record: { delegator_id: 'u2' } })).toBe(role === 'Admin');
    expect(can('manage', 'standIn', { realRole: role, currentUserId: 'u1', record: { delegator_id: 'u1', viewOnly: true } })).toBe(false);
  });
});
