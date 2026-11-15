import { describe, expect, it } from 'vitest';
import { payableDueState } from './payableDueState';

describe('payableDueState', () => {
  it('marks a supplier invoice older than 90 days overdue, the 30 days before due soon, the rest normal', () => {
    expect(payableDueState(105)).toBe('overdue');
    expect(payableDueState(91)).toBe('overdue');
    expect(payableDueState(90)).toBe('dueSoon');
    expect(payableDueState(61)).toBe('dueSoon');
    expect(payableDueState(60)).toBe('normal');
    expect(payableDueState(0)).toBe('normal');
  });

  it('treats an invoice with no age as normal, never as overdue', () => {
    expect(payableDueState(null)).toBe('normal');
    expect(payableDueState(undefined)).toBe('normal');
  });
});
