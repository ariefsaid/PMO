import { describe, expect, it } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

/** AC-TPI-013 (unit half): the UX mirror of tpi_create / tpi_record_* / tpi_raise_purchase / tpi_waive / tpi_cancel. The database decides. */
const ME = 'me';
const ctx = (realRole: Role, record: Record<string, unknown> = {}, currentUserId: string | null = ME) => ({ realRole, currentUserId, record });
const required = { status: 'executed', required_for: ['billing'], created_by: 'someone', waived_at: null };
const trackedOnly = { status: 'requested', required_for: [], created_by: ME, waived_at: null };

describe('third-party inspection policy', () => {
  it.each([['Admin', true], ['Project Manager', true], ['Finance', true], ['Engineer', true], ['Executive', false]] as const)(
    'FR-TPI-019 %s creates an inspection: %s', (role, allowed) => {
      expect(can('create', 'thirdPartyInspection', ctx(role))).toBe(allowed);
    });
  it('FR-TPI-019 every role reads', () => {
    for (const role of ['Admin', 'Project Manager', 'Finance', 'Engineer', 'Executive'] as const) {
      expect(can('view', 'thirdPartyInspection', ctx(role))).toBe(true);
    }
    expect(can('view', 'thirdPartyInspection', { realRole: null })).toBe(false);
  });
  it('FR-TPI-006 an Engineer cannot raise a purchase; a manager can, only while requested', () => {
    expect(can('raise_purchase', 'thirdPartyInspection', ctx('Engineer', { status: 'requested' }))).toBe(false);
    expect(can('raise_purchase', 'thirdPartyInspection', ctx('Project Manager', { status: 'requested' }))).toBe(true);
    expect(can('raise_purchase', 'thirdPartyInspection', ctx('Finance', { status: 'purchase_raised' }))).toBe(false);
  });
  it('FR-TPI-014 / OD-TPI-3 a manager waives a required inspection, never the creator, never an Engineer', () => {
    expect(can('waive', 'thirdPartyInspection', ctx('Project Manager', required))).toBe(true);
    expect(can('waive', 'thirdPartyInspection', ctx('Project Manager', { ...required, created_by: ME }))).toBe(false);
    expect(can('waive', 'thirdPartyInspection', ctx('Engineer', required))).toBe(false);
    expect(can('waive', 'thirdPartyInspection', ctx('Admin', { ...required, required_for: [] }))).toBe(false);
    expect(can('waive', 'thirdPartyInspection', ctx('Admin', { ...required, waived_at: '2026-11-20' }))).toBe(false);
  });
  it('OD-TPI-8 a required inspection cannot be cancelled by anyone', () => {
    expect(can('cancel', 'thirdPartyInspection', ctx('Admin', required))).toBe(false);
    expect(can('cancel', 'thirdPartyInspection', ctx('Project Manager', { ...required, status: 'requested' }))).toBe(false);
  });
  it('FR-TPI-003 / AC-TPI-013 tracked-only: the creator (Engineer) cancels while requested; a manager any time; not others', () => {
    expect(can('cancel', 'thirdPartyInspection', ctx('Engineer', trackedOnly))).toBe(true);
    expect(can('cancel', 'thirdPartyInspection', ctx('Engineer', { ...trackedOnly, status: 'invited' }))).toBe(false);
    expect(can('cancel', 'thirdPartyInspection', ctx('Engineer', { ...trackedOnly, created_by: 'other' }))).toBe(false);
    expect(can('cancel', 'thirdPartyInspection', ctx('Project Manager', { ...trackedOnly, status: 'invited', created_by: 'other' }))).toBe(true);
    expect(can('cancel', 'thirdPartyInspection', ctx('Project Manager', { ...trackedOnly, status: 'reported' }))).toBe(false);
  });
});
