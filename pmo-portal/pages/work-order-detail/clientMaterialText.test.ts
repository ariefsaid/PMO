import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { refusalMessage, toSubmitError, readQuantity } from './clientMaterialText';

/** The client-material refusal words (spec Errors table): each stable database key gets its sentence
 * with the interpolated quantity, an unknown refusal classifies as usual, and typed quantities are
 * validated before an RPC ever sees them. */
const t = ((_key: string, fallback: string, opts?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts?.[k] ?? ''))) as TFunction;

describe('refusalMessage', () => {
  it('names the excess when the reservation would overdraw the request', () => {
    expect(refusalMessage(t, 'overRequested', '25')).toBe('Reserved would exceed requested by 25.');
  });

  it('keeps a release above what was already collected', () => {
    expect(refusalMessage(t, 'releaseBelowCollected', '40')).toBe('A release cannot take reserved below the 40 already collected.');
  });

  it('caps a collection at what is still to collect', () => {
    expect(refusalMessage(t, 'overCollect', '10')).toBe('Only 10 is still to collect.');
  });

  it('refuses lines that are not client-supplied without a quantity', () => {
    expect(refusalMessage(t, 'notClientSupplied', null)).toBe('This item is not client-supplied.');
  });

  it('an unknown key says nothing (the caller shows its own words)', () => {
    expect(refusalMessage(t, 'unknown', null)).toBeNull();
  });
});

describe('toSubmitError', () => {
  it('uses our words for a known refusal key, carrying the quantity', () => {
    const err = new Error('CSR_OVER_REQUESTED: reserved would exceed requested by 7');
    expect(toSubmitError(t, err)).toEqual({ headline: 'Reserved would exceed requested by 7.' });
  });

  it('falls back to the classifier for an unrecognised refusal', () => {
    const err = new Error('completely unexpected');
    const result = toSubmitError(t, err);
    expect(result.headline).toBeTruthy();
  });
});

describe('readQuantity', () => {
  it.each([
    ['1050', '1050'],
    ['1.25', '1.25'],
    ['0', null],
    ['-1', null],
    ['1.2345', null],
    ['', null],
    ['abc', null],
  ])('parses %s to %s', (raw, expected) => {
    expect(readQuantity(raw)).toBe(expected);
  });
});
