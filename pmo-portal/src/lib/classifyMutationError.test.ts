import { describe, it, expect } from 'vitest';
import { classifyMutationError, isMeetingReadDenied } from './classifyMutationError';
import { AppError } from './appError';

describe('classifyMutationError (ADR-0017, promoted from ProcurementDetails)', () => {
  it('P0001 → illegal-stage headline, verbatim message as detail', () => {
    const e = Object.assign(new Error('illegal transition Requested→Approved'), { code: 'P0001' });
    expect(classifyMutationError(e)).toEqual({
      headline: "That move isn't allowed from the current stage.",
      detail: 'illegal transition Requested→Approved',
      rawDetail: 'illegal transition Requested→Approved',
      classification: 'illegal_transition',
    });
  });

  it('42501 → not-permitted / SoD headline', () => {
    const e = Object.assign(new Error('permission denied for transition_procurement'), { code: '42501' });
    const out = classifyMutationError(e);
    expect(out.headline).toBe("You don't have permission to do that.");
    expect(out.classification).toBe('permission_denied');
    expect(out.rawDetail).toBe('permission denied for transition_procurement');
  });

  it('23505 → duplicate headline', () => {
    const e = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
    const out = classifyMutationError(e);
    expect(out.headline).toBe('That already exists.');
    expect(out.classification).toBe('duplicate');
    expect(out.rawDetail).toBe('duplicate key value violates unique constraint');
  });

  it('23503 → still-in-use headline (in-use delete)', () => {
    const e = Object.assign(
      new Error('update or delete on table "companies" violates foreign key constraint'),
      { code: '23503' },
    );
    const out = classifyMutationError(e);
    expect(out.headline).toBe('Still in use');
    expect(out.classification).toBe('in_use');
    expect(out.rawDetail).toBe('update or delete on table "companies" violates foreign key constraint');
  });

  it('reads the code carried by an AppError instance', () => {
    const e = new AppError('nope', '42501');
    expect(classifyMutationError(e).headline).toBe("You don't have permission to do that.");
  });

  it('REQUEST_TIMEOUT (withTimeout, UI-freeze hardening) → recoverable timeout headline', () => {
    const e = new AppError('The request timed out', 'REQUEST_TIMEOUT');
    expect(classifyMutationError(e)).toEqual({
      headline: "Request timed out — we couldn't confirm whether it saved.",
      detail: 'The request timed out',
      rawDetail: 'The request timed out',
      classification: 'timeout',
    });
  });

  it('unknown code → generic headline, verbatim detail', () => {
    const e = Object.assign(new Error('something broke'), { code: 'XX999' });
    expect(classifyMutationError(e)).toEqual({
      headline: 'Update failed', detail: 'something broke', rawDetail: 'something broke',
      classification: 'unclassified',
    });
  });

  it('no code → generic headline', () => {
    expect(classifyMutationError(new Error('boom'))).toEqual({
      headline: 'Update failed', detail: 'boom', rawDetail: 'boom', classification: 'unclassified',
    });
  });

  it('non-Error value → generic headline + fallback detail', () => {
    expect(classifyMutationError('weird')).toEqual({
      headline: 'Update failed', detail: 'An error occurred', rawDetail: 'An error occurred',
      classification: 'unclassified',
    });
  });

  it('AC-INV: an optional overrides map classifies a caller-specific code (e.g. an edge-fn error code)', () => {
    const e = new AppError('DUPLICATE_EMAIL', 'DUPLICATE_EMAIL');
    expect(
      classifyMutationError(e, { DUPLICATE_EMAIL: 'That person is already in your workspace.' }),
    ).toEqual({
      headline: 'That person is already in your workspace.', detail: 'DUPLICATE_EMAIL',
      rawDetail: 'DUPLICATE_EMAIL', classification: 'override',
    });
  });

  it('AC-INV: overrides take precedence over the built-in Postgres-code mapping for the same code', () => {
    const e = Object.assign(new Error('nope'), { code: '42501' });
    expect(classifyMutationError(e, { '42501': 'Custom message' }).headline).toBe('Custom message');
  });

  it('AC-INV: an unmatched code falls through to the generic headline even with overrides present', () => {
    const e = Object.assign(new Error('boom'), { code: 'UNKNOWN_ONE' });
    expect(classifyMutationError(e, { DUPLICATE_EMAIL: 'x' }).headline).toBe('Update failed');
  });
});

/**
 * AC-ERR-002 (graduated from the 2026-07-28 Discover pass): the toast/dialog `detail` is
 * PRODUCT COPY. Postgres writes its own messages for the constraint families below and they
 * name internal tables + RLS mechanics — never an end user's business. The verbatim text is
 * still returned as `rawDetail` (diagnostics), it is just not what the UI is handed.
 */
