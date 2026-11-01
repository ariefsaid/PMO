import { describe, expect, it } from 'vitest';
import { describePushError } from './pushErrorCopy';

describe('AC-BV16-006 account-aware push error copy', () => {
  it('keeps transport classification and adds a bounded account sentence without exposing the token', () => {
    const result = describePushError('external-unreachable: account=COGS');
    expect(result).toMatchObject({ code: 'external-unreachable', retryable: true, transport: true });
    expect(result.message).toMatch(/Account: COGS\.$/);
    expect(result.message).not.toContain('external-unreachable');
  });

  it('preserves account text containing colons as ordinary text', () => {
    expect(describePushError('external-unreachable: account=Cost:Materials').message).toMatch(/Account: Cost:Materials\.$/);
  });

  it('bounds operator-visible account text and keeps unknown machine tokens hidden', () => {
    const result = describePushError(`new-internal-token: account=${'A'.repeat(200)}`);
    expect(result.message).not.toContain('new-internal-token');
    expect(result.message).toMatch(new RegExp(`Account: A{120}\\.$`));
    expect(result.message).not.toContain('A'.repeat(121));
  });

  it('keeps the original classification object when there is no structured account suffix', () => {
    // THEME-DATA-49: a transport failure may follow a write ERPNext already accepted, so the copy
    // reports the outcome as unconfirmed and points at recovery rather than asserting non-arrival.
    const copy = describePushError('external-unreachable');
    expect(copy).toEqual({
      code: 'external-unreachable', message: 'ERPNext could not be reached, so the outcome is unconfirmed.',
      retryable: true, transport: true,
      remedy: 'The system rechecks ERPNext on its own; confirm there before assuming the push did not land.',
    });
    expect(copy.message).not.toMatch(/never arrived|did not arrive/i);
    const dispatchFailed = describePushError('DISPATCH_FAILED');
    expect(dispatchFailed.message).toMatch(/unconfirmed/i);
    expect(dispatchFailed.message).not.toMatch(/never arrived|did not arrive/i);
  });
});
