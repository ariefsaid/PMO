import { describe, it, expect } from 'vitest';
import { can } from './policy';

/** #2584 role matrix: UX only (the RPCs and RLS decide), but it must mirror them (FR-SPC-019, AC-SPC-017). */
describe('subcontract certificate policy', () => {
  const pm = { realRole: 'Project Manager' as const, currentUserId: 'pm1', record: { project_manager_id: 'pm1' } };
  it('FR-SPC-019 prepares: Finance and Admin, and the project\'s own PM; not another PM, an Engineer or an Executive', () => {
    expect(can('prepare', 'subcontractCertificate', { realRole: 'Finance' })).toBe(true);
    expect(can('prepare', 'subcontractCertificate', { realRole: 'Admin' })).toBe(true);
    expect(can('prepare', 'subcontractCertificate', pm)).toBe(true);
    expect(can('prepare', 'subcontractCertificate', { ...pm, record: { project_manager_id: 'other' } })).toBe(false);
    expect(can('prepare', 'subcontractCertificate', { realRole: 'Engineer' })).toBe(false);
    expect(can('prepare', 'subcontractCertificate', { realRole: 'Executive' })).toBe(false);
  });
  it('AC-SPC-006 approves: Finance, Executive and Admin, and never the person who prepared or submitted it', () => {
    expect(can('approve', 'subcontractCertificate', { realRole: 'Finance', currentUserId: 'f2', record: { prepared_by: 'f1', submitted_by: 'f1' } })).toBe(true);
    expect(can('approve', 'subcontractCertificate', { realRole: 'Finance', currentUserId: 'f1', record: { prepared_by: 'f1', submitted_by: 'f1' } })).toBe(false);
    expect(can('approve', 'subcontractCertificate', { realRole: 'Admin', currentUserId: 'a1', record: { prepared_by: 'x', submitted_by: 'a1' } })).toBe(false);
    expect(can('approve', 'subcontractCertificate', { realRole: 'Executive', currentUserId: 'e1', record: { prepared_by: 'f1', submitted_by: 'f1' } })).toBe(true);
    expect(can('approve', 'subcontractCertificate', { realRole: 'Executive', currentUserId: 'e1', record: { prepared_by: 'f1', submitted_by: 'f1', viewOnly: true } })).toBe(false);
    expect(can('approve', 'subcontractCertificate', { realRole: 'Engineer', currentUserId: 'g1', record: {} })).toBe(false);
    expect(can('approve', 'subcontractCertificate', { realRole: 'Project Manager', currentUserId: 'pm1', record: { project_manager_id: 'pm1' } })).toBe(false);
  });
  it('bills: Finance and Admin; impersonation is view-only', () => {
    expect(can('bill', 'subcontractCertificate', { realRole: 'Finance' })).toBe(true);
    expect(can('bill', 'subcontractCertificate', { realRole: 'Project Manager' })).toBe(false);
    expect(can('bill', 'subcontractCertificate', { realRole: 'Admin', record: { viewOnly: true } })).toBe(false);
    expect(can('prepare', 'subcontractCertificate', { realRole: 'Finance', record: { viewOnly: true } })).toBe(false);
  });
  it('FR-SPC-003 the rate card: Admin and Finance write; Executive and PM read; an Engineer sees none', () => {
    expect(can('manage', 'subcontractRate', { realRole: 'Finance' })).toBe(true);
    expect(can('manage', 'subcontractRate', { realRole: 'Executive' })).toBe(false);
    expect(can('view', 'subcontractRate', { realRole: 'Executive' })).toBe(true);
    expect(can('view', 'subcontractRate', { realRole: 'Project Manager' })).toBe(true);
    expect(can('view', 'subcontractRate', { realRole: 'Engineer' })).toBe(false);
    expect(can('view', 'subcontractCertificate', { realRole: 'Engineer' })).toBe(false);
  });
});