describe('AC-ERR-002: user-facing detail never leaks raw Postgres text', () => {
  const POSTGRES_GENERATED: Array<[string, string]> = [
    ['42501', 'new row violates row-level security policy for table "companies"'],
    ['23505', 'duplicate key value violates unique constraint "companies_name_key"'],
    ['23503', 'update or delete on table "companies" violates foreign key constraint "projects_company_id_fkey" on table "projects"'],
  ];

  it.each(POSTGRES_GENERATED)(
    'AC-ERR-002: %s → a mapped human detail, with no table name / RLS mechanics in it',
    (code, message) => {
      const { detail, rawDetail } = classifyMutationError(Object.assign(new Error(message), { code }));
      expect(detail).not.toBe(message);
      expect(detail).not.toMatch(/row-level security|violates|constraint|table "/i);
      // A real sentence for a human, not a code.
      expect(detail.length).toBeGreaterThan(20);
      // …and the verbatim text is still available for diagnostics.
      expect(rawDetail).toBe(message);
    },
  );

  it('AC-ERR-002: an app-authored message (our own RAISE EXCEPTION / AppError) is passed through', () => {
    // P0001 messages are written BY US in the transition RPCs and are already human copy —
    // replacing them with a generic sentence would destroy the only specific information.
    const e = Object.assign(new Error('A procurement can only be paid after it is invoiced.'), { code: 'P0001' });
    expect(classifyMutationError(e).detail).toBe('A procurement can only be paid after it is invoiced.');
  });
});

describe('isMeetingReadDenied — the 0206 inbound /action guard (#526 security review)', () => {
  it('true for a 42501 carrying the trigger message', () => {
    const e = Object.assign(new Error('task meeting must be one you can read'), { code: '42501' });
    expect(isMeetingReadDenied(e)).toBe(true);
  });

  it('true even when the marker is embedded in longer Postgres text', () => {
    const e = new AppError('ERROR: task meeting must be one you can read (SQLSTATE 42501)', '42501');
    expect(isMeetingReadDenied(e)).toBe(true);
  });

  it('false for a 42501 that is an ordinary role denial — this branch must not steal it', () => {
    const e = Object.assign(new Error('permission denied for table tasks'), { code: '42501' });
    expect(isMeetingReadDenied(e)).toBe(false);
  });

  it('false when the marker text appears under a different (non-42501) code', () => {
    const e = Object.assign(new Error('task meeting must be one you can read'), { code: 'P0001' });
    expect(isMeetingReadDenied(e)).toBe(false);
  });

  it('false for a non-Error / codeless value', () => {
    expect(isMeetingReadDenied(undefined)).toBe(false);
    expect(isMeetingReadDenied({ message: 'task meeting must be one you can read' })).toBe(false);
  });
});

/**
 * #577 (from the #566 security review): `42501` is the ONE code both Postgres and the app write.
 * Treating it as machine-generated swallowed every segregation-of-duties remedy the server wrote.
 *
 * The named failure: a PM who set the value on their own draft work order clicks Issue and reads
 * "Your role does not allow this change. Ask an administrator." Their role is fine — the second
 * pair of eyes is missing — and they are pointed at the one role that can dissolve the control.
 *
 * ⚑ These are the SERVER'S ACTUAL SENTENCES, copied from 0197 §4, not paraphrases. If a migration
 * rewords one, this test still passes (it asserts the remedy survives, not the wording); if the
 * classifier ever swallows them again, it fails.
 */
describe('#577: an app-authored 42501 reaches the user with its own remedy', () => {
  const SOD_REFUSALS = [
    "you set this work order's value yourself, so you cannot also issue it: the value must be confirmed by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it",
    "this work order's value has no recorded author, so you cannot issue it: the value must be set by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it",
    "this work order's value was set by someone who is no longer an active member of this organisation, so you cannot issue it: it must be re-set by your supervisor or by someone who outranks you who is currently active, through set_work_order_value (which records who set it) — or ask them to issue it",
  ];

  it.each(SOD_REFUSALS)('the server sentence survives to the rendered detail: %s', (message) => {
    const { detail } = classifyMutationError(Object.assign(new Error(message), { code: '42501' }));
    expect(detail).toBe(message);
    // The specific failure this replaces: the generic copy blames the ROLE and points at an admin.
    expect(detail).not.toMatch(/Your role does not allow/i);
    expect(detail).not.toMatch(/Ask an administrator/i);
  });

  it('…and Postgres’s own 42501 texts are STILL replaced — the inversion did not open the leak AC-ERR-002 closed', () => {
    for (const raw of [
      'new row violates row-level security policy for table "work_orders"',
      'permission denied for table work_orders',
      'permission denied for function transition_work_order',
      'must be owner of relation work_orders',
    ]) {
      const { detail, rawDetail } = classifyMutationError(Object.assign(new Error(raw), { code: '42501' }));
      expect(detail).toBe('Your role does not allow this change. Ask an administrator if you think it should.');
      expect(detail).not.toMatch(/table "|row-level security|permission denied|must be owner/i);
      expect(rawDetail).toBe(raw); // diagnostics keep the real text
    }
  });
});
