import { describe, it, expect } from 'vitest';
import { parseReservationError, RESERVATION_ERROR_CODES } from './reservationErrors';
import en from '@/public/locales/en/stock.json';
import id from '@/public/locales/id/stock.json';
import { mayReserve } from '@/src/hooks/useStockReservations';

describe('reservation errors and copy', () => {
  it('AC-RSV-002 reads the code and the first number of a database refusal; anything else is null', () => {
    expect(parseReservationError({ message: 'RSV_EXCEEDS_FREE: only 6 is free at this location' })).toEqual({ code: 'RSV_EXCEEDS_FREE', number: '6' });
    expect(parseReservationError({ message: 'RSV_NO_BORROW_APPROVER: ask an Admin' })).toEqual({ code: 'RSV_NO_BORROW_APPROVER', number: null });
    expect(parseReservationError({ message: 'STK_INSUFFICIENT: no' })).toBeNull();
    expect(parseReservationError({ message: 'RSV_MADE_UP: x' })).toBeNull();
    expect(parseReservationError(null)).toBeNull();
  });

  it('AC-RSV-017 every reservation string and error exists in English and Bahasa Indonesia', () => {
    const keys = (o: unknown, p = ''): string[] => Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    const enKeys = keys((en as Record<string, unknown>).reservations).sort();
    expect(keys((id as Record<string, unknown>).reservations).sort()).toEqual(enKeys);
    for (const c of RESERVATION_ERROR_CODES) expect(enKeys).toContain(`errors.${c}`);
  });

  it('AC-RSV-005 the screen offers Reserve to the keeper, a planner and an Admin, never while viewing as another role', () => {
    expect(mayReserve('Engineer', false, true)).toBe(true);
    expect(mayReserve('Project Manager', false, false)).toBe(true);
    expect(mayReserve('Admin', false, false)).toBe(true);
    expect(mayReserve('Engineer', false, false)).toBe(false);
    expect(mayReserve('Admin', true, true)).toBe(false);
  });
});
