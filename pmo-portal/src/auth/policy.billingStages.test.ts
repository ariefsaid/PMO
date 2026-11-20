import { describe, expect, it } from 'vitest';
import { can } from './policy';
import type { Role } from './AuthContext';

const as = (realRole: Role) => ({ realRole });

describe('billing stages policy (UX mirror of 0960/0961; the database decides)', () => {
  it.each([['Admin', true], ['Finance', true], ['Project Manager', true], ['Executive', false], ['Engineer', false]] as const)(
    'AC-BST-003 %s records billing stages and attaches their documents: %s', (role, allowed) => {
      expect(can('transition', 'billingStage', as(role))).toBe(allowed);
    });

  it.each([['Admin', true], ['Finance', true], ['Project Manager', false], ['Executive', false], ['Engineer', false]] as const)(
    'AC-BST-002 / AC-RET-003 %s sets the stage list, the invoice deadline, retention and its releases: %s', (role, allowed) => {
      expect(can('edit', 'billingStage', as(role))).toBe(allowed);
    });

  it.each([['Admin', true], ['Finance', true], ['Project Manager', true], ['Executive', true], ['Engineer', false]] as const)(
    'NFR-BST-001 %s sees billing stages: %s', (role, allowed) => {
      expect(can('view', 'billingStage', as(role))).toBe(allowed);
    });
});
