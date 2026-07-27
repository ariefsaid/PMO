/**
 * FR-PHG-010/011 — friction is instrumented at the FUNNEL (classifyMutationError), not the form.
 * See ADR-0067: `save_failed` fired from useEntityForm is inert because (a) no caller passes
 * `entityType` and (b) every form's onValid swallows its own error, so the hook's catch never runs.
 * Passing the missing prop would STILL produce zero events.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const analytics = vi.hoisted(() => ({ trackSaveFailed: vi.fn() }));
vi.mock('./analytics', () => analytics);

import { classifyMutationError } from './classifyMutationError';

beforeEach(() => analytics.trackSaveFailed.mockClear());

describe('classifyMutationError friction capture', () => {
  it('AC-PHG-010: a PostgREST error captures EXACTLY ONE friction event with the right reason_code', () => {
    classifyMutationError({ code: '42501', message: 'permission denied for table projects' });
    expect(analytics.trackSaveFailed).toHaveBeenCalledTimes(1);
    expect(analytics.trackSaveFailed).toHaveBeenCalledWith('permission_denied', 'classify', '42501', 'unknown');
  });

  it('AC-PHG-010: an unrecognised code still reports, classified as unclassified', () => {
    classifyMutationError({ code: 'XX999', message: 'boom' });
    expect(analytics.trackSaveFailed).toHaveBeenCalledWith('unclassified', 'classify', 'XX999', 'unknown');
  });

  it('AC-PHG-010: caller context is forwarded when supplied', () => {
    classifyMutationError({ code: '23503', message: 'in use' }, undefined, { module: 'companies', operation: 'delete' });
    expect(analytics.trackSaveFailed).toHaveBeenCalledWith('in_use', 'delete', '23503', 'companies');
  });

  it('AC-PHG-010: no PII — the verbatim message never becomes an event property', () => {
    classifyMutationError({ code: '23505', message: 'duplicate key: acme@example.com' });
    const props = analytics.trackSaveFailed.mock.calls[0];
    expect(props.join('|')).not.toMatch(/acme@example\.com/);
  });

  it('AC-PHG-010: the return value is unchanged (classification stays a pure function of inputs)', () => {
    // A real Error instance, matching every actual call site + the pre-existing
    // classifyMutationError.test.ts suite: `detail` is only read from `.message`
    // when `err instanceof Error` (a plain `{ code, message }` object — as used
    // in the other assertions in this file, which only check the analytics call
    // args, never `detail` — falls back to the generic detail string).
    expect(classifyMutationError(Object.assign(new Error('x'), { code: '23503' })))
      .toEqual({ headline: 'Still in use', detail: 'x' });
  });
});
