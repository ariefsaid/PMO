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

/**
 * ⚑ MEDIUM-1 (money-safety audit round 7) — the SWEEP's two park reasons are classified, because they
 * are the states in which the release affordance is (correctly) withheld. A withheld button with an
 * unclassified "could not be classified against a known cause" beside it is the dead end this program
 * keeps removing: the operator is told neither what happened nor what to do. Both are RETRYABLE — Retry
 * is precisely their route out, since the sweep parked the row rather than rejecting the budget.
 */
describe('describePushError — the sweep park reasons are classified, not generic (MEDIUM-1)', () => {
  it('budget-push-attempts-exhausted says the recovery gave up, and offers retry as the way out', () => {
    const copy = describePushError('budget-push-attempts-exhausted');
    expect(copy.message).not.toMatch(RAW_ADAPTER_TOKEN);
    expect(copy.message, 'never the unclassified fallback').not.toMatch(/could not be classified/i);
    expect(copy.message).toMatch(/attempt|retr/i);
    expect(copy.retryable, 'Retry is the operator route out — the budget itself was never rejected').toBe(true);
    expect(copy.remedy ?? copy.message).toBeTruthy();
  });

  it('budget-push-no-outbox-candidate says there is no queued command, and stays retryable', () => {
    const copy = describePushError('budget-push-no-outbox-candidate');
    expect(copy.message).not.toMatch(RAW_ADAPTER_TOKEN);
    expect(copy.message).not.toMatch(/could not be classified/i);
    expect(copy.retryable).toBe(true);
  });
});

/**
 * ⚑ round-12 MINOR 3 — 0158 persists the HOLD's OWN reason on a `held` timesheet mirror for the first
 * time (`recovery-probe-failed:` / `recovery-inconclusive-absence:` / `recovery-reissue-unauthorized:`,
 * `adapterSeam/dispatch.ts:320/351/391`). None was in `CODES`, so the slice's most money-sensitive row
 * rendered "a reason this screen could not be classified" — AND, because the unknown fallback is
 * retryable, a Retry whose only possible answer is the outbox's inert `held` branch. A `held` command
 * is resolved by a person (release or attest what ERPNext holds), never by re-running the same command.
 */
describe('describePushError — the recovery hold reasons are classified + NOT retryable (MINOR 3)', () => {
  it.each([
    'recovery-probe-failed',
    'recovery-inconclusive-absence',
    'recovery-reissue-unauthorized',
  ])('%s is a sentence, never the bare token, and never the unclassified fallback', (code) => {
    const copy = describePushError(`${code}: internal adapter detail that must not leak`);
    expect(copy.message).not.toMatch(RAW_ADAPTER_TOKEN);
    expect(copy.message, 'never the unclassified fallback').not.toMatch(/could not be classified/i);
    expect(copy.message.length).toBeGreaterThan(20);
    expect(copy.message).toMatch(/[.!]$/);
  });

  it.each([
    'recovery-probe-failed',
    'recovery-inconclusive-absence',
    'recovery-reissue-unauthorized',
  ])('%s withholds Retry (a held command re-run only lands the inert held branch) and names the human route out', (code) => {
    const copy = describePushError(code);
    expect(copy.retryable, 'a held command is resolved by a person, not by retrying').toBe(false);
    expect(copy.remedy, 'a withheld button must name its route out (C-3)').toBeTruthy();
    expect(copy.remedy).not.toMatch(RAW_ADAPTER_TOKEN);
  });

  // The attestation (0159) moves the mirror `held` -> `failed` and leaves this code; it reaches the SAME
  // attention queue, so it must classify — not read "could not be classified" like the recovery codes
  // above once did. Retryable: PMO confirmed ERPNext holds nothing, so a fresh push is the way out.
  it('operator-attested-no-erp-document is a classified, retryable sentence — not the unclassified fallback', () => {
    const copy = describePushError('operator-attested-no-erp-document: by <uuid> — checked ERPNext');
    expect(copy.message).not.toMatch(RAW_ADAPTER_TOKEN);
    expect(copy.message).not.toMatch(/could not be classified/i);
    expect(copy.message).toMatch(/[.!]$/);
    expect(copy.retryable).toBe(true);
  });
});
