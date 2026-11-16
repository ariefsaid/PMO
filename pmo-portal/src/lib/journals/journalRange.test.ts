import { describe, expect, it } from 'vitest';
import { monthOf } from './journalRange';

describe('the journals list range (#895)', () => {
  it('defaults to the calendar month of the organisation day', () => {
    expect(monthOf('2026-11-15')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthOf('2028-02-29')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthOf('2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});
