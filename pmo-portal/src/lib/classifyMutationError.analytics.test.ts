/**
 * FR-PHG-010/011 — friction is instrumented at the FUNNEL (classifyMutationError), not the form.
 * See ADR-0067: `save_failed` fired from useEntityForm is inert because (a) no caller passes
 * `entityType` and (b) every form's onValid swallows its own error, so the hook's catch never runs.
 * Passing the missing prop would STILL produce zero events.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const analytics = vi.hoisted(() => ({ trackSaveFailed: vi.fn(), trackBulkImportFailed: vi.fn() }));
vi.mock('./analytics', () => analytics);

import { classifyMutationError, trackBatchSaveFailed } from './classifyMutationError';
import type { ClassifyContext } from './classifyMutationError';

beforeEach(() => {
  analytics.trackSaveFailed.mockClear();
  analytics.trackBulkImportFailed.mockClear();
});

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

  it('SECURITY (review round 2 #3): `module` is bounded to a known slug — a free-text value ' +
    '(the same shape as a customer/company name) collapses to "unknown", not passed through', () => {
    // A future caller bypassing the AnalyticsModule union with a cast (`as AnalyticsModule`) is
    // exactly the "one authoring mistake away" scenario the review flagged — the guard must be
    // a RUNTIME check, since TS types are erased and cannot stop this at the call site.
    classifyMutationError(
      { code: '23503', message: 'x' },
      undefined,
      { module: 'Petronas Carigali Sdn Bhd' as unknown as ClassifyContext['module'], operation: 'delete' },
    );
    expect(analytics.trackSaveFailed).toHaveBeenCalledWith('in_use', 'delete', '23503', 'unknown');
  });

  it('SECURITY (review round 2 #3): `operation` is bounded to a known enum — an unrecognised ' +
    'value falls back to the default rather than passing free text through', () => {
    classifyMutationError(
      { code: '23503', message: 'x' },
      undefined,
      { module: 'companies', operation: 'update customer record for Acme Corp' as unknown as ClassifyContext['operation'] },
    );
    expect(analytics.trackSaveFailed).toHaveBeenCalledWith('in_use', 'classify', '23503', 'companies');
  });

  it('SECURITY (review round 2 #3): known module/operation values still pass through unchanged', () => {
    classifyMutationError({ code: '23503', message: 'x' }, undefined, { module: 'companies', operation: 'delete' });
    expect(analytics.trackSaveFailed).toHaveBeenCalledWith('in_use', 'delete', '23503', 'companies');
  });

  // SECURITY (review round 2 #2): a bulk-import loop calling classifyMutationError per row would
  // multiply ONE user click into thousands of `save_failed` events. PostHog's free-allowance
  // overage DISCARDS PERMANENTLY, so this can silently exhaust the month's headroom and flatten
  // every other chart — the exact false "nobody uses the product" signal this program exists to
  // prevent. Loop call sites must suppress per-row capture and emit an aggregate event instead.
  it('SECURITY (review round 2 #2): `suppressCapture` skips the per-call analytics capture entirely', () => {
    classifyMutationError({ code: '23505', message: 'x' }, undefined, { suppressCapture: true });
    expect(analytics.trackSaveFailed).not.toHaveBeenCalled();
  });

  it('SECURITY (review round 2 #2): suppressCapture does not change the returned headline/detail/classification', () => {
    const withSuppress = classifyMutationError({ code: '23505', message: 'x' }, undefined, { suppressCapture: true });
    const without = classifyMutationError({ code: '23505', message: 'x' });
    expect(withSuppress).toEqual(without);
  });

  it('AC-PHG-010: the return value exposes `classification` (a bounded FrictionClass), used by ' +
    'bulk-loop call sites to build a per-classification tally for trackBatchSaveFailed', () => {
    expect(classifyMutationError(Object.assign(new Error('x'), { code: '23503' })))
      .toEqual({
        headline: 'Still in use',
        // AC-ERR-002: `detail` is the mapped product copy; the verbatim backend text is
        // carried separately as `rawDetail` (diagnostics), never rendered to a user.
        detail: 'Another record still refers to this one. Remove or reassign those references first, or archive it instead.',
        rawDetail: 'x',
        classification: 'in_use',
      });
  });
});

// SECURITY / code-quality (review round 2 #2): the FIRST fix (a single lump `failed_count` under
// `save_failed`'s existing `reason_code: 'other'`) mixed two units of measurement — a 5,000-row
// import failure contributed exactly 1 to the 'other' bucket, indistinguishable from a single
// unrecognised-code failure, AND discarded the per-row reason distribution (RLS vs duplicates
// become unanswerable). Fixed properly: a DISTINCT `bulk_import_failed` event, aggregated PER
// CLASSIFICATION (at most 7 events per run — FrictionClass has 7 members — which stays
// quota-safe AND preserves the reason distribution).
describe('trackBatchSaveFailed — per-classification aggregate (review round 2 item 2 fix)', () => {
  it('fires ONE bulk_import_failed event PER NON-ZERO classification bucket, never save_failed', () => {
    trackBatchSaveFailed('companies', { permission_denied: 4800, duplicate: 21 });
    expect(analytics.trackSaveFailed).not.toHaveBeenCalled();
    expect(analytics.trackBulkImportFailed).toHaveBeenCalledTimes(2);
    expect(analytics.trackBulkImportFailed).toHaveBeenCalledWith('companies', 'permission_denied', 4800);
    expect(analytics.trackBulkImportFailed).toHaveBeenCalledWith('companies', 'duplicate', 21);
  });

  it('skips a zero-count classification bucket (only non-zero buckets fire)', () => {
    trackBatchSaveFailed('companies', { permission_denied: 5, duplicate: 0 });
    expect(analytics.trackBulkImportFailed).toHaveBeenCalledTimes(1);
    expect(analytics.trackBulkImportFailed).toHaveBeenCalledWith('companies', 'permission_denied', 5);
  });

  it('bounds an unrecognised module to "unknown"', () => {
    trackBatchSaveFailed('Petronas Carigali Sdn Bhd' as unknown as ClassifyContext['module'], { duplicate: 3 });
    expect(analytics.trackBulkImportFailed).toHaveBeenCalledWith('unknown', 'duplicate', 3);
  });

  it('an entirely empty/zero tally is a no-op', () => {
    trackBatchSaveFailed('companies', {});
    expect(analytics.trackBulkImportFailed).not.toHaveBeenCalled();
    trackBatchSaveFailed('companies', { duplicate: 0, in_use: 0 });
    expect(analytics.trackBulkImportFailed).not.toHaveBeenCalled();
  });
});
