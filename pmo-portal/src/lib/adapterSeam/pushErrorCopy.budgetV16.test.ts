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
    expect(describePushError('external-unreachable')).toEqual({
      code: 'external-unreachable', message: 'ERPNext could not be reached, so the push never arrived.',
      retryable: true, transport: true, remedy: null,
    });
  });
});
