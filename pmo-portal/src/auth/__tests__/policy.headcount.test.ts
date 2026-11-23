import { describe, it, expect } from 'vitest';
import { can } from '../policy';
import type { Role } from '../AuthContext';

/** can(*, 'headcount') — guard-headcount (FR-HC-002, FR-HC-004). The FE mirror of record_headcount_day / approve_headcount_day; UX only. */
describe("can(create, 'headcount')", () => {
  it.each<[Role, boolean]>([['Admin', true], ['Executive', true], ['Project Manager', true], ['Finance', false], ['Engineer', false]])(
    '%s -> %s', (role, expected) => { expect(can('create', 'headcount', { realRole: role })).toBe(expected); });
  it("the crew's foreman may enter whatever their role, a different user may not", () => {
    expect(can('create', 'headcount', { realRole: 'Engineer', currentUserId: 'u1', record: { field_controller_id: 'u1' } })).toBe(true);
    expect(can('create', 'headcount', { realRole: 'Engineer', currentUserId: 'u2', record: { field_controller_id: 'u1' } })).toBe(false);
  });
  it('a view-as session may not enter', () => {
    expect(can('create', 'headcount', { realRole: 'Admin', record: { viewOnly: true } })).toBe(false);
  });
});

describe("can(approve, 'headcount')", () => {
  it.each<[Role, boolean]>([['Admin', true], ['Executive', true], ['Project Manager', true], ['Finance', false], ['Engineer', false]])(
    '%s -> %s', (role, expected) => { expect(can('approve', 'headcount', { realRole: role })).toBe(expected); });
  it('whoever entered or changed the line may not approve it (the separation-of-duties mirror)', () => {
    expect(can('approve', 'headcount', { realRole: 'Admin', currentUserId: 'u1', record: { recorder_ids: ['u1', 'u2'] } })).toBe(false);
    expect(can('approve', 'headcount', { realRole: 'Admin', currentUserId: 'u3', record: { recorder_ids: ['u1', 'u2'] } })).toBe(true);
  });
  it('a view-as session may not approve', () => {
    expect(can('approve', 'headcount', { realRole: 'Admin', record: { viewOnly: true } })).toBe(false);
  });
});
