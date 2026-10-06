import { describe, expect, it } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const as = (realRole: Role) => ({ realRole });

describe('progress billing policy', () => {
  it.each([['Admin', true], ['Executive', true], ['Project Manager', true], ['Finance', true], ['Engineer', false]] as const)(
    'AC-PB-008 %s maintains the bill of quantities and sees billing: %s', (role, allowed) => {
      expect(can('create', 'boqItem', as(role))).toBe(allowed);
      expect(can('edit', 'boqItem', as(role))).toBe(allowed);
      expect(can('delete', 'boqItem', as(role))).toBe(allowed);
      expect(can('view', 'progressClaim', as(role))).toBe(allowed);
    });

  it.each([['Admin', true], ['Finance', true], ['Executive', false], ['Project Manager', false], ['Engineer', false]] as const)(
    'AC-PB-008 %s creates, evidences, raises and withdraws billing claims: %s', (role, allowed) => {
      expect(can('create', 'progressClaim', as(role))).toBe(allowed);
      expect(can('transition', 'progressClaim', as(role))).toBe(allowed);
    });

  it("AC-PB-008 assessing reuses #765's rule: the project's own PM, or Finance rank and above", () => {
    const record = { project_manager_id: 'pm-1' };
    expect(can('edit', 'projectProgress', { realRole: 'Project Manager', currentUserId: 'pm-1', record })).toBe(true);
    expect(can('edit', 'projectProgress', { realRole: 'Project Manager', currentUserId: 'pm-2', record })).toBe(false);
    expect(can('edit', 'projectProgress', { realRole: 'Finance', currentUserId: 'f-1', record })).toBe(true);
    expect(can('edit', 'projectProgress', { realRole: 'Engineer', currentUserId: 'pm-1', record })).toBe(false);
  });
});
