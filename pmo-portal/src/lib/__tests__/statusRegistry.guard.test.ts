/**
 * AC-G3D-GUARD-1: No local status→variant map outside statusVariants.ts.
 * AC-G3D-GUARD-2: New registry helpers (roleVariant / budgetVersionVariant) live in
 *   statusVariants.ts and never expose the action-blue or reuse workflow-green
 *   (`won`) for a categorical role classification.
 *
 * Guard 1 tests that the consolidated registry helpers exist and are correctly
 * typed — the guard FAILS if they are not exported from statusVariants.ts.
 *
 * Guard 2 is the no-drawer invariant (see companion guard in DrawerActivation.guard.test.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  roleVariant,
  budgetVersionVariant,
} from '../../lib/status/statusVariants';
import type { StatusVariant } from '../../components/ui/StatusPill';

const FORBIDDEN_FOR_CATEGORY: StatusVariant = 'open';
const FORBIDDEN_GREEN_FOR_ROLE: StatusVariant = 'won'; // workflow-green must not be used for categorical role

describe('AC-G3D-GUARD-1: roleVariant lives in statusVariants.ts (not a local map)', () => {
  it('exports roleVariant helper', () => {
    expect(typeof roleVariant).toBe('function');
  });

  it('never resolves a role to the action-blue (open) variant', () => {
    const roles = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];
    roles.forEach((role) => {
      expect(roleVariant(role)).not.toBe(FORBIDDEN_FOR_CATEGORY);
    });
  });

  it('never uses workflow-green (won) for a role category — categorical tints only', () => {
    const roles = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];
    roles.forEach((role) => {
      expect(roleVariant(role)).not.toBe(FORBIDDEN_GREEN_FOR_ROLE);
    });
  });

  it.each([
    ['Admin', 'neutral'],
    ['Executive', 'neutral'],
    ['Project Manager', 'neutral'],
    ['Finance', 'neutral'],
    ['Engineer', 'neutral'],
  ] as const)('role %s → %s (neutral-only role pills)', (role, variant) => {
    expect(roleVariant(role)).toBe(variant);
  });

  it('falls back to neutral for an unknown role', () => {
    expect(roleVariant('Intern')).toBe('neutral');
  });
});

describe('AC-G3D-GUARD-1: budgetVersionVariant lives in statusVariants.ts (not a local map)', () => {
  it('exports budgetVersionVariant helper', () => {
    expect(typeof budgetVersionVariant).toBe('function');
  });

  it('never resolves a budget version status to the action-blue (open) variant', () => {
    const statuses = ['Active', 'Draft', 'Archived'];
    statuses.forEach((s) => {
      expect(budgetVersionVariant(s)).not.toBe(FORBIDDEN_FOR_CATEGORY);
    });
  });

  it.each([
    ['Active', 'won'],   // Active is a positive terminal → green (aligned to existing registry)
    ['Draft', 'warn'],   // Draft budget awaiting finalization → amber
    ['Archived', 'neutral'], // superseded/terminal-neutral → grey
  ] as const)('budget version %s → %s', (status, variant) => {
    expect(budgetVersionVariant(status)).toBe(variant);
  });
});
