import { describe, it, expect } from 'vitest';
import { classifyExternalError, AppError } from './pendingPush.ts';

/**
 * AC-CUA-062 — pins the shipped `pendingPush.ts` classifier contract for the two ClickUp error
 * codes the dispatch edge function surfaces (`external-unreachable`, `commit-rejected`). The P0
 * classifier already covers both codes, so there is no new impl here; this test asserts the
 * ClickUp-classified error flows through unchanged so a future refactor cannot silently regress the
 * user-facing copy. FR-CUA-062.
 */

describe('classifyExternalError — ClickUp adapter codes (AC-CUA-062)', () => {
  it('external-unreachable → headline "external system unreachable — try again" + ClickUp detail', () => {
    const err = new AppError('ClickUp did not respond (5xx, retry budget exhausted)', 'external-unreachable');
    const out = classifyExternalError(err);
    expect(out).toEqual({
      headline: 'external system unreachable — try again',
      detail: 'ClickUp did not respond (5xx, retry budget exhausted)',
    });
  });

  it('commit-rejected → headline + ClickUp rejection message carried in detail', () => {
    const err = new AppError('List 123 status "Blocked" has no mapping (400 Bad Request)', 'commit-rejected');
    const out = classifyExternalError(err);
    expect(out.headline).toBe('The external system rejected the change.');
    expect(out.detail).toBe('List 123 status "Blocked" has no mapping (400 Bad Request)');
  });

  it('unknown code → generic "Push failed" headline + verbatim ClickUp message in detail', () => {
    const err = new AppError('something else from ClickUp', 'some-other-code');
    const out = classifyExternalError(err);
    expect(out).toEqual({ headline: 'Push failed', detail: 'something else from ClickUp' });
  });
});

describe('classifyExternalError — shared vocabulary: one headline for one event (review fix #5)', () => {
  // The toast (TasksTab) and the badge (useTaskMutations → pendingPushAfterWrite) BOTH route an
  // externally-owned write failure through classifyExternalError, so the headline they show MUST
  // agree for the same event class. The join point is the AppError `code` that dispatchClient stamps.
  it('a structured external-unreachable (edge-fn body) and a network failure (dispatchClient-stamped) render the SAME headline', () => {
    const fromEdgeFn = new AppError('ClickUp 5xx after retries', 'external-unreachable');
    const fromNetwork = new AppError('The external system could not be reached', 'external-unreachable'); // dispatchClient stamps this for a no-context fetch failure
    expect(classifyExternalError(fromEdgeFn).headline).toBe(classifyExternalError(fromNetwork).headline);
    expect(classifyExternalError(fromNetwork).headline).toBe('external system unreachable — try again');
  });

  it('never renders a raw fetch string as the headline (network detail stays in `detail`, not `headline`)', () => {
    const err = new AppError('Failed to send a request: name resolution failed', 'external-unreachable');
    const out = classifyExternalError(err);
    expect(out.headline).toBe('external system unreachable — try again');
    expect(out.headline).not.toContain('name resolution failed');
    expect(out.headline).not.toContain('Failed to send');
  });
});
