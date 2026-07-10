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
