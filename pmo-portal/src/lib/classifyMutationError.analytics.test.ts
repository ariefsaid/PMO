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

  it('SECURITY (2026-07-27 finding): reason_code is BOUNDED — an external system\'s raw error ' +
    'text (e.g. an ERPNext response body surfaced as `.code` via src/lib/db/adminUsers.ts:103\'s ' +
    '`new AppError(data.error, data.error)` pattern) never reaches the captured event verbatim; ' +
    'unrecognised shapes collapse to the literal string "other"', () => {
    const leaky = 'duplicate key value violates unique constraint — Petronas Carigali Sdn Bhd';
    classifyMutationError({ code: leaky, message: 'x' });
    const call = analytics.trackSaveFailed.mock.calls[0];
    expect(call[2]).toBe('other'); // reason_code is the 3rd positional arg to trackSaveFailed
    expect(call.join('|')).not.toMatch(/Petronas/);
  });

  it('SECURITY: a genuine Postgres SQLSTATE we have not special-cased (5 alphanumeric chars) still ' +
    'passes through — the bound is a real allowlist/shape check, not "always other"', () => {
    classifyMutationError({ code: '22001', message: 'string data right truncation' });
    const call = analytics.trackSaveFailed.mock.calls[0];
    expect(call[2]).toBe('22001');
  });

  it('SECURITY: an HTTP status code passes through; a free-text HTTP-status-shaped string does not', () => {
    classifyMutationError({ code: '503', message: 'x' });
    expect(analytics.trackSaveFailed.mock.calls[0][2]).toBe('503');
    analytics.trackSaveFailed.mockClear();
    classifyMutationError({ code: '503 Service Unavailable for tenant Acme Corp', message: 'x' });
    expect(analytics.trackSaveFailed.mock.calls[0][2]).toBe('other');
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
