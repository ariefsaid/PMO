/**
 * I-5 / I-14 / I-15 / I-6 — the ONE place a persisted `push_error` becomes something a human reads.
 *
 * The rendered Discover pass (docs/reviews/2026-07-22-p3bc-rendered-discover.md) found raw adapter
 * tokens (`budget-category-unmapped`, `erpnext-activity-type-missing: …`) reaching the DOM on BOTH
 * push surfaces, and Retry offered for failures retry can never fix. Both are properties of the CODE,
 * so both belong in one tested function rather than two hand-written ladders in two components.
 */
import { describe, it, expect } from 'vitest';
import { describePushError, RAW_ADAPTER_TOKEN } from './pushErrorCopy';

/** Every code that any writer can persist into `*_erp_mirror.push_error` today. */
const ALL_CODES = [
  'budget-category-unmapped',
  'budget-multi-fiscal-year',
  'budget-draft-rival-on-grain',
  'budget-enforcement-absent',
  'cross-org-link-rejected',
  'employee-unlinked',
  'project-unmapped',
  'activity-type-unconfigured',
  'commit-rejected',
  'config-rejected',
  'command-held',
  'external-unreachable',
  'DISPATCH_FAILED',
] as const;

describe('describePushError — no raw adapter token may reach the DOM (I-5/I-15)', () => {
  it.each(ALL_CODES)('%s renders as a sentence, never as the bare token', (code) => {
    const copy = describePushError(code);
    expect(copy.message).not.toMatch(RAW_ADAPTER_TOKEN);
    expect(copy.message.length).toBeGreaterThan(20);
    // a sentence, not a slug
    expect(copy.message).toMatch(/[.!]$/);
  });

  it('strips the `code: detail` shape the timesheet writer persists', () => {
    const copy = describePushError("activity-type-unconfigured: binding config has no default_activity_type");
    expect(copy.message).not.toMatch(RAW_ADAPTER_TOKEN);
    expect(copy.message).not.toContain('activity-type-unconfigured');
  });

  it('an UNKNOWN code is still never printed raw — it is named as unclassified', () => {
    const copy = describePushError('erpnext-activity-type-missing: no Activity Type on the binding');
    expect(copy.message).not.toMatch(RAW_ADAPTER_TOKEN);
    expect(copy.message).toMatch(/could not be classified|unrecognised|unexpected/i);
  });

  it('null / empty is a real state, not a blank string', () => {
    expect(describePushError(null).message).toMatch(/no reason was recorded/i);
    expect(describePushError('').message).toMatch(/no reason was recorded/i);
  });
});

describe('describePushError — Retry is withheld where it provably cannot work (I-14)', () => {
  // ERP-side / PMO-config causes: the SAME command re-run changes nothing until a human fixes the
  // cause elsewhere. Offering Retry there is a button that can only ever fail — the exact contract the
  // budget surface already gets right for `unstamped-activation`.
  it.each([
    'activity-type-unconfigured',
    'employee-unlinked',
    'project-unmapped',
    'cross-org-link-rejected',
    'config-rejected',
    'budget-multi-fiscal-year',
    'budget-draft-rival-on-grain',
  ])('%s is NOT retryable and names what must change first', (code) => {
    const copy = describePushError(code);
    expect(copy.retryable).toBe(false);
    expect(copy.remedy).toBeTruthy();
    expect(copy.remedy).not.toMatch(RAW_ADAPTER_TOKEN);
  });

  it.each(['external-unreachable', 'commit-rejected', 'budget-category-unmapped', 'DISPATCH_FAILED'])(
    '%s IS retryable',
    (code) => {
      expect(describePushError(code).retryable).toBe(true);
    },
  );

  it('an UNKNOWN code stays retryable — fail OPEN on the affordance, never silently strand an operator', () => {
    expect(describePushError('brand-new-failure-class').retryable).toBe(true);
  });
});

describe('describePushError — a transport failure is not a gate rejection (I-6)', () => {
  it('external-unreachable is transport: nothing on screen was fixable', () => {
    const copy = describePushError('external-unreachable');
    expect(copy.transport).toBe(true);
  });

  it('a gate rejection is NOT transport', () => {
    expect(describePushError('budget-category-unmapped').transport).toBe(false);
    expect(describePushError('commit-rejected').transport).toBe(false);
  });
});

describe('describePushError — budget-enforcement-absent states the money consequence (I-7)', () => {
  it('says ERPNext is enforcing NO budget, not that it is enforcing the previous one', () => {
    const copy = describePushError('budget-enforcement-absent: cancelled BUDGET-0001, create failed');
    expect(copy.message).toMatch(/no budget/i);
    expect(copy.message).not.toMatch(RAW_ADAPTER_TOKEN);
  });
});
