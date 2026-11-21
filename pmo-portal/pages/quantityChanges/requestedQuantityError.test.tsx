import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { useRequestedQuantityErrorText } from './requestedQuantityError';
import { renderHook } from '@testing-library/react';

/** The words for a refused requested quantity (AC-QCR-005/006): the catalogue key each case maps to. */
describe('useRequestedQuantityErrorText', () => {
  const { result } = renderHook(() => useRequestedQuantityErrorText());
  const text = result.current;

  it('demands a figure when the field is empty', () => {
    expect(text('required', { contract: 1000, figure: 1040 })).toBe('Required');
  });

  it('rejects a malformed figure', () => {
    expect(text('invalid', { contract: 1000, figure: 1040 })).toBe('A positive number with at most 3 decimals');
  });

  it('names the contract quantity when the request is not above it', () => {
    expect(text('not_above_contract', { contract: 1000, figure: 1040 })).toBe('Must be above the contract quantity of 1000');
  });

  it('names the trigger figure when the request is below it', () => {
    expect(text('below_trigger', { contract: 1000, figure: 1040 })).toBe('Cannot be below 1040');
  });
});
